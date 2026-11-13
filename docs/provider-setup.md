# Activate Motion Studio's service integrations

The code can run without credentials for local script-based rendering. The remaining activation work belongs to your provider accounts. Configure credentials only on the server; never use `VITE_` variables, commit `.env`, or expose secrets in screenshots or client code. Restart the server after changing its environment.

## Application URL and deployment

Set `APP_URL` to the browser-visible origin, for example `https://studio.example.com`, without a path. For local development use `http://localhost:4310`. Callback and email links use this fixed setting rather than an untrusted request Host header. Production requires HTTPS, `COOKIE_SECURE=1`, `NODE_ENV=production`, and `DEV_EMAIL_PREVIEW=0`. Configure the reverse proxy to overwrite forwarded headers; the server trusts one proxy when secure cookies are enabled.

Use one application process with durable, private `DATA_DIR` storage. Keep the server running for Autopilot preparation, retries, and delivery-status polling. Outstand executes accepted schedules independently, even if this app later stops; new Autopilot videos still require this app to run.

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

## YouTube and Autopilot: Outstand

1. Create your Outstand account at https://www.outstand.so/ and generate an API key from its dashboard. API access requires an **active subscription**; trialing or inactive organizations receive HTTP 402. Manage the subscription at https://www.outstand.so/app/settings/billing.
2. Give the key `accounts:connect`, `accounts:read`, `accounts:disconnect`, `media:upload`, and `posts:create`, `posts:read`, `posts:update`, `posts:publish`, `posts:delete` permissions. Do not grant token-reading permission. Set `OUTSTAND_API_KEY` in the server environment and restart. Motion does not need your Outstand organization ID or Google client credentials: the API key identifies its organization and Outstand provides managed YouTube OAuth.
3. Set `APP_URL` to your browser-visible origin. Open **Publish & schedule → Connect via Outstand**, then authorize your channel in the browser. Motion supplies `APP_URL/api/youtube/callback` with a ten-minute, single-use state bound to your signed-in session. Each Motion user ID becomes an Outstand `tenant_id`; Motion independently verifies the returned account's ID, network, tenant, and active status. It never requests OAuth tokens.
4. Select a fully exported project, title/description, **Private / Unlisted / Public**, audience/disclosure settings, and optional future time. Confirm the transfer and publication. Outstand receives the MP4 in its media storage, exposes an opaque **public media URL**, and retains uploads for up to **60 days**. This storage behavior applies even when the YouTube video is private. Local Motion originals retain their existing storage policy.
5. Schedule between **ten minutes and 30 days** ahead. Outstand queues delivery for that time; actual YouTube availability may follow processing. Visibility stays as selected: a scheduled private video remains private. Choosing Public authorizes public delivery. Scheduling does not silently change Private to Public.
6. Motion creates an Outstand **draft** using a persisted request and idempotency key, saves its post ID, and then activates it. If preparation misses the chosen time, the draft stays inactive until you choose another time. A lost response retries the identical draft request or reads the existing post; it does not blindly create another video. A requested replacement time is saved separately from the original creation bytes and applied after recovering the draft, including across restarts. Idempotency keys last 24 hours at Outstand; Motion stops unresolved creation replay after 23 hours and asks you to inspect the dashboard. Never recreate an ambiguous post without checking for it first.
7. Motion polls per-account delivery outcomes. Accepted/queued is not published. `scheduled` and `waiting` remain pending; only a published YouTube result with a platform video ID produces a YouTube link. Provider quota failures pause affected Autopilot runs. Explicit retries of a confirmed wholly failed post delete its failed Outstand record and create one new attempt, retaining prior IDs for recovery. Already queued or published posts are reconciled instead of duplicated.
8. Cancel a future schedule from its publication row. Motion deletes the unpublished Outstand post; it refuses cancellation within one minute of the scheduled time or after confirmed publication. Published videos must be managed in YouTube Studio. Private publication copies are removed after confirmed delivery or cancellation; startup and periodic cleanup recover interruptions even without provider credentials. The original project export stays available, and pending/failed jobs retain their recovery copy. Finish or cancel pending publications before disconnecting; disconnect removes the Outstand account authorization and pauses future series, while published YouTube videos remain.

Autopilot also requires OpenRouter. Add 1–100 topics, choose explicit publication visibility (default **Private**), a first time at least 15 minutes ahead, and an interval of 24 hours or seven days. Confirm credit use, media transfer, and automatic posting. Preparation starts up to 30 minutes before each time. Each topic produces one persisted run, project, and publication; a run stays scheduled until actual delivery succeeds. Failures, missed times, and unresolved overdue deliveries pause future runs. Retrying publication reuses the export without another render charge. Pausing a series stops future runs; already-started runs continue. Intervals use UTC, so local times can shift with daylight saving.

**Migration from direct Google publishing:** back up your data before deployment. Historical Google publications are retained and labeled Legacy Google; interrupted direct-Google jobs are blocked rather than replayed through Outstand. Existing YouTube videos and Google-created schedules are unaffected and must be managed in YouTube Studio. Reconnect through Outstand and explicitly review/resume old series. Existing Google token records remain historical data; the new adapter neither reads nor refreshes them.

References: [getting started](https://www.outstand.so/docs/getting-started), [authentication/subscriptions](https://www.outstand.so/docs/authentication), [YouTube configuration](https://www.outstand.so/docs/configurations/youtube), [idempotency](https://www.outstand.so/docs/idempotency), [post lifecycle](https://www.outstand.so/docs/post-lifecycle).

## Verification boundaries

Automated tests use isolated HTTP mocks for these providers, including failure/retry behavior, with real local FFmpeg rendering. No real provider credentials are included. Live provider activation, approval, domain delivery, real charges, and real YouTube publishing require configuration and separate acceptance checks against your accounts.
