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
2026-08-13). They still fold first; do not delete them, and do not add to them.

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
