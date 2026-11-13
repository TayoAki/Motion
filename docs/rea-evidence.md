# REA investigation and implementation boundary

Research/build date: November 12, 2026.

## Setup

The user requested `npx rea-agents@latest setup`. That command was launched, followed by the documented noninteractive equivalent `setup --client codex --yes --json` to complete installation in this environment. REA 6.9.0 reported `status: ready`, configured the Codex MCP registration, and installed the matching reverse-engineer-anything skill. No native disassembler is required for JavaScript analysis. This session used the REA CLI; it does not claim an active MCP connection inside Devin.

The repository's existing `.mcp.json` was updated from 6.7.0 to 6.9.0. Its previously checked-in skill was preserved. Current setup instructions take precedence over the older skill copy when using newer tools.

## Analysis

The prior research retained the JavaScript publicly delivered by `https://gomotionai.com/app`. REA parsed `app-inline-5.js` as inert text using:

```sh
npx --yes rea-agents@latest analyze-javascript-application /absolute/path/to/sources \
  --source-path app-inline-5.js --detail summary \
  --evidence_output /absolute/path/to/rea-app-evidence --json
```

- Source SHA-256: `264d38c00c50ba053fd0a4ae66b08029ca701b5f8eff0c6379162ffb6ed62ecf`.
- Parent evidence ID: `ev_1664d140660851ff53de6c0caa635e864b40016d01505b0d19cde2466b16415f`.
- One selected JavaScript source parsed successfully, 335,774 bytes read, 48,657 AST nodes visited, zero parse failures.
- The application graph retained ten endpoint candidates and ten storage relationships. Examples include `/auth/refresh`, `/music/catalog.json`, `active_project_id`, `gm_job`, `gm_export`, and `gm_job_skip`.
- The graph also exposes static candidates involving checkout, subscriptions, YouTube, and Autopilot. Static presence does not prove live availability.

REA's application and semantic coverage are **partial**. Twenty-three inventoried files were outside the selected analysis scope. The 20,000-node per-file semantic ceiling was reached; the result retains 9,285 semantic unknowns. No claim of complete source recovery, server internals, authenticated behavior, or backend equivalence is made.

## How findings informed the build

| Evidence and prior journey research | Independent implementation |
| --- | --- |
| Script/audio creation paths | Script editor, editable starter draft, private narration upload |
| Narration, backgrounds, captions, sound, and summary | Validated render settings and live pre-generation summary |
| Active project/job/export concepts | SQLite project manifest, persisted job state, private media endpoints |
| Asynchronous progress and cancellation | Serialized FFmpeg worker, real progress, cancellation and credit refunds |
| Tutorial's scene review and replacement | Scene editor, visual replacement, saved changes, re-render and download |
| Credit/history and account concepts | Local test-credit ledger, private accounts, hashed sessions and API keys |
| Checkout and YouTube candidates | Configuration-gated Stripe billing and Outstand YouTube connection/publishing; signed invoices and tracked delivery outcomes |

The implementation was written independently with ordinary coding tools after the REA investigation. It does not copy GoMotion's client code, access its private endpoints, or assert that GoMotion uses this renderer or stack.

REA's `list-browser-targets` and passive `inspect-web-page` were also run on the locally built studio through the existing Chrome CDP endpoint. They confirmed the rendered page structure was available for inspection. That short passive observation was policy-filtered and attach-limited; it is not a full browser acceptance test.

## Verification boundary

Automated tests verify this application's backend and real output files. They do not verify the original GoMotion product. Paid provider calls, real payment flows, YouTube publishing, email delivery, and full UI-driven acceptance testing were not performed.

The follow-up implementation adds provider-backed verification/recovery, subscriptions, YouTube publishing, recurring Autopilot series, and an application MCP endpoint. Isolated HTTP provider mocks exercise these paths, including real local rendering and recovery after lost responses; they do not establish live provider approval or activation.

YouTube delivery now uses Outstand's documented managed connection, media upload/confirmation, draft creation/activation, idempotency, and per-account outcome APIs. This integration was implemented from official Outstand documentation, separately from the REA investigation. Provider mocks verify tenant isolation, ambiguous-response recovery, preserved visibility, cancellation, and recurring delivery; no real Outstand or YouTube posts were made.
