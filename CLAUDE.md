# Agent Interface — repo context

The category reference site for "agent interfaces": a definitional hub at `/`, the living
`/tracker` (plus its `.json` twin), DB-driven `/guides`, and a daily content engine. Cloudflare
Pages Functions SSR + Supabase `oqbpuspnmznqxgkmyzyb`.

**Production deploys from `main` via Cloudflare Pages.** A merge to `main` ships. Work on a branch.

## ⭐ Updating the tracker — DB rows, not PRs (changed 2026-08-13)

**Do not edit `functions/_tracker-data.js`, do not add files to `functions/_tracker/`, and do
not open tracker PRs.** The PR flow is retired: even with dated changeset files, two runs still
collided on the one shared `CHANGESETS` line, and every merge waited on a human. Tracker
updates now follow the same path as `/guides` articles: **INSERT a draft row, 48h veto,
auto-publish.**

**Add one changeset row** to `tracker_changesets` in the v2 Supabase (`oqbpuspnmznqxgkmyzyb`):

```sql
insert into public.tracker_changesets (checked, slug, entries, note)
values (current_date, 'short-kebab-slug',
        $j$[ { "id": "existing-or-new-id", ...the whole entry... } ]$j$::jsonb,
        'one line on what changed + source URLs');
```

It lands as `status='draft'` and auto-publishes when `auto_publish_at` (now()+48h) passes —
an hourly pg_cron (`ai-tracker-auto-publish`) flips it; a veto in Command Center sets it
`archived`. The SSR fold (`loadTracker()` in `functions/_tracker-data.js`) merges published
rows on top of the repo's static baseline at request time, with the same semantics the file
flow had: an existing `id` is **replaced in place**, a new id is **appended**, and
`status: 'removed'` drops one. A protocol that DIED is not removed — it stays `dead`; the
graveyard is the whole point of this page.

**Never type `TRACKER_UPDATED`.** It is derived from the newest published `checked`.

The files in `functions/_tracker/` are the frozen historical baseline (last repo changeset:
2026-08-22). They still fold first; do not delete them, and do not add to them.

⚠ The 2026-08-22 changeset is a FILE because the weekly-refresh section below still described
the retired file flow, and that run followed it. The two halves of this document contradicted
each other for ten days. The DB row is the flow; the file is the exception that should not
recur.

## Entry rules — these are why anyone trusts this page

- Every factual claim (steward, version, date, status) traces to a source link in `links`. **If it
  cannot be sourced, it does not ship.**
- `call` is our editorial one-liner: dated judgment, plainly worded, and willing to say a thing is
  vendor-controlled or going nowhere.
- Statuses: `live` | `rising` | `early` | `watch` | `dead`.
- No emojis. Arrows and stars are typography and fine.

## Checks before opening a PR

```
node --check functions/_tracker-data.js
node --input-type=module -e "import {TRACKER,TRACKER_UPDATED} from './functions/_tracker-data.js'; \
  const ids=TRACKER.map(t=>t.id); \
  if (ids.length!==new Set(ids).size) throw new Error('duplicate id'); \
  console.log(TRACKER.length,'entries, updated',TRACKER_UPDATED)"
```

Every entry needs at least one link, and no two entries may share an `id`.

## The weekly refresh (from 2026-08-22)

The daily content engine was **deleted on purpose** — it burned API credits for a tracker that
does not change daily. There is no cron. The refresh is now a **manual in-session run**, which
costs James's Claude plan rather than API credit, and it happens **weekly**, not daily.

⛔ **The tracker went stale between 2026-08-13 and 2026-08-22** because the engine was removed and
nothing replaced it. If the newest file in `functions/_tracker/` is more than ~10 days old, that is
the first thing to fix.

**Why weekly and not daily:** a living document earns re-crawls, but only if the changes are real.
Bumping a date without a substantive change is the cosmetic-freshness pattern search engines
discount, and scaled daily publishing on a low-authority domain is what cost SideWRK its
impressions in the June core update. Change what actually changed; leave the rest alone.

**Run it by fetching primary sources directly, not by searching.** WebSearch has a per-session cap
(200) that is easy to exhaust; WebFetch does not share it, and a spec's own changelog beats a search
result anyway. The standing source list — check each for anything dated since the newest changeset:

- MCP spec + changelog — `modelcontextprotocol.io`, and the spec repo's releases
- OpenAI Apps SDK / Agent Plugins — `developers.openai.com/apps-sdk`
- A2A (Agent2Agent) — its spec repo releases
- LangGraph / CrewAI / AutoGen — release notes, for the framework-side entries
- Anything already in `_tracker/*.js` `links[]` — those are the pages that go stale

**A run INSERTs one row into `tracker_changesets`** — see the top of this file. It does not add
a file to `functions/_tracker/` and does not open a PR. `TRACKER_UPDATED` is derived, never typed.
Silence is a valid weekly result: saying "nothing moved this week" is more credible than
inventing movement.

⭐ **But re-verifying an entry is not silence — re-state it.** Each entry renders its OWN
`checked` date, stamped by `fold()` from the changeset that last wrote it. So an entry you
checked and found accurate keeps its old date unless you include it in the changeset row
unchanged. That restatement is the only thing that moves a row's date, which is exactly the
point: the date has to be earned. Never hand-write a `checked` field onto an entry for a
check you did not perform.

⭐ **The graveyard is the moat.** A protocol that died, got folded into something else, or quietly
stopped shipping is the entry nobody else maintains. Status changes (`rising` → `stalled` → dead)
are worth more than new rows.
