import { appURL } from "./providers.js";

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
      ["youtube", "YouTube & Autopilot", ["OUTSTAND_API_KEY"]],
    ];
    res.json({
      appURL: appURL(),
      integrations: groups.map(([id, name, keys]) => {
        const missing = keys.filter((key) => !process.env[key]);
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
