import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { seal, unseal } from "./providers.js";
import { validSignature } from "./billing.js";

test("Stripe signatures bind the exact bytes, reject stale deliveries, and support rotating signatures", () => {
  const body = Buffer.from('{"event":"hello world"}'),
    secret = "unit-test-signing-secret",
    now = Date.now(),
    timestamp = Math.floor(now / 1000);
  const sign = (stamp) =>
    createHmac("sha256", secret).update(`${stamp}.`).update(body).digest("hex");
  assert.equal(
    validSignature(body, `t=${timestamp},v1=${sign(timestamp)}`, secret, now),
    true,
  );
  assert.equal(
    validSignature(
      body,
      `t=${timestamp},v1=${"0".repeat(64)},v1=${sign(timestamp)}`,
      secret,
      now,
    ),
    true,
  );
  assert.equal(
    validSignature(
      Buffer.from("changed"),
      `t=${timestamp},v1=${sign(timestamp)}`,
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    validSignature(
      body,
      `t=${timestamp - 400},v1=${sign(timestamp - 400)}`,
      secret,
      now,
    ),
    false,
  );
  assert.equal(validSignature(body, "t=abc,v1=oops", secret, now), false);
});
test("channel tokens are authenticated ciphertext and tampering fails", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const encoded = seal("a test refresh token");
    assert.equal(unseal(encoded), "a test refresh token");
    assert.ok(!encoded.includes("a test refresh token"));
    const corrupted = Buffer.from(encoded, "base64");
    corrupted[20] ^= 1;
    assert.throws(() => unseal(corrupted.toString("base64")));
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});

test(
  "configured email, Stripe, OpenRouter, OAuth, resumable YouTube scheduling, and account recovery",
  { timeout: 240000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "motion-provider-test-"));
    const mail = [],
      calls = {
        uploads: 0,
        chunks: 0,
        complete: false,
        updates: [],
        refreshes: 0,
        exchanges: 0,
        revokes: 0,
      };
    let subscriptionUser,
      checkout,
      rejectAI = false;
    let currentPrice = "price_creator_monthly";
    const uploadSessions = new Map();
    const json = (res, body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const subscription = () => ({
      id: "sub_test",
      customer: "cus_test",
      metadata: { user_id: subscriptionUser, plan: "creator_monthly" },
      items: { data: [{ price: { id: currentPrice } }] },
      status: "active",
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    const mock = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks),
          raw = bytes.toString();
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/api.resend.com/emails") {
          mail.push(JSON.parse(raw));
          return json(res, { id: `mail_${mail.length}` });
        }
        if (url.pathname.startsWith("/api.stripe.com/v1/prices/"))
          return json(res, {
            id: url.pathname.split("/").pop(),
            active: true,
            type: "recurring",
            currency: "usd",
            unit_amount: 3210,
            recurring: {
              interval: url.pathname.endsWith("yearly") ? "year" : "month",
              interval_count: 1,
            },
          });
        if (url.pathname === "/api.stripe.com/v1/customers")
          return json(res, { id: "cus_test" });
        if (url.pathname === "/api.stripe.com/v1/checkout/sessions") {
          const form = new URLSearchParams(raw);
          subscriptionUser = form.get("client_reference_id");
          assert.equal(
            form.get("subscription_data[metadata][user_id]"),
            subscriptionUser,
          );
          assert.equal(
            form.get("line_items[0][price]"),
            "price_creator_monthly",
          );
          checkout = {
            id: "cs_test",
            status: "open",
            url: "https://checkout.stripe.com/c/pay/cs_test",
            expires_at: Math.floor(Date.now() / 1000) + 1800,
          };
          return json(res, checkout);
        }
        if (url.pathname === "/api.stripe.com/v1/checkout/sessions/cs_test")
          return json(res, checkout);
        if (url.pathname === "/api.stripe.com/v1/subscriptions/sub_test")
          return json(res, subscription());
        if (url.pathname === "/api.stripe.com/v1/billing_portal/sessions")
          return json(res, {
            url: "https://billing.stripe.com/p/session/test",
          });
        if (url.pathname === "/openrouter.ai/api/v1/chat/completions")
          return rejectAI
            ? json(res, { error: "do not forward provider details" }, 500)
            : json(res, {
                choices: [
                  {
                    message: {
                      content:
                        "The mountains tell a remarkable story. Every valley has something new to discover.",
                    },
                  },
                ],
              });
        if (url.pathname === "/oauth2.googleapis.com/token") {
          const form = new URLSearchParams(raw);
          if (form.get("grant_type") === "refresh_token") calls.refreshes++;
          else calls.exchanges++;
          return json(res, {
            access_token: "mock-access-not-a-real-token",
            refresh_token: "mock-refresh-not-a-real-token",
            expires_in: 3600,
          });
        }
        if (url.pathname === "/oauth2.googleapis.com/revoke") {
          calls.revokes++;
          return json(res, {});
        }
        if (url.pathname === "/www.googleapis.com/youtube/v3/channels")
          return json(res, {
            items: [
              { id: "UC_test_channel", snippet: { title: "Test channel" } },
            ],
          });
        if (url.pathname === "/www.googleapis.com/upload/youtube/v3/videos") {
          assert.equal(JSON.parse(raw).status.privacyStatus, "private");
          calls.uploads++;
          uploadSessions.set(String(calls.uploads), { complete: false });
          res.writeHead(200, {
            Location: `https://www.googleapis.com/upload/test-session/${calls.uploads}`,
          });
          return res.end();
        }
        if (
          url.pathname.startsWith("/www.googleapis.com/upload/test-session/")
        ) {
          const id = url.pathname.split("/").pop(),
            session = uploadSessions.get(id);
          if (req.headers["content-range"].startsWith("bytes */")) {
            if (session.complete) return json(res, { id: `TestVideo${id}ID` });
            res.writeHead(308);
            return res.end();
          }
          assert.ok(bytes.length > 10000);
          calls.chunks++;
          session.complete = true;
          // The service accepted the file, but its response was lost. A retry must
          // query this session rather than create a duplicate YouTube video.
          return id === "1"
            ? json(
                res,
                { error: "temporary failure after accepting upload" },
                503,
              )
            : json(res, { id: `TestVideo${id}ID` });
        }
        if (url.pathname === "/www.googleapis.com/youtube/v3/videos") {
          const body = JSON.parse(raw);
          calls.updates.push(body);
          return json(res, body);
        }
        json(
          res,
          { error: `Unexpected mock route ${req.method} ${url.pathname}` },
          404,
        );
      } catch (e) {
        json(res, { error: e.message }, 500);
      }
    });
    mock.listen(0, "127.0.0.1");
    await once(mock, "listening");
    const portFinder = createServer();
    portFinder.listen(0, "127.0.0.1");
    await once(portFinder, "listening");
    const port = portFinder.address().port;
    await new Promise((r) => portFinder.close(r));
    let server,
      logs = "";
    async function start() {
      server = spawn(process.execPath, ["server/index.js"], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATA_DIR: dataDir,
          PORT: String(port),
          APP_URL: `http://127.0.0.1:${port}`,
          MOTION_TEST_PROVIDER_ORIGIN: `http://127.0.0.1:${mock.address().port}`,
          RESEND_API_KEY: "mock-only",
          MAIL_FROM: "Motion <motion@example.test>",
          REQUIRE_EMAIL_VERIFICATION: "1",
          DEV_EMAIL_PREVIEW: "0",
          STRIPE_SECRET_KEY: "mock-only",
          STRIPE_WEBHOOK_SECRET: "mock-webhook-signing-secret",
          STRIPE_PRICE_CREATOR_MONTHLY: "price_creator_monthly",
          STRIPE_PRICE_STUDIO_MONTHLY: "price_studio_monthly",
          GOOGLE_CLIENT_ID: "mock-client",
          GOOGLE_CLIENT_SECRET: "mock-only",
          TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
          OPENROUTER_API_KEY: "mock-only",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (d) => (logs += d));
      server.stderr.on("data", (d) => (logs += d));
      for (let i = 0; i < 150; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(logs);
    }
    async function stop() {
      if (server && server.exitCode === null) {
        const exited = once(server, "exit");
        server.kill("SIGTERM");
        await exited;
      }
    }
    t.after(async () => {
      await stop();
      await new Promise((r) => mock.close(r));
      await rm(dataDir, { recursive: true, force: true });
    });
    await start();
    const base = `http://127.0.0.1:${port}`;
    async function api(route, method = "GET", body, cookie, extra = {}) {
      const response = await fetch(`${base}/api${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        ...(body
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
        redirect: "manual",
      });
      return {
        status: response.status,
        body: response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : null,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        location: response.headers.get("location"),
      };
    }
    let account = await api("/auth/signup", "POST", {
      email: "creator@example.test",
      password: "original password",
      name: "Creator",
    });
    assert.equal(account.status, 201);
    let cookie = account.cookie;
    const uid = account.body.user.id;
    const other = await api("/auth/signup", "POST", {
      email: "other@example.test",
      password: "other password",
    });
    assert.equal(account.body.user.emailVerified, false);
    assert.equal(mail.length, 2);
    assert.equal(account.body.delivery.previewURL, undefined);
    const project = await api(
      "/projects",
      "POST",
      {
        title: "Provider test video",
        script: "The mountains tell a story. Take a breath and enjoy the view.",
      },
      cookie,
    );
    assert.equal(
      (await api(`/projects/${project.body.id}/render`, "POST", {}, cookie))
        .status,
      403,
    );
    const verifyToken = mail[0].text.match(/#verify\/([a-f0-9]+)/)[1];
    assert.equal(
      (await api("/auth/verify-email", "POST", { token: verifyToken })).status,
      200,
    );
    assert.equal(
      (await api("/auth/verify-email", "POST", { token: verifyToken })).status,
      400,
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.emailVerified,
      true,
    );
    assert.equal(
      (await api("/billing/plans")).body.plans.find(
        (p) => p.key === "creator_monthly",
      ).amount,
      3210,
    );
    assert.equal(
      (await api("/billing/checkout", "POST", { plan: "anything" }, cookie))
        .status,
      400,
    );
    assert.equal(
      (
        await api(
          "/billing/checkout",
          "POST",
          { plan: "creator_monthly" },
          cookie,
        )
      ).body.url,
      checkout.url,
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.credits,
      300,
      "redirecting to checkout never grants credits",
    );
    const invoice = {
      id: "in_test",
      status: "paid",
      subscription: "sub_test",
      customer: "cus_test",
      billing_reason: "subscription_create",
      amount_paid: 3210,
      currency: "usd",
      created: Math.floor(Date.now() / 1000),
      hosted_invoice_url: "https://invoice.stripe.com/i/test",
      lines: {
        data: [{ proration: false, price: { id: "price_creator_monthly" } }],
      },
    };
    async function webhook(
      id,
      object = invoice,
      type = "invoice.paid",
      stamp = Math.floor(Date.now() / 1000),
    ) {
      const body = JSON.stringify({
          id,
          type,
          created: stamp,
          data: { object },
        }),
        signature = createHmac("sha256", "mock-webhook-signing-secret")
          .update(`${stamp}.${body}`)
          .digest("hex");
      return api("/billing/webhook", "POST", body, null, {
        "stripe-signature": `t=${stamp},v1=${signature}`,
      });
    }
    assert.equal(
      (
        await api("/billing/webhook", "POST", {}, null, {
          "stripe-signature": "wrong",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await webhook(
          "evt_old",
          invoice,
          "invoice.paid",
          Math.floor(Date.now() / 1000) - 400,
        )
      ).status,
      400,
    );
    // A paid old-period invoice can arrive after a portal plan change.
    currentPrice = "price_studio_monthly";
    assert.equal((await webhook("evt_paid")).status, 200);
    assert.equal((await webhook("evt_paid")).status, 200);
    assert.equal(
      (
        await webhook(
          "evt_paid_other_type",
          invoice,
          "invoice.payment_succeeded",
        )
      ).status,
      200,
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.credits,
      1740,
    );
    assert.equal(
      (await api("/billing", "GET", null, cookie)).body.account.plan,
      "studio_monthly",
    );
    assert.equal(
      (await api("/billing", "GET", null, cookie)).body.payments.length,
      1,
    );
    assert.equal(
      (await api("/billing", "GET", null, other.cookie)).body.payments.length,
      0,
    );
    assert.equal(
      (await api("/billing/portal", "POST", {}, cookie)).status,
      200,
    );
    assert.equal(
      (await api("/billing/portal", "POST", {}, other.cookie)).status,
      400,
    );
    assert.equal(
      (
        await webhook(
          "evt_cancel",
          { ...subscription(), cancel_at_period_end: true },
          "customer.subscription.updated",
        )
      ).status,
      200,
    );
    assert.equal(
      (await api("/billing", "GET", null, cookie)).body.account
        .cancel_at_period_end,
      1,
    );
    const script = await api(
      "/scripts",
      "POST",
      { topic: "mountains" },
      cookie,
    );
    assert.equal(script.status, 201);
    assert.equal(script.body.source, "ai");
    rejectAI = true;
    const rejected = await api(
      "/scripts",
      "POST",
      { topic: "mountains" },
      cookie,
    );
    assert.equal(rejected.status, 502);
    assert.ok(!rejected.body.error.includes("provider details"));
    rejectAI = false;
    const authorization = await api("/youtube/connect", "POST", {}, cookie);
    assert.equal(authorization.status, 200);
    const state = new URL(authorization.body.url).searchParams.get("state");
    assert.ok(
      (
        await api(
          `/youtube/callback?state=${state}&code=mock-code`,
          "GET",
          null,
          other.cookie,
        )
      ).location.includes("error="),
    );
    assert.ok(
      (
        await api(
          `/youtube/callback?state=${state}&code=mock-code`,
          "GET",
          null,
          cookie,
        )
      ).location.includes("connected=1"),
    );
    assert.ok(
      (
        await api(
          `/youtube/callback?state=${state}&code=mock-code`,
          "GET",
          null,
          cookie,
        )
      ).location.includes("error="),
    );
    assert.equal(calls.exchanges, 1);
    const sql = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
    t.after(() => sql.close());
    const tokens = sql
      .prepare("SELECT * FROM youtube_connections WHERE user_id=?")
      .get(uid);
    assert.notEqual(tokens.refresh_token, "mock-refresh-not-a-real-token");
    assert.ok(!tokens.refresh_token.includes("mock-refresh"));
    sql
      .prepare("UPDATE youtube_connections SET expires=0 WHERE user_id=?")
      .run(uid);
    assert.equal(
      (await api(`/projects/${project.body.id}/render`, "POST", {}, cookie))
        .status,
      202,
    );
    async function waitFor(route, predicate) {
      for (let i = 0; i < 500; i++) {
        const r = await api(route, "GET", null, cookie);
        if (predicate(r.body)) return r.body;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`Timed out ${route}: ${logs}`);
    }
    await waitFor(
      `/projects/${project.body.id}`,
      (p) => p.status === "succeeded",
    );
    const publishAt = new Date(Date.now() + 3600000).toISOString(),
      publish = {
        projectId: project.body.id,
        title: "Scheduled test",
        description: "Test description",
        privacy: "public",
        publishAt,
        confirmed: true,
        madeForKids: false,
        synthetic: true,
      };
    assert.equal(
      (
        await api(
          "/youtube/publish",
          "POST",
          { ...publish, confirmed: false },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (await api("/youtube/publish", "POST", publish, other.cookie)).status,
      403,
    );
    const publication = await api("/youtube/publish", "POST", publish, cookie);
    assert.equal(publication.status, 202);
    assert.equal(
      (await api("/youtube/publish", "POST", publish, cookie)).status,
      409,
    );
    await waitFor("/youtube", (r) => r.publications[0]?.status === "failed");
    assert.equal(
      (
        await api(
          `/youtube/publications/${publication.body.id}/retry`,
          "POST",
          {},
          other.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api(
          `/youtube/publications/${publication.body.id}/retry`,
          "POST",
          {},
          cookie,
        )
      ).status,
      202,
    );
    const scheduled = await waitFor(
      "/youtube",
      (r) => r.publications[0]?.status === "scheduled",
    );
    assert.equal(scheduled.publications[0].publishAt, publishAt);
    assert.equal(calls.uploads, 1);
    assert.equal(calls.chunks, 1);
    assert.equal(calls.refreshes, 1);
    assert.equal(calls.updates[0].status.privacyStatus, "private");
    assert.equal(calls.updates[0].status.containsSyntheticMedia, true);
    assert.equal(
      (
        await api(
          `/youtube/publications/${publication.body.id}/cancel-schedule`,
          "POST",
          {},
          other.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await api(
          `/youtube/publications/${publication.body.id}/cancel-schedule`,
          "POST",
          {},
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(calls.updates.at(-1).status.publishAt, undefined);
    assert.equal(
      (await api("/youtube", "GET", null, cookie)).body.publications[0].privacy,
      "private",
    );
    await stop();
    sql
      .prepare("UPDATE publications SET status='finishing' WHERE id=?")
      .run(publication.body.id);
    await start();
    await waitFor("/youtube", (r) => r.publications[0]?.status === "published");
    assert.equal(calls.uploads, 1);
    const otherVerify = mail[1].text.match(/#verify\/([a-f0-9]+)/)[1];
    assert.equal(
      (await api("/auth/verify-email", "POST", { token: otherVerify })).status,
      200,
    );
    const seriesInput = {
      name: "Daily stories",
      topics: ["Why mountains grow"],
      nextAt: new Date(Date.now() + 25 * 60000).toISOString(),
      intervalDays: 1,
      settings: { background: "forest", voice: "slt", aspect: "9:16" },
      confirmed: true,
      synthetic: true,
    };
    assert.equal(
      (
        await api(
          "/series",
          "POST",
          { ...seriesInput, confirmed: false },
          cookie,
        )
      ).status,
      400,
    );
    const balanceBeforeSeries = (await api("/me", "GET", null, cookie)).body
      .user.credits;
    const series = await api("/series", "POST", seriesInput, cookie);
    assert.equal(series.status, 201);
    const seriesDone = await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === series.body.id)?.runs[0]?.status ===
        "complete",
    );
    const firstRun = seriesDone.series.find((s) => s.id === series.body.id)
      .runs[0];
    assert.equal(
      (await api(`/projects/${firstRun.project_id}`, "GET", null, cookie)).body
        .status,
      "succeeded",
    );
    assert.equal(
      (await api("/me", "GET", null, cookie)).body.user.credits,
      balanceBeforeSeries - 1,
    );
    assert.equal(calls.uploads, 2);
    assert.equal(calls.chunks, 2);
    assert.equal(
      (await api("/series", "GET", null, other.cookie)).body.series.length,
      0,
    );
    assert.equal(
      (
        await api(
          `/series/${series.body.id}`,
          "PATCH",
          { active: true },
          other.cookie,
        )
      ).status,
      404,
    );
    const futureSeries = await api(
      "/series",
      "POST",
      {
        ...seriesInput,
        name: "Future",
        topics: ["First future topic", "Second future topic"],
        nextAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      },
      cookie,
    );
    assert.equal(
      (
        await api(
          `/series/${futureSeries.body.id}`,
          "PATCH",
          { active: false },
          cookie,
        )
      ).body.active,
      false,
    );
    assert.equal(
      (
        await api(
          `/series/${futureSeries.body.id}`,
          "PATCH",
          { active: true },
          cookie,
        )
      ).body.active,
      true,
    );
    sql
      .prepare("UPDATE series SET next_at=? WHERE id=?")
      .run(new Date(Date.now() - 60000).toISOString(), futureSeries.body.id);
    const missed = await waitFor(
      "/series",
      (r) => r.series.find((s) => s.id === futureSeries.body.id)?.error,
    );
    assert.equal(
      missed.series.find((s) => s.id === futureSeries.body.id).runs.length,
      0,
      "missed times must never cause immediate publication",
    );
    sql.prepare("UPDATE users SET credits=0 WHERE id=?").run(uid);
    const noCredit = await api(
      "/series",
      "POST",
      {
        ...seriesInput,
        name: "Out of credits",
        topics: ["A paused topic", "A later topic"],
      },
      cookie,
    );
    const stopped = await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === noCredit.body.id)?.runs[0]?.status ===
        "failed",
    );
    const stoppedSeries = stopped.series.find((s) => s.id === noCredit.body.id);
    assert.equal(stoppedSeries.active, false);
    sql.prepare("UPDATE users SET credits=10 WHERE id=?").run(uid);
    assert.equal(
      (
        await api(
          `/series/runs/${stoppedSeries.runs[0].id}/retry`,
          "POST",
          {},
          cookie,
        )
      ).status,
      200,
    );
    await waitFor(
      "/series",
      (r) =>
        r.series.find((s) => s.id === noCredit.body.id)?.runs[0]?.status ===
        "complete",
    );
    assert.equal((await api("/me", "GET", null, cookie)).body.user.credits, 9);
    assert.equal(calls.uploads, 3);
    assert.equal(
      (await api("/youtube/connection", "DELETE", null, cookie)).status,
      200,
    );
    assert.equal(calls.revokes, 1);
    assert.equal(
      (await api("/youtube", "GET", null, cookie)).body.channel,
      null,
    );
    // Email changes require the current password and confirmation of the new inbox.
    assert.equal(
      (
        await api(
          "/auth/change-email",
          "POST",
          { email: "new@example.test", password: "wrong" },
          cookie,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await api(
          "/auth/change-email",
          "POST",
          { email: "new@example.test", password: "original password" },
          cookie,
        )
      ).status,
      200,
    );
    const emailToken = mail.at(-1).text.match(/#verify\/([a-f0-9]+)/)[1];
    assert.equal(
      (await api("/auth/verify-email", "POST", { token: emailToken })).status,
      200,
    );
    assert.equal((await api("/me", "GET", null, cookie)).body.user, null);
    account = await api("/auth/login", "POST", {
      email: "new@example.test",
      password: "original password",
    });
    cookie = account.cookie;
    const key = (await api("/keys", "POST", {}, cookie)).body.key;
    assert.equal(
      (
        await api("/auth/forgot-password", "POST", {
          email: "unknown@example.test",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("/auth/forgot-password", "POST", {
          email: "new@example.test",
        })
      ).status,
      200,
    );
    const resetToken = mail.at(-1).text.match(/#reset\/([a-f0-9]+)/)[1];
    assert.equal(
      (await api("/auth/verify-email", "POST", { token: resetToken })).status,
      400,
    );
    assert.equal(
      (
        await api("/auth/reset-password", "POST", {
          token: resetToken,
          password: "replacement password",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await api("/auth/reset-password", "POST", {
          token: resetToken,
          password: "another password",
        })
      ).status,
      400,
    );
    assert.equal((await api("/projects", "GET", null, cookie)).status, 401);
    assert.equal(
      (
        await api("/projects", "GET", null, null, {
          Authorization: `Bearer ${key}`,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await api("/auth/login", "POST", {
          email: "new@example.test",
          password: "original password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await api("/auth/login", "POST", {
          email: "new@example.test",
          password: "replacement password",
        })
      ).status,
      200,
    );
    await api("/auth/forgot-password", "POST", { email: "new@example.test" });
    const expiredToken = mail.at(-1).text.match(/#reset\/([a-f0-9]+)/)[1];
    sql.prepare("UPDATE mail_tokens SET expires=0 WHERE purpose='reset'").run();
    assert.equal(
      (
        await api("/auth/reset-password", "POST", {
          token: expiredToken,
          password: "expired link password",
        })
      ).status,
      400,
    );
  },
);
