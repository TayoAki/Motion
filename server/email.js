import { randomBytes } from "node:crypto";
import { appURL, cleanEmail, HttpError, providerJSON } from "./providers.js";
import { hashPassword, verifyPassword } from "./domain.js";

export function installEmail({
  app,
  db,
  auth,
  authRate,
  digest,
  transaction,
  session,
}) {
  if (
    !db
      .prepare("PRAGMA table_info(users)")
      .all()
      .some((c) => c.name === "email_verified")
  )
    db.exec(
      "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
    );
  db.exec(
    `CREATE TABLE IF NOT EXISTS mail_tokens(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),purpose TEXT,email TEXT,expires INTEGER,created INTEGER);`,
  );
  const configured = !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
  const preview =
    process.env.DEV_EMAIL_PREVIEW === "1" &&
    process.env.NODE_ENV !== "production" &&
    process.env.COOKIE_SECURE !== "1" &&
    ["localhost", "127.0.0.1"].includes(new URL(appURL()).hostname);
  function canPreview(req) {
    return (
      preview &&
      !req.headers["x-forwarded-for"] &&
      !req.headers["x-forwarded-host"] &&
      ["localhost", "127.0.0.1"].includes(req.hostname) &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      )
    );
  }
  function status() {
    return {
      configured,
      preview,
      verificationRequired: process.env.REQUIRE_EMAIL_VERIFICATION === "1",
    };
  }
  function requireVerified(req, res, next) {
    if (
      process.env.REQUIRE_EMAIL_VERIFICATION === "1" &&
      !req.user.email_verified
    )
      return res.status(403).json({
        error: "Verify your email in Account settings before continuing.",
      });
    next();
  }
  async function send(req, uid, purpose, address) {
    if (!configured && !canPreview(req))
      throw new HttpError(
        503,
        "Configure RESEND_API_KEY and MAIL_FROM to send email. Local developers can explicitly enable DEV_EMAIL_PREVIEW.",
      );
    const recent = db
      .prepare(
        "SELECT created FROM mail_tokens WHERE user_id=? AND purpose=? ORDER BY created DESC LIMIT 1",
      )
      .get(uid, purpose);
    if (recent && Date.now() - recent.created < 60000)
      throw new HttpError(429, "Wait a minute before requesting another link.");
    const raw = randomBytes(32).toString("hex");
    const action = purpose === "reset" ? "reset" : "verify";
    const url = `${appURL()}/#${action}/${raw}`;
    const subject =
      purpose === "reset"
        ? "Reset your Motion Studio password"
        : purpose === "email"
          ? "Confirm your new email address"
          : "Verify your Motion Studio email";
    db.prepare("INSERT INTO mail_tokens VALUES(?,?,?,?,?,?)").run(
      digest(raw),
      uid,
      purpose,
      address,
      Date.now() + (purpose === "reset" ? 3600000 : 86400000),
      Date.now(),
    );
    try {
      if (configured)
        await providerJSON(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.MAIL_FROM,
              to: [address],
              subject,
              text: `${subject}\n\nOpen this link: ${url}\n\nThis single-use link expires in ${purpose === "reset" ? "one hour" : "24 hours"}. If you did not request it, ignore this email.`,
            }),
          },
          "Email delivery",
        );
      return {
        message: configured
          ? "Email sent. Check your inbox."
          : "Development preview only — no email was sent.",
        ...(configured ? {} : { previewURL: url }),
      };
    } catch (e) {
      db.prepare("DELETE FROM mail_tokens WHERE hash=?").run(digest(raw));
      throw e;
    }
  }
  function findToken(raw, purposes) {
    if (!/^[0-9a-f]{64}$/.test(String(raw || "")))
      throw new HttpError(
        400,
        "This link is invalid or expired. Request a new one.",
      );
    const row = db
      .prepare("SELECT * FROM mail_tokens WHERE hash=? AND expires>?")
      .get(digest(raw), Date.now());
    if (!row || !purposes.includes(row.purpose))
      throw new HttpError(
        400,
        "This link is invalid or expired. Request a new one.",
      );
    return row;
  }
  app.get("/api/auth/email-status", (req, res) =>
    res.json({ ...status(), preview: canPreview(req) }),
  );
  app.post(
    "/api/auth/resend-verification",
    auth,
    authRate,
    async (req, res) => {
      if (req.user.email_verified)
        return res.json({ message: "Your email is already verified." });
      res.json(await send(req, req.user.id, "verify", req.user.email));
    },
  );
  app.post("/api/auth/verify-email", authRate, (req, res) => {
    transaction(() => {
      const row = findToken(req.body.token, ["verify", "email"]);
      if (
        row.purpose === "email" &&
        db
          .prepare("SELECT id FROM users WHERE email=? AND id<>?")
          .get(row.email, row.user_id)
      )
        throw new HttpError(409, "That email is already in use.");
      const user = db
        .prepare("SELECT email FROM users WHERE id=?")
        .get(row.user_id);
      if (row.purpose === "verify" && user.email !== row.email)
        throw new HttpError(
          400,
          "This link belongs to a previous email address.",
        );
      db.prepare("UPDATE users SET email=?,email_verified=1 WHERE id=?").run(
        row.email,
        row.user_id,
      );
      db.prepare(
        "DELETE FROM mail_tokens WHERE user_id=? AND purpose IN ('verify','email')",
      ).run(row.user_id);
      if (row.purpose === "email") {
        db.prepare("DELETE FROM mail_tokens WHERE user_id=?").run(row.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      }
    });
    res.json({
      message: "Email confirmed. You can sign in with this address.",
    });
  });
  app.post("/api/auth/forgot-password", authRate, async (req, res) => {
    if (!configured && !canPreview(req))
      throw new HttpError(
        503,
        "Email delivery needs RESEND_API_KEY and MAIL_FROM.",
      );
    const address = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const user = db.prepare("SELECT id FROM users WHERE email=?").get(address);
    let result;
    if (user) {
      try {
        result = await send(req, user.id, "reset", address);
      } catch (e) {
        if (e.status !== 429) throw e;
      }
    }
    res.json({
      message: "If that account exists, a password reset link has been sent.",
      ...(result?.previewURL
        ? { previewURL: result.previewURL, message: result.message }
        : {}),
    });
  });
  app.post("/api/auth/reset-password", authRate, async (req, res) => {
    const password = String(req.body.password || "");
    if (password.length < 8 || password.length > 128)
      throw new HttpError(400, "Use a password between 8 and 128 characters.");
    findToken(req.body.token, ["reset"]);
    const hash = await hashPassword(password);
    transaction(() => {
      const row = findToken(req.body.token, ["reset"]);
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        hash,
        row.user_id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      db.prepare("DELETE FROM keys WHERE user_id=?").run(row.user_id);
      db.prepare("DELETE FROM mail_tokens WHERE user_id=?").run(row.user_id);
    });
    res.clearCookie("motion_session");
    res.json({
      message:
        "Password updated. All sessions and API keys were revoked. Sign in again.",
    });
  });
  app.post("/api/auth/change-email", auth, authRate, async (req, res) => {
    if (
      !(await verifyPassword(
        String(req.body.password || "").slice(0, 129),
        req.user.password,
      ))
    )
      throw new HttpError(401, "Your password is incorrect.");
    const address = cleanEmail(req.body.email);
    if (db.prepare("SELECT id FROM users WHERE email=?").get(address))
      throw new HttpError(409, "That email is already in use.");
    res.json(await send(req, req.user.id, "email", address));
  });
  app.post("/api/auth/change-password", auth, authRate, async (req, res) => {
    if (
      !(await verifyPassword(
        String(req.body.currentPassword || "").slice(0, 129),
        req.user.password,
      ))
    )
      throw new HttpError(401, "Your current password is incorrect.");
    const password = String(req.body.password || "");
    if (password.length < 8 || password.length > 128)
      throw new HttpError(400, "Use a password between 8 and 128 characters.");
    const hash = await hashPassword(password);
    transaction(() => {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        hash,
        req.user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
      db.prepare(
        "DELETE FROM mail_tokens WHERE user_id=? AND purpose='reset'",
      ).run(req.user.id);
    });
    session(req, res, req.user.id);
    res.json({
      message: "Password changed. Other browser sessions were signed out.",
    });
  });
  return {
    status,
    sendVerification: (req) => send(req, req.user.id, "verify", req.user.email),
    requireVerified,
  };
}
