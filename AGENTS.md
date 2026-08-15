# AGENTS.md — working in this repo

Agent Interface: the category reference site for "agent interfaces". A definitional hub at `/`,
the living `/tracker` (plus its `.json` twin), DB-driven `/guides`, and a daily content engine.
Cloudflare Pages Functions SSR + Supabase `oqbpuspnmznqxgkmyzyb`. `agentinterface.app`.

**`CLAUDE.md` in this repo is the detailed spec — read it first.** This file is the short
orientation and the things that will bite a fresh session.

## What this is, and what it is not

The multi-model panel APP was **RETIRED in the July 2026 pivot**. There is no `/app`, no `/login`,
no `/studio`. Do not restore them, and do not write copy implying an app exists. What remains is a
reference site whose value is that the tracker is honest and current.

**The asset thesis:** hold and compound. On 2026-08-14 a panel judged flipping it 4–6 against
9/9/8.5 for holding — GSC showed **position 22 for "agent interface" in 20 days** with impressions
accelerating, which is the opposite of SideWRK's months at 44–77. Kill checkpoints: **11/15 and
2/15**. The retired app's user data (BYOK keys, conversations, projects, 2 auth users) was
**scrubbed 2026-08-14** so no future sale can include it — do not reintroduce user storage.

⛔ **Money never touches a tracker entry.** The revenue ladder (AI-tooling affiliates, paid
listings, sponsors) must never influence what the tracker says about a protocol. That independence
IS the asset; the day it bends, there is nothing to sell.

## The two things most likely to break

**1. Tracker updates are DB ROWS, not PRs.** Do not edit `functions/_tracker-data.js`, do not add
files to `functions/_tracker/`, and do not open tracker PRs — that flow is retired because two runs
collided on one shared `CHANGESETS` line and every merge waited on a human. Instead `INSERT` a
changeset row into `tracker_changesets`; it lands as `draft` and auto-publishes after 48h via
pg_cron, with a veto card in Command Center. **Never type `TRACKER_UPDATED`** — it is derived from
the newest published `checked`. Full SQL in `CLAUDE.md`.

**2. Production deploys from `main`.** A merge ships. Work on a branch and let James merge.

## Standing rules

- **A dead protocol stays `dead`, it is never removed.** The graveyard of abandoned agent
  protocols is the reason anyone trusts this page.
- **No emojis in anything shipped.** SVG icons or typography only.
- **No fabricated proof** — no adoption numbers, no "widely used", no invented traction. Every
  claim about a protocol needs a source, the same bar the other repos hold for competitor claims.
- **Capability LISTS read `<Product> <verb> <object>`** with a distinct verb each, subject position
  varied ~4:1. ⛔ Never in flowing prose. See auto-memory `entity-first-copy`.

## When you ship, update the machine-readable files

`robots.txt`, `llms.txt` and this file are how models and crawlers learn what this site is — and
for a site whose entire purpose is being cited by models, that is not bookkeeping, it is the
product surface.

**A stale `llms.txt` is worse than none: it is a confident wrong answer handed to the systems you
most want citing you.** Same day, elsewhere: MadeKeeper's told models a feature was "almost ready"
hours after it shipped; SideWRK's never mentioned a feature shipped two days earlier. Neither
showed up in an audit that checked the files EXIST — only by reading what they SAY.

`robots.txt` here already names the AI crawlers explicitly. Keep it that way, and re-read
`llms.txt` whenever the tracker's scope, the guides, or the site's structure changes.
See auto-memory `ship-the-machine-readable-files`.
