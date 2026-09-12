/* The sitemap must not advertise a noindexed URL (2026-09-12, same class as the SideWRK #377
   llms.txt↔noindex truth). /library served 200 + `noindex,follow` AND sat in sitemap.xml: we were
   asking Google to spend crawl budget being told not to index it.
   ⭐ It had a real reason once — it was the crawl path to the /council verdicts so Google could see
   THEIR noindex. Those were deleted 2026-09-09, so the reason died with them: /library now serves
   zero /council links and every /council/<slug> is 404.
   ⛔ The page stays noindex and stays live. This guards the SITEMAP, not the robots policy.
   Run: node tests/sitemap-no-noindex.test.mjs */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const src = readFileSync('functions/sitemap.xml.js', 'utf8')
const core = [...src.matchAll(/\[\s*'(\/[^']*)'\s*,/g)].map(m => m[1])

/* Which function serves a path. DB-driven /guides/<slug> rows cannot be resolved statically, so
   they are OUT OF SCOPE and that is stated rather than silently skipped. */
const resolve = p => {
  const bare = p.replace(/^\//, '').replace(/\/$/, '')
  /* ⚠ A LISTED PATH MAY BE A STATIC FILE, NOT A FUNCTION. The first version of this resolver only
     looked under functions/, so /terms and /privacy came back unresolved — and because this check
     is fail-closed they FAILED rather than being skipped, which is how the gap was found. Both are
     served from public/*.html. Static first would be wrong: a function shadows nothing, but a
     static file DOES win over a function in Pages, so check both and prefer whichever exists. */
  const cands = bare === ''
    ? ['functions/index.js', 'public/index.html']
    : [`functions/${bare}.js`, `functions/${bare}/index.js`, `public/${bare}.html`, `public/${bare}/index.html`]
  return cands.find(existsSync) || null
}

const problems = []
let checked = 0, unresolved = 0
for (const p of core) {
  const f = resolve(p)
  /* ⛔ FAIL-CLOSED: a listed path this cannot resolve is a failure, not a skip. An unresolvable
     entry is how a check like this quietly stops covering the file it is named for. */
  if (!f) { unresolved++; problems.push(`${p}: listed in the sitemap but resolves to no function — fail-closed`); continue }
  checked++
  if (/<meta name="robots" content="[^"]*noindex/i.test(readFileSync(f, 'utf8'))) {
    problems.push(`${p} (${f}): in the sitemap but the page emits noindex`)
  }
}

console.log(`\n  sitemap lists ${core.length} static path(s); resolved and checked ${checked}; unresolved ${unresolved}`)
console.log('  ⚠ out of scope: DB-driven /guides/<slug> entries cannot be resolved from the repo')
assert.ok(core.length >= 3, `only ${core.length} paths parsed — the matcher broke, which would make this vacuous`)
assert.ok(problems.length === 0, 'the sitemap advertises a page we tell Google not to index:\n    ' + problems.join('\n    '))
/* The specific regression this came from. */
assert.ok(!core.includes('/library'), '/library is back in the sitemap while still noindex')
console.log('  ✓ no listed path emits noindex, and /library is not listed')
