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

Open `http://localhost:4310`. Create an account in the app when you want to save or generate a video; no preconfigured credentials are included. Accounts receive **300 local test credits**, with no monetary value or payments.

For development, run `npm run api` and `npm run dev` in separate terminals, then open the Vite address. The Vite proxy forwards `/api` to port 4310. `PORT` overrides the API/production port; update the proxy if you change it during development.

## Working journey

1. Explore the public landing page or open Create a video directly.
2. Create a local account, or sign in to an existing account.
3. Paste a script, create an editable starter draft, or upload narration.
4. Preview/select one of four local voices, choose a background and landscape/portrait format, and configure captions, title overlay, and background sound.
5. Save a draft or generate a video. A persisted queue tracks real rendering progress. Cancelling or failing returns the reserved credits.
6. Review the actual video, select scenes, edit narration, replace scene backgrounds, and change export settings.
7. Save changes and update the export, then download the 1080p H.264/AAC MP4 or editable JSON manifest.
8. Return to projects, create thumbnail PNGs, view credit history, manage your profile, or create/revoke REST API keys.

The renderer uses curated still images with slow camera movement, local Flite speech, approximate timed captions, an opening title, and optional ambient sound or uploaded music. This version does **not** automatically find stock footage or create AI video clips. Caption timing is estimated from narration length, not word-level speech alignment.

Local limits: 8,000 script characters, 10-minute narration/music uploads, 100 MB per file, one render worker. Generation costs one test credit per estimated 15 seconds; re-rendering an existing export costs four. Downloading an existing file is free. No media expiry is imposed.

## Optional AI script writing

Provide `OPENROUTER_API_KEY` securely in the **server** environment, or in an uncommitted `.env` based on `.env.example`. The default model is `openai/gpt-4o-mini`; change it with `OPENROUTER_MODEL`.

Without a key, Script studio explicitly creates a topic-based starter template. It does not pretend to generate original AI content. The optional OpenRouter path is implemented but has not been exercised against a paid provider in this build.

## Not connected

- Stripe checkout, subscription webhooks, and purchased credits. The plan comparison is a clearly labeled pricing reference; its checkout buttons are disabled.
- Google/YouTube OAuth, upload, or scheduling. Autopilot explains the prerequisite and links to the official integration guide.
- Email verification, password recovery, and email changes. Local password accounts and session logout work.
- Premium TTS, automatic footage search, AI motion graphics, word-level caption alignment, or MCP access. The REST API is functional.
- Affiliate payouts, coupon redemption, and a support-ticket backend.

These are remaining product integrations, not simulated successful operations.

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

States: `draft`, `queued`, `running`, `succeeded`, `failed`, `cancelled`. Duplicate render requests while a job is running return 409 without charging again. This API does not implement arbitrary idempotency-key replay across completed jobs.

## Persistence and deployment

`data/studio.sqlite` stores accounts, hashed sessions/API keys, uploads, projects, scripts, and credit events. Uploaded audio and exports live under `data/`. Back up the whole directory and keep it private. `DATA_DIR` changes its location. Interrupted renders are marked failed and their reservations refunded on startup.

This is a single-process local MVP. Before exposing it publicly, configure HTTPS (`COOKIE_SECURE=1` behind a trusted reverse proxy), storage lifecycle/quotas, transactional billing, email delivery, provider credentials, account recovery, monitoring, and a scalable worker/queue strategy. Do not run multiple API workers against this in-process render queue.

## Verification

```sh
npm test
npm run build
npm audit --omit=dev
```

Tests generate real landscape and portrait MP4s and inspect their streams with ffprobe. They exercise uploaded narration, all four voice previews, account isolation, login/logout, duplicate job prevention, cancellation/refunds, re-export charging, restart recovery, and API key revocation. Test accounts and exports use an isolated temporary database and are cleaned up.

## REA and assets

`npx rea-agents@latest setup` was run; the release used here is **6.9.0**. The project MCP configuration is pinned to that release for repeatability. The existing repository skill is preserved; the setup-installed current skill lives in the agent's personal skill directory. See [REA evidence](docs/rea-evidence.md) for the investigation, coverage, and limits.

The application uses React, Vite, Express, SQLite, Sharp, Lucide, FFmpeg, and Flite. See [third-party notices](docs/third-party-notices.md) for asset sources and licensing. No proprietary GoMotion JavaScript is included in the application.
