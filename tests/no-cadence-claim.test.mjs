/* No rendered page claims a refresh cadence the site does not keep (2026-10-06).
   The tracker is refreshed by hand, weekly at best and on no fixed clock (repo CLAUDE.md: "There
   is no cron ... it happens weekly, not daily"). "Continuously" was softened in the footer, hub,
   /tracker meta, 404 and llms.txt — and "Tracking this space daily" survived on every
   /guides/<slug> page because no check rendered a guide page. This renders one.
   It also pins the hub to ONE date: the visible "updated" line must equal HUB_CONTENT_CHANGED,
   the same constant the sitemap's <lastmod> for "/" reads.
   HERMETIC: fetch is stubbed. Run: node tests/no-cadence-claim.test.mjs */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const ARTICLE = {
  slug: 'sample-guide', title: 'Sample guide', dek: 'A sample.', body_md: '## A heading\n\nBody text.',
  hero_image: null, tags: [], published_at: '2026-07-24T16:30:04Z', updated_at: '2026-08-02T10:00:00Z',
}
globalThis.fetch = async (url) => {
  const u = String(url)
  const body = u.includes('/rest/v1/articles') ? [ARTICLE] : []
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const CADENCE = /\b(daily|continuously|continuous|every day|real[- ]time)\b/i
/* The tracker's own entries legitimately use these words about the THINGS they describe ("agents
   that run continuously in the background"). Those strings are data, not a claim about this site,
   so every entry text field is cut out (raw, HTML-escaped and JSON-escaped) before matching. What
   remains is the site's own chrome and copy, including meta descriptions and JSON-LD. */
const { esc } = await import('../functions/_site.js')
const { loadTracker } = await import('../functions/_tracker-data.js')
const { TRACKER } = await loadTracker()
assert.ok(TRACKER.length > 0, 'the tracker baseline did not load — the entry-text cut below would be vacuous')
const entryText = [...new Set(TRACKER.flatMap(t => Object.values(t).filter(v => typeof v === 'string' && v.length > 20)))]
const visible = (html) => {
  let out = html.replace(/<style[\s\S]*?<\/style>/g, '')
  for (const t of entryText) for (const form of [t, esc(t), JSON.stringify(t).slice(1, -1)]) out = out.split(form).join('')
  return out
}

const checks = {}
const { onRequest: guide } = await import('../functions/guides/[slug].js')
const gres = await guide({ request: new Request('https://agentinterface.app/guides/sample-guide'), params: { slug: 'sample-guide' }, env: {} })
assert.equal(gres.status, 200, 'the guide page did not render — the check below would be vacuous')
checks['/guides/sample-guide'] = await gres.text()
assert.ok(checks['/guides/sample-guide'].includes('Sample guide') && /href="\/tracker"/.test(checks['/guides/sample-guide']),
  'the guide render lost its title or its tracker link — the check would be vacuous')

for (const [route, mod] of [['/', '../functions/index.js'], ['/tracker', '../functions/tracker.js'], ['/guides', '../functions/guides/index.js']]) {
  const { onRequest } = await import(mod)
  checks[route] = await (await onRequest({ request: new Request('https://agentinterface.app' + route), params: {}, env: {} })).text()
}
const { onRequest: llms } = await import('../functions/llms.txt.js')
checks['/llms.txt'] = await (await llms({ request: new Request('https://agentinterface.app/llms.txt'), params: {}, env: {} })).text()
for (const f of readdirSync('public').filter(f => f.endsWith('.html') && f !== 'index.html')) {
  checks['public/' + f] = readFileSync('public/' + f, 'utf8')
}

for (const [where, html] of Object.entries(checks)) {
  const m = visible(html).match(CADENCE)
  assert.ok(!m, `${where} claims a refresh cadence: "${m && m[0]}"`)
}

/* One hub date. */
const { HUB_CONTENT_CHANGED } = await import('../functions/index.js')
const shown = checks['/'].match(/class="meta-line">updated (\d{4}-\d{2}-\d{2})/)
assert.ok(shown, 'the hub lost its visible "updated" line — the date check would be vacuous')
assert.equal(shown[1], HUB_CONTENT_CHANGED, 'the hub shows a different "updated" date than the sitemap lastmod reads')

console.log(`\n  rendered ${Object.keys(checks).length} surfaces incl. a /guides/<slug> page`)
console.log(`  ✓ no cadence claim; hub "updated" ${shown[1]} = HUB_CONTENT_CHANGED`)
