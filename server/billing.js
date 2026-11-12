import express from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { appURL, HttpError, providerJSON } from "./providers.js";

const definitions = [
  ["creator", "Creator", 27, 1440],
  ["studio", "Studio", 59, 3600],
  ["agency", "Agency", 107, 7200],
];
export function validSignature(body, header, secret, now = Date.now()) {
  const fields = String(header || "")
    .split(",")
    .map((p) => p.split("="));
  const timestamp = fields.find(([k]) => k === "t")?.[1];
  if (
    !/^\d+$/.test(timestamp || "") ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest();
  return fields
    .filter(([k]) => k === "v1")
    .some(
      ([, value]) =>
        /^[0-9a-f]{64}$/i.test(value || "") &&
        timingSafeEqual(expected, Buffer.from(value, "hex")),
    );
}
export function installBilling({
  app,
  db,
  auth,
  transaction,
  credit,
  requireVerified,
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS billing_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),customer TEXT UNIQUE,subscription TEXT,plan TEXT,status TEXT,cancel_at_period_end INTEGER DEFAULT 0,period_end INTEGER,updated INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY,created INTEGER);
    CREATE TABLE IF NOT EXISTS billing_payments(invoice TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),amount INTEGER,currency TEXT,credits INTEGER,url TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS billing_checkouts(user_id TEXT PRIMARY KEY REFERENCES users(id),plan TEXT,request_key TEXT,session_id TEXT,url TEXT,expires INTEGER);`);
  const configured = !!(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
  );
  const plans = definitions.flatMap(([slug, name, amount, credits]) =>
    ["monthly", "yearly"].map((period) => ({
      key: `${slug}_${period}`,
      name,
      period,
      amount: amount * (period === "yearly" ? 1000 : 100),
      currency: "usd",
      credits: credits * (period === "yearly" ? 12 : 1),
      price:
        process.env[
          `STRIPE_PRICE_${slug.toUpperCase()}_${period.toUpperCase()}`
        ] || "",
    })),
  );
  const byPrice = (price) => plans.find((p) => p.price && p.price === price);
  const headers = () => ({
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Stripe-Version": "2024-06-20",
  });
  const stripe = (route, body, key) =>
    providerJSON(
      `https://api.stripe.com/v1${route}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          ...headers(),
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: new URLSearchParams(body) } : {}),
      },
      "Stripe",
    );
  function assertReady() {
    if (!configured)
      throw new HttpError(
        503,
        "Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before using billing.",
      );
  }
  let catalogCache;
  async function catalog() {
    if (catalogCache && catalogCache.expires > Date.now())
      return catalogCache.rows;
    const rows = await Promise.all(
      plans.map(async (plan) => {
        if (!configured || !plan.price)
          return { ...plan, enabled: false, price: undefined };
        const price = await stripe(`/prices/${encodeURIComponent(plan.price)}`);
        const interval = plan.period === "yearly" ? "year" : "month";
        if (
          !price.active ||
          price.type !== "recurring" ||
          price.recurring?.interval !== interval ||
          price.recurring?.interval_count !== 1 ||
          !Number.isSafeInteger(price.unit_amount) ||
          price.unit_amount <= 0
        )
          return { ...plan, enabled: false, price: undefined };
        return {
          ...plan,
          amount: price.unit_amount,
          currency: price.currency,
          enabled: true,
          price: undefined,
        };
      }),
    );
    catalogCache = { rows, expires: Date.now() + 300000 };
    return rows;
  }
  app.get("/api/billing/plans", async (_req, res) =>
    res.json({ configured, plans: await catalog() }),
  );
  app.get("/api/billing", auth, (req, res) =>
    res.json({
      configured,
      account:
        db
          .prepare(
            "SELECT plan,status,cancel_at_period_end,period_end FROM billing_accounts WHERE user_id=?",
          )
          .get(req.user.id) || null,
      payments: db
        .prepare(
          "SELECT invoice,amount,currency,credits,url,created FROM billing_payments WHERE user_id=? ORDER BY created DESC",
        )
        .all(req.user.id),
    }),
  );
  const checkoutLocks = new Set();
  app.post("/api/billing/checkout", auth, requireVerified, async (req, res) => {
    assertReady();
    const plan = plans.find((p) => p.key === req.body.plan && p.price);
    if (!plan || !(await catalog()).find((p) => p.key === plan.key)?.enabled)
      throw new HttpError(400, "Choose a configured subscription plan.");
    if (checkoutLocks.has(req.user.id))
      throw new HttpError(409, "Checkout is already opening. Please wait.");
    checkoutLocks.add(req.user.id);
    try {
      let account = db
        .prepare("SELECT * FROM billing_accounts WHERE user_id=?")
        .get(req.user.id);
      if (
        account?.subscription &&
        !["canceled", "incomplete_expired"].includes(account.status)
      )
        throw new HttpError(
          409,
          "Manage your current subscription in the billing portal.",
        );
      if (!account?.customer) {
        const customer = await stripe(
          "/customers",
          { email: req.user.email, "metadata[user_id]": req.user.id },
          `motion-customer-${req.user.id}`,
        );
        db.prepare(
          "INSERT INTO billing_accounts(user_id,customer,status) VALUES(?,?,'none') ON CONFLICT(user_id) DO UPDATE SET customer=excluded.customer",
        ).run(req.user.id, customer.id);
        account = { customer: customer.id };
      }
      const pending = db
        .prepare("SELECT * FROM billing_checkouts WHERE user_id=?")
        .get(req.user.id);
      if (pending?.session_id && pending.expires > Date.now()) {
        const existing = await stripe(
          `/checkout/sessions/${encodeURIComponent(pending.session_id)}`,
        );
        if (existing.status === "complete")
          throw new HttpError(
            409,
            "Your payment is processing. Refresh your account shortly.",
          );
        if (existing.status === "open") {
          if (pending.plan === plan.key) return res.json({ url: existing.url });
          throw new HttpError(
            409,
            "An open checkout already exists. Finish it or let it expire before choosing a different plan.",
          );
        }
      }
      const reuse =
        pending &&
        !pending.session_id &&
        pending.plan === plan.key &&
        pending.expires > Date.now();
      const requestKey = reuse ? pending.request_key : randomUUID();
      const expires = reuse
        ? pending.expires
        : (Math.floor(Date.now() / 1000) + 3600) * 1000;
      db.prepare(
        "INSERT INTO billing_checkouts VALUES(?,?,?,NULL,NULL,?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,request_key=excluded.request_key,session_id=NULL,url=NULL,expires=excluded.expires",
      ).run(req.user.id, plan.key, requestKey, expires);
      const checkout = await stripe(
        "/checkout/sessions",
        {
          mode: "subscription",
          customer: account.customer,
          client_reference_id: req.user.id,
          "line_items[0][price]": plan.price,
          "line_items[0][quantity]": "1",
          "subscription_data[metadata][user_id]": req.user.id,
          "subscription_data[metadata][plan]": plan.key,
          success_url: `${appURL()}/#settings?checkout=success`,
          cancel_url: `${appURL()}/#settings?checkout=cancelled`,
          expires_at: String(expires / 1000),
        },
        `motion-checkout-${requestKey}`,
      );
      if (!/^https:\/\/checkout\.stripe\.com\//.test(checkout.url || ""))
        throw new HttpError(
          502,
          "Stripe returned an invalid checkout address.",
        );
      db.prepare(
        "UPDATE billing_checkouts SET session_id=?,url=?,expires=? WHERE user_id=?",
      ).run(checkout.id, checkout.url, checkout.expires_at * 1000, req.user.id);
      res.json({ url: checkout.url });
    } finally {
      checkoutLocks.delete(req.user.id);
    }
  });
  app.post("/api/billing/portal", auth, async (req, res) => {
    assertReady();
    const account = db
      .prepare("SELECT customer FROM billing_accounts WHERE user_id=?")
      .get(req.user.id);
    if (!account?.customer)
      throw new HttpError(
        400,
        "Choose a subscription before opening billing management.",
      );
    const result = await stripe("/billing_portal/sessions", {
      customer: account.customer,
      return_url: `${appURL()}/#settings`,
    });
    if (!/^https:\/\/billing\.stripe\.com\//.test(result.url || ""))
      throw new HttpError(502, "Stripe returned an invalid portal address.");
    res.json({ url: result.url });
  });
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      if (!configured)
        return res
          .status(503)
          .json({ error: "Billing webhook is not configured." });
      if (
        !Buffer.isBuffer(req.body) ||
        !validSignature(
          req.body,
          req.get("stripe-signature"),
          process.env.STRIPE_WEBHOOK_SECRET,
        )
      )
        return res.status(400).json({ error: "Invalid webhook signature." });
      let event;
      try {
        event = JSON.parse(req.body.toString());
      } catch {
        return res.status(400).json({ error: "Invalid webhook payload." });
      }
      if (!event.id || !event.data?.object)
        return res.status(400).json({ error: "Invalid webhook event." });
      if (db.prepare("SELECT id FROM billing_events WHERE id=?").get(event.id))
        return res.json({ received: true });
      let sub, invoice, plan, invoicePlan;
      const object = event.data.object;
      if (
        ["invoice.paid", "invoice.payment_succeeded"].includes(event.type) &&
        object.status === "paid" &&
        ["subscription_create", "subscription_cycle"].includes(
          object.billing_reason,
        ) &&
        object.subscription
      ) {
        invoice = object;
        sub = await stripe(
          `/subscriptions/${encodeURIComponent(object.subscription)}`,
        );
        plan = sub.items?.data?.map((i) => byPrice(i.price?.id)).find(Boolean);
        invoicePlan = object.lines?.data
          ?.filter((l) => !l.proration)
          .map((l) => byPrice(l.price?.id))
          .find(Boolean);
        plan ||= invoicePlan;
        if (!invoicePlan || object.customer !== sub.customer)
          throw new HttpError(
            400,
            "Invoice does not match a configured subscription.",
          );
      } else if (
        [
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ].includes(event.type)
      ) {
        sub = object;
        plan = sub.items?.data?.map((i) => byPrice(i.price?.id)).find(Boolean);
      }
      const uid = sub?.metadata?.user_id;
      if (
        sub &&
        (!uid ||
          !db.prepare("SELECT id FROM users WHERE id=?").get(uid) ||
          !plan)
      )
        throw new HttpError(
          400,
          "Subscription does not belong to this studio.",
        );
      transaction(() => {
        // Check inside the transaction too: concurrent deliveries must grant once.
        const inserted = db
          .prepare("INSERT OR IGNORE INTO billing_events VALUES(?,?)")
          .run(event.id, Number(event.created || 0));
        if (!inserted.changes) return;
        if (sub) {
          const existing = db
            .prepare("SELECT * FROM billing_accounts WHERE user_id=?")
            .get(uid);
          if (existing?.customer && existing.customer !== sub.customer)
            throw new HttpError(400, "Subscription customer mismatch.");
          if (!existing || existing.updated <= Number(event.created || 0))
            db.prepare(
              "INSERT INTO billing_accounts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET customer=excluded.customer,subscription=excluded.subscription,plan=excluded.plan,status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,period_end=excluded.period_end,updated=excluded.updated",
            ).run(
              uid,
              sub.customer,
              sub.id,
              plan.key,
              sub.status,
              sub.cancel_at_period_end ? 1 : 0,
              sub.current_period_end || null,
              Number(event.created || 0),
            );
        }
        if (invoice) {
          const payment = db
            .prepare(
              "INSERT OR IGNORE INTO billing_payments VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              invoice.id,
              uid,
              invoice.amount_paid || 0,
              String(invoice.currency || "usd"),
              invoicePlan.credits,
              /^https:\/\//.test(invoice.hosted_invoice_url || "")
                ? invoice.hosted_invoice_url
                : null,
              Number(invoice.created || event.created || 0),
            );
          if (payment.changes)
            credit(
              uid,
              null,
              `${invoicePlan.name} ${invoicePlan.period} subscription allowance`,
              invoicePlan.credits,
            );
        }
      });
      res.json({ received: true });
    },
  );
  return { configured };
}
