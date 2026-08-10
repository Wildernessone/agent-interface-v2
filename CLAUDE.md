# Agent Interface — repo context

The category reference site for "agent interfaces": a definitional hub at `/`, the living
`/tracker` (plus its `.json` twin), DB-driven `/guides`, and a daily content engine. Cloudflare
Pages Functions SSR + Supabase `oqbpuspnmznqxgkmyzyb`.

**Production deploys from `main` via Cloudflare Pages.** A merge to `main` ships. Work on a branch.

## ⭐ Updating the tracker — READ THIS BEFORE TOUCHING `functions/_tracker-data.js`

**Do not edit `functions/_tracker-data.js`, and do not edit any existing file in
`functions/_tracker/`.** That file is now a fold, not a list.

**Add one dated changeset**, `functions/_tracker/YYYY-MM-DD-<short-slug>.js`:

```js
export const checked = '2026-08-11'        // the day YOU verified these claims
export const entries = [
  { id: 'existing-id', /* ...the whole entry, rewritten... */ },   // refines in place
  { id: 'brand-new',   /* ...the whole entry... */ },              // appends
]
```

Then add its import and one array element to `CHANGESETS` in `_tracker-data.js`. That single line
is the only shared edit you make.

Folding is by `id`, in filename order: an existing id is **replaced while keeping its position**
(so a refinement never shuffles the page), a new id is **appended**, and `status: 'removed'` drops
one. A protocol that DIED is not removed — it stays with `status: 'dead'`. The graveyard is the
whole point of this page; nobody else tracks what died, and that is the moat.

**Never type `TRACKER_UPDATED`.** It is derived as the newest `checked` of any changeset, so it
cannot go stale and cannot be a merge conflict.

### Why it works this way

Every run used to edit the one file and bump the same `TRACKER_UPDATED` line. Each PR looked
mergeable on its own — GitHub tests a PR against `main`, never against its siblings — so on
2026-08-10 three of them had sat green for five days and then **all conflicted the moment the first
one landed**, every time on that same one-line date collision. Each had to be rebased by hand.

Adding a file instead of editing one means two runs on different days touch nothing in common.

⚠ **Two runs on the SAME day still collide** on the `CHANGESETS` list — static ESM cannot glob, so
that one line is the floor for this design. If that ever starts hurting, the real fix is moving the
tracker into Supabase the way `/guides` already works, and dropping the PR flow entirely.

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
