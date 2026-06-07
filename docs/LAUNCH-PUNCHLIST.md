# Agent Interface v2 — Launch Punchlist (rebuilt 2026-06-07)

Master go-live checklist. Combines: (a) what's shipped, (b) a multi-agent code
audit (5 auditors over pipeline / security / worker / frontend / billing), and
(c) **real failure data** from `usage_events` (the v2 Supabase, `oqbpuspnmznqxgkmyzyb`).
Telemetry/ops runbook lives in `LAUNCH-E4.md` (parts of which are stale — see end).

---

## 0. Real failure data (7-day window, what testing actually produced)

| kind | total | ok | failed | ok % |
|---|---|---|---|---|
| orchestrate (routing) | 81 | 81 | 0 | **100%** |
| agent_message | 157 | 134 | 23 | **85%** |
| tool_call (build steps) | 80 | 35 | 45 | **44%** ⚠️ |

- **agent_message 85%:** 20 of 23 failures are **grok** (`error_type='unknown'`), all
  on/before 2026-06-03 — grok's error shape isn't recognized by `errorClassify`
  and may already be resolved. 2 gpt `rate_limited`, 1 gemini `service_down`.
- **tool_call 44%:** the headline problem. Failures spread across build step ids
  `s1`–`s9` (most on `s2`). Likely inflated by `dependency_failed` cascades (one
  root failure fails its dependents, each logged), but still far too low.
- **CRITICAL telemetry gap:** every failure row has `metadata = {}` and `model = null`.
  We log *that* a step failed, never *why*. Cannot diagnose the 44% from data.
  **This is fix #1** — see P0-1.

---

## 🛠 Hardening sweep — `launch-hardening` branch (2026-06-07)

All P0 (except the data-gated P0-2) and all P1 fixed; each its own commit, build
+ full offline smoke suite green.

| Item | Status |
|---|---|
| P0-1 telemetry — capture real failure detail in `usage_events` | ✅ |
| P0-3 React error boundaries (app + per-turn) | ✅ |
| P0-4 `proxyFetch` 240s timeout (tools + agentic builder) | ✅ |
| P0-5 sign-up / OAuth dead-end feedback | ✅ |
| P0-2 fix the 44% | ⏳ **needs deploy + your test builds** to see real reasons |
| P1-pipeline parse guards, agentic error-envelope, ffmpeg mutex, MP4 cap | ✅ |
| P1-frontend memory-on-mount, blob: persist/leak, conversation parse guard | ✅ |
| P1-worker SSRF guard, CORS fail-closed, refresh_google rate-limit | ✅ (deploy via wrangler) |
| P1-billing trial-clock migration + `'standard'` CHECK + post-checkout poll | ✅ (migration = **review then apply**) |
| P1-security OAuth-token encryption migration | ✅ written — **coupled to client rewire + live re-auth; not applied** |

**Still requires you (can't be automated safely):**
1. **P0-2:** merge + deploy this branch, run ~3 test builds (incl. a video) → I read `usage_events` and fix the real causes.
2. **Apply the two migration files** after review (trial-clock; OAuth-encryption is coupled to a client rewire — separate task).
3. **Deploy the worker** (`wrangler deploy` in `infrastructure/cloudflare-proxy`) — not auto-deployed with the app.
4. **Server-side entitlement enforcement** (billing C3) before charging: caps are client-only today and bypassable. Required pre-charge, not pre-launch (paywall is disabled).

## ✅ Shipped & verified
- Agentic builder generalized to every deliverable (PRs #87–91)
- Video/output pipeline hardened; ffmpeg core self-hosted via worker, serving 200 (PRs #69–75)
- SEO: prerendered landing HTML, robots, sitemap, OG, JSON-LD, GSC verified + sitemap submitted (PRs #92–93) — **DONE**
- Stripe billing: Checkout + webhook + portal merged (PR #82) — *but see P1 billing bugs; trial/Standard are non-functional at the DB layer*
- PWA installable (PRs #79–81)
- RLS isolation clean; provider API keys encrypted at rest; no committed secrets; no XSS sinks (audit-confirmed)
- CI green (`ci.yml` + `smoke-live.yml`); 22-script smoke suite; Playwright E2E

---

## P0 — launch-blocking (fix before any cohort)

**P0-1. Instrument build-step failures (we're blind on the 44%).**
`usage_events.metadata` is empty on failures. Capture the real error
(`error.message`, tool id, step id, the ffmpeg/`render_failed` detail) into
`metadata`, and populate `model`. Without this, every fix below is guesswork.
→ telemetry write path (`src/utils/telemetry.js`) + buildExecutor failure logging.

**P0-2. Diagnose & fix the top build-step failures.** Once P0-1 lands, re-run a
few builds, read the real reasons, fix the dominant cause(s). Suspects from the
audit: unchecked Claude error envelope in the agentic loop (silent empty build,
`agenticBuild.js:173-179`), unguarded `JSON.parse` in `video_render`/`capcut_bundle`
(`registry.js:779,817`), image-step (`s2`) failures.

**P0-3. Add a React error boundary.** `src/main.jsx` / `App.jsx` — today ANY render
throw white-screens the whole app with no recovery, and `TurnRow` renders
LLM/persisted data unguarded. Wrap `<App/>` (and per-turn) in `Sentry.ErrorBoundary`
with a Reload / New-conversation fallback. Cheap, high-impact. (frontend C1)

**P0-4. `proxyFetch` has no timeout → builds can hang forever.**
`TheInterface.jsx:1691` — the shared wrapper for all 20+ tools and the agentic
builder skips `makeIdleTimeout()` that the rest of the code uses. A stalled
upstream wedges the build turn "in progress" with no recovery. Thread an idle
timeout + AbortController through `proxyFetch` and `runAgenticBuild`. (billing H1)

**P0-5. Sign-up dead-ends silently.** `AuthScreen.jsx:13-22` — on email-confirm
signup, no session + no error → blank screen, the #1 funnel drop. Show "check your
email," and confirm delivery works (gated on the pending Resend SMTP setup —
`todo-resend-email-setup`). (frontend H5)

---

## P1 — fix before turning on billing / within launch week

**Billing & entitlements (paywall is currently hard-disabled, so these gate the
*next* step — turning billing on — not day-1 BYOK):**
- **trial clock has no data:** `trial_starts_at` column is never created or written →
  every user is permanent "fresh Pro." Add the column + set it at signup. (billing C1)
- **`subscription_tier` CHECK lacks `'standard'`:** webhook writes `'standard'` → DB
  rejects → Standard subscribers charged but stuck on Free (500 loop). Relax the
  constraint. (billing C2)
- **entitlement enforcement is client-only** and bypassable via devtools/direct proxy
  calls; worker does zero tier checks. Enforce caps server-side before charging. (billing C3)
- **post-checkout billing refetch** stops at 6s; if webhook is slow the paid user
  sees no upgrade. Backoff-poll until `active` + a "finalizing…" state. (billing H2)

**Security / worker:**
- **SSRF:** worker routes fetch user-supplied URLs (`audio_url`/`image_url`/`source_url`/
  `instance`) with no validation → can hit internal/metadata endpoints. Add an
  `assertSafeUrl()` (https-only, reject private/loopback IPs) used by all routes. (worker C1)
- **CORS fails open:** empty/unset `ALLOWED_ORIGINS` allows every origin. Fail closed. (worker H1 / security M3)
- **`refresh_google` is auth-exempt + unrate-limited:** an open token-exchange oracle
  on your Google `client_secret`. Add per-IP rate limit; ideally require the JWT. (worker C2)
- **OAuth tokens stored plaintext:** Drive/Dropbox/Reddit `access_token`/`refresh_token`
  in `storage_connections` are NOT encrypted (provider API keys are). Drive scope
  includes `gmail.send` → a dump = durable account compromise. Encrypt with the same
  Vault accessor pattern. (security H1)
- **upstream fetches have no timeouts** (worker-wide) + JWT verified via network call
  per request with no cache → availability coupling. (worker H2/H3)

**Frontend resilience:**
- **`blob:` URLs persisted to DB** die on reload → broken media tiles in reopened
  chats; and they're never `revokeObjectURL`'d → memory leak during heavy build
  sessions. Treat `blob:` like heavy `data:` in `lightenOutput`; revoke on clear. (frontend H2/H3)
- **agent memory never loads on mount** — only after opening+closing the Memory panel,
  so "it remembers" is silently inert most sessions. Add a mount `useEffect`. (frontend H4)
- **conversation `JSON.parse` guard** — corrupt `turns_data` dead-ends silently /
  can crash render. Validate + toast. (frontend C2)
- **OAuth / Drive-connect handlers have no catch** → buttons stick on "Redirecting…". (frontend M1/M2)

**Pipeline:**
- **ffmpeg singleton not serialized** — concurrent `ad_render` runs share one wasm FS
  with fixed filenames → corrupt both outputs. Add an async mutex/queue or per-call
  filename prefixes. (pipeline C1/C2)
- **unbounded `data:` MP4 size** — frame-count guard doesn't bound duration; a long
  voiceover → tens-of-MB base64 that can exceed storage limits / freeze the tab. (pipeline H2)

---

## P2 — hardening / post-launch
- grok `error_type='unknown'` → add grok to `errorClassify` so its failures are typed
- worker: atomic rate limiting (DO/native binding, not racy KV); stop echoing raw
  upstream error bodies; SRI-pin the jsDelivr ffmpeg core; fixed `ACAO:*` on the
  public ffmpeg assets to avoid cached-origin mismatch
- Drive OAuth scope minimization (incremental auth for `gmail.send`/sheets/calendar)
- streaming-interval cleanup on unmount/clear (`TheInterface.jsx:162`); VoiceEngine
  dispose on unmount
- `image_per_slide` / `agent_synth` degraded-fallback should flag `meta.degraded/repaired`
  so silent quality drops are visible

---

## Go-live runbook (unchanged from E4, still valid)
1. CI green + authed E2E + smokes
2. Legal live (`/terms.html`, `/privacy.html`) ✅; Sentry DSN in **Production** env (verify)
3. Define small cohort (5–15), pre-warn BYOK
4. Invite one wave; watch Sentry + Command Center Launch tab first hour
5. CF Pages instant-rollback ready

## Stale in `LAUNCH-E4.md` (fix when touching it)
- Says "Stripe isn't wired yet" — it's merged (PR #82)
- References a `dall-e-3` default + `grok-4.3` fallback — image default is `gpt-image-1`
  now (`dall-e-2` dropped); verify the current proxy defaults before quoting them
