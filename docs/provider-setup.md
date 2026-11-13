# Activate Motion Studio's service integrations

The code can run without credentials for local script-based rendering. The remaining activation work belongs to your provider accounts. Configure credentials only on the server; never use `VITE_` variables, commit `.env`, or expose secrets in screenshots or client code. Restart the server after changing its environment.

## Application URL and deployment

Set `APP_URL` to the browser-visible origin, for example `https://studio.example.com`, without a path. For local development use `http://localhost:4310`. Callback and email links use this fixed setting rather than an untrusted request Host header. Production requires HTTPS, `COOKIE_SECURE=1`, `NODE_ENV=production`, and `DEV_EMAIL_PREVIEW=0`. Configure the reverse proxy to overwrite forwarded headers; the server trusts one proxy when secure cookies are enabled.

Use one application process with durable, private `DATA_DIR` storage. Keep the server running for Autopilot preparation and upload retries. YouTube executes already-uploaded schedules independently, even if this app later stops.

## AI scripts: OpenRouter

1. Create a key at https://openrouter.ai/settings/keys with access to an available text model and sufficient account balance.
2. Supply it as `OPENROUTER_API_KEY`. Optionally set `OPENROUTER_MODEL`; the default is `openai/gpt-4o-mini`.
3. Script studio should display AI mode. Without a key, it explicitly generates editable starter templates. Autopilot will not start without AI configuration.

Reference: https://openrouter.ai/docs/api-reference/chat-completion

## Email: Resend

1. Add and verify a sending domain at https://resend.com/domains. Publish the DNS records Resend provides.
2. Create a sending API key at https://resend.com/api-keys with permission to send from that domain.
3. Set `RESEND_API_KEY` and `MAIL_FROM`, such as `Motion Studio <hello@your-verified-domain.com>`.
4. Enable `REQUIRE_EMAIL_VERIFICATION=1` after validating delivery. New accounts receive verification mail; existing accounts can request it from Account settings. Rendering, checkout, channel connection, and Autopilot require verification when this flag is enabled.

Verification/email-change links expire after 24 hours; recovery links after one hour. Token hashes are stored, and each action consumes its tokens once. Email confirmation for a changed address revokes browser sessions and previous action tokens. Password recovery revokes sessions and API keys. Changing a password from Settings signs out other browser sessions.

For explicit local development only, set `DEV_EMAIL_PREVIEW=1` while `APP_URL` uses localhost, secure cookies are off, and `NODE_ENV` is not production. Requests must come directly from loopback with a localhost Host and no forwarded-client headers. The UI labels returned action links as development previews, and no email is sent. Tokens are not logged or written to an outbox file.

Reference: https://resend.com/docs/api-reference/emails/send-email

## Payments: Stripe

1. Start in Stripe **test mode** at https://dashboard.stripe.com/test/apikeys and securely supply `STRIPE_SECRET_KEY`.
2. Create fixed, recurring prices in https://dashboard.stripe.com/test/products for the plans you want to offer. Monthly prices must recur every one month; yearly prices every one year. Set the corresponding `STRIPE_PRICE_CREATOR_MONTHLY`, `STRIPE_PRICE_CREATOR_YEARLY`, `STRIPE_PRICE_STUDIO_MONTHLY`, `STRIPE_PRICE_STUDIO_YEARLY`, `STRIPE_PRICE_AGENCY_MONTHLY`, and/or `STRIPE_PRICE_AGENCY_YEARLY` IDs. Unconfigured plans stay disabled. Use separate price IDs for different allowances.
3. Configure a webhook destination at https://dashboard.stripe.com/test/webhooks for `APP_URL/api/billing/webhook`, using **API version 2024-06-20**. Subscribe to `invoice.paid`, `invoice.payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Store the destination's signing secret as `STRIPE_WEBHOOK_SECRET`.
4. Configure the customer portal at https://dashboard.stripe.com/test/settings/billing/portal. Enable cancellation and the supported plan switches. Disable adjustable quantities; each subscription is one workspace allowance. Users open the portal from Account settings.
5. Confirm test checkout, webhook receipt, allowance, receipt links, and cancellation before switching to live-mode keys, live prices, and a live webhook destination.

Plan displays use actual Stripe amounts/currencies when configured. Default setup prices are references only. Creator/Studio/Agency allowances are 1,440/3,600/7,200 credits per paid monthly invoice. A paid yearly invoice grants twelve monthly allowances **at once**. Proration-only invoices do not grant another full allowance; a changed plan's allowance starts with the next renewal invoice. Refund/chargeback reconciliation and tax/compliance setup remain operational responsibilities; automatic credit clawbacks are not implemented.

A checkout success redirect never grants credits. Signed paid invoices grant once, deduplicated by both event and invoice ID. The webhook verifies signatures over the raw bytes with a five-minute tolerance. API requests are pinned to version 2024-06-20 to match the documented invoice/subscription payloads. Customer creation and checkout creation use persisted idempotency keys. Cancelling stops future renewal allowances; existing credits remain usable.

References: https://docs.stripe.com/api/checkout/sessions/create · https://docs.stripe.com/webhooks/signature · https://docs.stripe.com/api/customer_portal/sessions/create

## YouTube and Autopilot

1. Create a Google Cloud project and enable **YouTube Data API v3** at https://console.cloud.google.com/apis/library/youtube.googleapis.com.
2. Configure the Google Auth consent screen at https://console.cloud.google.com/auth/overview. For a testing app, add the Google accounts that will connect as test users. Obtain any verification/audit required for your intended audience and publishing behavior.
3. Create an **OAuth 2.0 Web application** at https://console.cloud.google.com/apis/credentials. Add the exact redirect URI `APP_URL/api/youtube/callback`; for the default local server this is `http://localhost:4310/api/youtube/callback`.
4. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a persistent random 32-byte encryption secret as **64 hexadecimal characters** in `TOKEN_ENCRYPTION_KEY`. Store this key separately from the database and preserve it across restarts and backups. Losing/changing it requires reconnecting channels and prevents resuming encrypted pending sessions.
5. Open Publish & schedule, connect through Google, and grant `youtube.upload` and `youtube.readonly` access. OAuth state is hashed, expires after ten minutes, is bound to the current signed-in user, and is consumed once. Access and refresh tokens are encrypted with AES-256-GCM.
6. Select a fully exported project, title/description, privacy, audience/disclosure settings, and optional future time. Confirm your choices before queueing. Scheduling must be at least ten minutes in the future. Uploads start private; after confirmation, the status is updated to the requested visibility or private-with-publishAt.
7. An interrupted upload reuses its saved resumable session, queries Google's accepted offset, and continues in 8 MiB chunks. If the final response was lost, the existing session identifies the completed video; no replacement upload is silently started. Failed sessions can be resumed. If Google expires a session, inspect the channel before starting another version.

Unverified API projects can be restricted to private uploads, Google testing grants can expire, and YouTube API quota/audit requirements apply. The application reports actual returned privacy instead of claiming a successful public publication. Disconnecting revokes Google access but does not remove videos or schedules from YouTube. Cancelling a future schedule keeps that video private.

Autopilot requires both OpenRouter and a connected channel. Add 1–100 topics, a first time at least 15 minutes ahead, and an interval of 24 hours or seven days. Confirm automatic credit use and publishing. Preparation starts 30 minutes before each time; each topic produces one persisted run, project, and publication. Intervals use UTC, so local times can shift with daylight saving. Pausing stops future runs; an already-started run continues. Failures pause the series. Missed times require a new future schedule, and exhausted topic queues stop automatically. A failed run can be retried without generating a duplicate YouTube upload.

References: https://developers.google.com/identity/protocols/oauth2/web-server · https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol · https://developers.google.com/youtube/v3/docs/videos/update

## Verification boundaries

Automated tests use isolated HTTP mocks for these providers, including failure/retry behavior, with real local FFmpeg rendering. No real provider credentials are included. Live provider activation, approval, domain delivery, real charges, and real YouTube publishing require configuration and separate acceptance checks against your accounts.
