# The AI Council content engine (autonomous author)

The income engine for Agent Interface = the **SEO flywheel**: published council verdicts at
`/council/<slug>` rank for real "should I X or Y / AI second opinion" searches, and the page's
CTA converts readers into people who convene their own council (the ~$20 product). This doc covers
the piece that *fills* that flywheel automatically.

## The loop

```
council-topics.md ──▶ scripts/council-author.mjs ──▶ council_pages (status='draft')
                         │  runs the real 3-stage council                 │
                         │  (Claude + ChatGPT + Gemini + Grok)            ▼
                         │                              James approves in the app
                         ▼                              (CouncilPage admin → "Publish to library")
                  direct provider APIs                            │
                  (server-side, BYOK keys)                        ▼
                                                   status='published' → live at /council/<slug>
                                                                  │
                                                                  ▼
                                              indexed → ranks → reader convenes their own → $
```

- **Author:** `scripts/council-author.mjs` — picks a fresh topic, runs the llm-council flow
  (independent answers → blind peer-ranking → chairman verdict), and writes a **draft**.
- **Approval:** human. The author **never publishes.** James reviews drafts and clicks
  "Publish to library" on the in-app `/council` page (admin-only). That's the quality gate while
  the loop is unproven (per the ramp plan — prove conversions before auto-publishing).

## Why it calls providers directly (not the claude-proxy worker)

The browser council (`src/utils/council.js`) routes through the `claude-proxy` Cloudflare worker,
which **requires a Supabase user JWT + an allowed browser Origin** on every model route
(`infrastructure/cloudflare-proxy/worker.js`). A headless cron has neither. So the author calls
each provider's REST API directly with the same BYOK keys — no JWT, no CORS, no rate-limit
coupling. The prompts and 3-stage logic are copied from `council.js` so a draft reads exactly like
an in-app run. Models come from `src/config/models.js` (single source of truth, shared).

## Running it

```bash
# 1 fresh topic → 1 draft (the daily default)
npm run council:author

# up to 3 fresh topics in one run
node scripts/council-author.mjs --count=3

# ad-hoc one-off question (skips the topics file + dedup)
node scripts/council-author.mjs --topic="Should I lease or buy a car?"

# run the full council but DON'T touch the DB (prints the verdict) — good for spot-checks
node scripts/council-author.mjs --topic="..." --dry-run
```

Offline test (no keys, no network, no DB): `npm run smoke:councilauthor`.

## Environment

These are **real, paid keys** (James's). Set them as secrets on whatever runs the schedule
(the cloud routine / CI), never commit them.

| Var | Purpose |
|---|---|
| `COUNCIL_SUPABASE_SERVICE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Insert drafts (bypasses RLS). Required unless `--dry-run`. |
| `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) | Claude member |
| `OPENAI_API_KEY` | ChatGPT member |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Gemini member |
| `XAI_API_KEY` (or `GROK_API_KEY`) | Grok member |
| `SUPABASE_URL` | optional; defaults to the v2 project |
| `COUNCIL_TOPICS_FILE` | optional; defaults to `docs/content-engine/council-topics.md` |
| `COUNCIL_SITE` | optional; defaults to `https://agentinterface.app` (printed approve link) |

A council needs **≥2 members with keys**. With fewer, the author logs and exits cleanly (no-op),
so a partial key set never errors the schedule.

## Frugality / ROI guardrails (it spends real money)

- **Drafts only** — never auto-publishes. Approval is human.
- **One topic per run** by default. Cost ≈ one council run = a handful of cheap completions
  (Sonnet + 4o + Flash + Grok; ~6 calls total: 4 answers + peer reviews + 1 verdict).
- **Dedup by question** — already-drafted/published topics are skipped, so re-runs don't re-spend.
- **Clean no-op** when the backlog is caught up (no fresh topics) or keys are missing → exit 0.

Per the build plan: stay draft-only until content actually ranks (~1–3 wks) and conversions are
proven, *then* consider gated auto-publish. Spend should stay ROI-positive — a daily run of one
draft is a few cents of tokens against pages that compound in search.

## Scheduling

Run daily (mirrors the Timberline / SideWRK / T&T content engines) via a cloud routine or cron
that executes `npm run council:author` with the env above. Suggested cadence: **daily while the
library is small** (catch up the backlog of high-intent topics), then dial back to ~2–3×/week.
Because of dedup + the clean no-op, an over-eager schedule just idles once topics run out.

## Adding topics

Edit `docs/content-engine/council-topics.md` — one `- question` per line, optional `:: topic-tag`.
See that file's header for what makes a good (high-search-intent, no-obvious-answer) topic.
