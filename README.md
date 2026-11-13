# GoMotion Studio

A working local video studio built from the [GoMotion](https://gomotionai.com/) user-journey research and REA analysis of its publicly delivered JavaScript. This is an independent implementation, not GoMotion's source code or backend.

## Run

Requires **Node 22.16+**, **FFmpeg/ffprobe with `flite`, `ass`, and `libx264`**, and DejaVu fonts. On Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg fonts-dejavu-core
npm install
npm run build
npm start
```

Open `http://localhost:4310`. Create an account in the app when you want to save or generate a video; no preconfigured credentials are included. Accounts receive **300 free starter credits**. Paid subscriptions are available after configuring Stripe; no payment service is enabled by default.

For development, run `npm run api` and `npm run dev` in separate terminals, then open the Vite address. The Vite proxy forwards `/api` to port 4310. `PORT` overrides the API/production port; update the proxy if you change it during development.

## Working journey

1. Explore the public landing page or open Create a video directly.
2. Create a local account, or sign in to an existing account.
3. Paste a script, create an editable starter draft, or upload narration.
4. Preview/select one of four local voices, choose a background and landscape/portrait format, and configure captions, title overlay, and background sound.
5. Save a draft or generate a video. A persisted queue tracks real rendering progress. Cancelling or failing returns the reserved credits.
6. Review the actual video, select scenes, edit narration, replace scene backgrounds, and change export settings.
7. Save changes and update the export, then download the 1080p H.264/AAC MP4 or editable JSON manifest.
8. Connect a YouTube channel, upload an export, or schedule a future publication. Uploads start private, use resumable sessions, and can recover after an interruption without uploading a duplicate video.
9. Enable an Autopilot series: supply topics, a first publishing time, and a daily/weekly interval. Each run writes a script, renders a video, and schedules it on YouTube. Failures pause future runs; late schedules are never published immediately.
10. Choose a Stripe subscription, see paid-invoice credit allowances and receipts, and manage or cancel your subscription through the billing portal.
11. Verify email, change an email/password, recover an account, browse credit history, create thumbnail PNGs, or manage REST/MCP API keys.

The renderer uses curated still images with slow camera movement, local Flite speech, approximate timed captions, an opening title, and optional ambient sound or uploaded music. This version does **not** automatically find stock footage or create AI video clips. Caption timing is estimated from narration length, not word-level speech alignment.

Local limits: 8,000 script characters, 10-minute narration/music uploads, 100 MB per file, one render worker. Generation costs one credit per estimated 15 seconds; re-rendering an existing export costs four. Downloading an existing file is free. No media expiry is imposed.

## Optional AI script writing

Provide `OPENROUTER_API_KEY` securely in the **server** environment, or in an uncommitted `.env` based on `.env.example`. The default model is `openai/gpt-4o-mini`; change it with `OPENROUTER_MODEL`.

Without a key, Script studio explicitly creates a topic-based starter template. Autopilot requires the AI provider and a connected YouTube channel. The OpenRouter, Stripe, Resend, and Google flows are exercised against isolated local provider mocks; no live charges, emails, or YouTube uploads have been made during automated verification.

## Activate provider accounts

The integration code and UI are implemented. Live activation needs your own provider accounts, server-side credentials, a public HTTPS app URL, and provider-side setup. See the exact steps in [provider setup](docs/provider-setup.md). API & integrations displays which server settings are missing without exposing values. Local email previews are available only with explicit `DEV_EMAIL_PREVIEW=1` on loopback.

Premium TTS, automatic footage search, AI video clips/motion graphics, word-level speech alignment, affiliate payouts, and a support-ticket service are outside this implementation. Rendering uses the local media stack described above. This is not a claim of full GoMotion feature parity.

## REST API

Create an API key in API & integrations. It is revealed once and only its hash is persisted. Keys have full access to the owning workspace and should be kept server-side.

```sh
curl http://localhost:4310/api/projects \
  -H "Authorization: Bearer $MOTION_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"My story","script":"Every good story starts with a little curiosity.","background":"forest","aspect":"16:9"}'
```

Use the returned project ID:

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/projects/:id/render` | Reserve credits and queue a render; returns 202 |
| GET | `/api/projects/:id` | Read `status`, `progress`, `stage`, and project settings |
| PATCH | `/api/projects/:id` | Save title, scenes, voice, captions, sound, or aspect ratio |
| POST | `/api/projects/:id/cancel` | Cancel a queued/running render and refund its reservation |
| GET | `/api/projects/:id/download` | Download the rendered MP4 |
| GET | `/api/projects/:id/manifest` | Download the editable project JSON |
| GET | `/api/history` | Read the credit ledger |
| GET | `/api/integrations` | Read configuration readiness, never secret values |
| GET | `/api/billing/plans` | Read enabled plans and actual Stripe prices |
| POST | `/api/billing/checkout` | Open a configured hosted subscription checkout |
| POST | `/api/billing/portal` | Open subscription management/cancellation |
| POST | `/api/billing/webhook` | Receive raw, signature-verified Stripe events |
| POST | `/api/youtube/connect` | Start session-bound Google authorization |
| POST | `/api/youtube/publish` | Queue an owned, clean export for upload/scheduling |
| GET | `/api/youtube` | Read the connected channel and private publication history |
| POST | `/api/series` | Create a confirmed, credit-consuming recurring series |
| PATCH | `/api/series/:id` | Pause or resume future runs |
| POST | `/api/series/runs/:id/retry` | Retry an interrupted run, optionally with a future time |

States: `draft`, `queued`, `running`, `succeeded`, `failed`, `cancelled`. Duplicate render requests while a job is running return 409 without charging again. This API does not implement arbitrary idempotency-key replay across completed jobs.

## MCP

Use **stateless Streamable HTTP** at `/api/mcp`, with `Authorization: Bearer <workspace API key>` on every request. JSON-RPC initialization negotiates protocol versions 2025-03-26, 2025-06-18, or 2025-11-25. JSON responses are supported; a persistent SSE stream is not required or provided.

Tools: `project_list`, `project_get`, `project_create`, `project_render`, `project_cancel`, `project_export`, and `credits_get`. Rendering consumes credits, and returned export URLs require the same authorization. Existing `.mcp.json` configures **REA** for reverse engineering; it is separate from the application's MCP endpoint.

## Persistence and deployment

`data/studio.sqlite` stores accounts, hashed sessions/API keys and action tokens, uploads, projects, scripts, credit events, billing events, encrypted Google tokens, resumable upload sessions, and Autopilot schedules. Uploaded audio and exports live under `data/`. Back up the directory and the separate token-encryption secret. `DATA_DIR` changes the directory. Interrupted renders are marked failed and their reservations refunded on startup; interrupted uploads resume the saved session. Autopilot runs 30 minutes before each scheduled time while this server is running.

This is a single-process application. Before exposing it publicly, configure HTTPS (`COOKIE_SECURE=1` behind a trusted reverse proxy), production provider credentials, storage lifecycle/quotas, monitoring, and backups. Set `NODE_ENV=production`, `DEV_EMAIL_PREVIEW=0`, and `REQUIRE_EMAIL_VERIFICATION=1` after configuring email delivery. Do not run multiple API workers against this in-process render/upload/Autopilot queue. A distributed worker architecture remains a separate scaling project.

## Verification

```sh
npm test
npm run format:check
npm run build
npm audit --omit=dev
```

Tests generate real landscape and portrait MP4s and inspect their streams with ffprobe. They exercise uploaded narration, all four voice previews, account isolation, login/logout, duplicate job prevention, cancellation/refunds, re-export charging, restart recovery, and API key revocation. Test accounts and exports use an isolated temporary database and are cleaned up.

Provider tests additionally check signature freshness and tampering, duplicate paid-invoice delivery, no credits from checkout redirects, OAuth state ownership/replay, encrypted tokens, refresh/revocation, lost upload responses and resume, scheduled-video cancellation, recurring series creation/render/upload, pause/resume, missed times, insufficient-credit recovery, single-use verification and password reset, email changes, session/key revocation, and MCP ownership. Paid production services and full browser acceptance tests have not been exercised.

## REA and assets

`npx rea-agents@latest setup` was run; the release used here is **6.9.0**. The project MCP configuration is pinned to that release for repeatability. The existing repository skill is preserved; the setup-installed current skill lives in the agent's personal skill directory. See [REA evidence](docs/rea-evidence.md) for the investigation, coverage, and limits.

The application uses React, Vite, Express, SQLite, Sharp, Lucide, FFmpeg, and Flite. See [third-party notices](docs/third-party-notices.md) for asset sources and licensing. No proprietary GoMotion JavaScript is included in the application.
