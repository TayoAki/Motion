import { appURL, encryptionReady } from "./providers.js";

export function installReadiness({ app, auth }) {
  app.get("/api/integrations", auth, (_req, res) => {
    const groups = [
      ["scripts", "AI script writing", ["OPENROUTER_API_KEY"]],
      [
        "email",
        "Verification & account recovery",
        ["RESEND_API_KEY", "MAIL_FROM"],
      ],
      [
        "billing",
        "Stripe subscriptions",
        ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      ],
      [
        "youtube",
        "YouTube & Autopilot",
        ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
      ],
    ];
    res.json({
      appURL: appURL(),
      integrations: groups.map(([id, name, keys]) => {
        const missing = keys.filter((key) => !process.env[key]);
        if (
          id === "youtube" &&
          process.env.TOKEN_ENCRYPTION_KEY &&
          !encryptionReady()
        )
          missing.push("TOKEN_ENCRYPTION_KEY (must be 64 hex characters)");
        if (
          id === "billing" &&
          !Object.keys(process.env).some(
            (key) =>
              /^STRIPE_PRICE_(CREATOR|STUDIO|AGENCY)_(MONTHLY|YEARLY)$/.test(
                key,
              ) && process.env[key],
          )
        )
          missing.push("At least one STRIPE_PRICE_<PLAN>_<INTERVAL>");
        return { id, name, configured: missing.length === 0, missing };
      }),
    });
  });
}
