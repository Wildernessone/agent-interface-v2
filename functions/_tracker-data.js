// The tracker's data, folded from dated changesets in ./_tracker/.
//
// WHY IT IS SPLIT. Every daily engine run used to edit this one file, and every
// run bumped the same TRACKER_UPDATED line. Each pull request looked mergeable
// on its own — GitHub tests a PR against main, not against its siblings — so
// three of them sat green for five days and then all conflicted the moment the
// first one landed. On 2026-08-10 that had to be untangled by hand, rebasing
// each in turn onto what was, every time, a one-line date collision.
//
// So: a run ADDS a dated file and never edits an existing one, and the freshness
// date is DERIVED from those files rather than typed. Two runs on different days
// now touch nothing in common.
//
// HOW A CHANGESET WORKS. Each ./_tracker/YYYY-MM-DD-<slug>.js exports:
//
//   export const checked = '2026-08-11'      // the day the claims were verified
//   export const entries = [ ... ]           // whole entries, in the usual shape
//
// Folding is by `id`, in filename order:
//   - an id already present is REPLACED, keeping its original position, so a
//     refinement to an entry does not shuffle the page;
//   - a new id is appended;
//   - `status: 'removed'` drops an entry, for the rare case where something
//     turns out never to have existed. A dead protocol is NOT removed — it stays
//     with status 'dead', because the graveyard is the whole point of this page.
//
// TRACKER_UPDATED is the newest `checked` of any file that contributed. It is
// not typed by hand, so it cannot go stale and cannot be a merge conflict.
//
// The exported surface — { TRACKER, TRACKER_UPDATED } — is unchanged; functions/
// index.js, tracker.js and tracker.json.js import it exactly as before, and the
// rendered output was verified byte-identical across the split.
//
// ADDING A FILE. Static ESM cannot glob, so a new changeset needs one import
// line and one array element below. That is the only shared edit a run makes,
// and it is the only place two same-day runs can still collide.

import * as baseline_2026_08_10 from './_tracker/2026-08-10-baseline.js'
import * as mcp_apps_2026_08_11 from './_tracker/2026-08-11-mcp-apps.js'
import * as openai_apps_to_plugins_2026_08_13 from './_tracker/2026-08-13-openai-apps-to-plugins.js'
import * as agent_plugins_2026_08_22 from './_tracker/2026-08-22-agent-plugins-1-1-draft.js'

// Oldest first. Append new changesets at the end.
const CHANGESETS = [
  baseline_2026_08_10,
  mcp_apps_2026_08_11,
  openai_apps_to_plugins_2026_08_13,
  agent_plugins_2026_08_22,
]

function fold(changesets) {
  const order = []           // ids, in the order they first appeared
  const byId = new Map()
  let newest = ''

  for (const cs of changesets) {
    if (!cs || !Array.isArray(cs.entries)) continue
    if (typeof cs.checked === 'string' && cs.checked > newest) newest = cs.checked
    for (const entry of cs.entries) {
      if (!entry || !entry.id) continue
      if (entry.status === 'removed') { byId.delete(entry.id); continue }
      if (!byId.has(entry.id)) order.push(entry.id)
      // Stamp the entry with the date IT was last written, unless it carries its own.
      // The row template renders `t.checked || TRACKER_UPDATED`, and nothing ever set
      // the per-entry field — so every row inherited the NEWEST changeset's date. On
      // 2026-08-22 a run that verified three entries, and said so plainly in its own
      // header, made all 28 rows read "checked 2026-08-22". Claiming a check we did
      // not perform is the one thing this page cannot afford. A date that lags is
      // safe; a date that overstates is not. So: a run that re-verifies an entry
      // without changing it should still re-state it in a changeset — that restatement
      // is what moves the date, and it is the only thing that should.
      byId.set(entry.id, entry.checked ? entry : { ...entry, checked: cs.checked })
    }
  }
  return { entries: order.map(id => byId.get(id)).filter(Boolean), newest }
}

const folded = fold(CHANGESETS)

// The static fold — the repo baseline alone. Kept as the fail-open floor: if the
// DB is unreachable the site serves the last-merged state, never an error.
export const TRACKER = folded.entries
export const TRACKER_UPDATED = folded.newest

// ── The LIVE fold (2026-08-13): repo baseline + published DB changesets. ──
// Daily updates stopped being PRs — the engine INSERTs a draft row into
// tracker_changesets (v2 Supabase) and the same 48h-veto auto-publish that runs
// /guides flips it live; James vetoes from Command Center. The repo keeps the
// historical baseline; rows fold ON TOP in (checked, created_at) order, so the
// same id-replace/append/'removed' semantics apply unchanged.
import { sbRows } from './_site.js'

export async function loadTracker() {
  try {
    const rows = await sbRows(
      'tracker_changesets?select=checked,entries,created_at&status=eq.published&order=checked.asc,created_at.asc',
    )
    if (!rows.length) return { TRACKER, TRACKER_UPDATED }
    const db = rows.map((r) => ({ checked: r.checked, entries: r.entries }))
    const live = fold(CHANGESETS.concat(db))
    return { TRACKER: live.entries, TRACKER_UPDATED: live.newest }
  } catch (_e) {
    return { TRACKER, TRACKER_UPDATED }
  }
}
