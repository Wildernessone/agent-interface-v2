/* <lastmod> must be a CONTENT date, never the day a crawler asked (2026-10-06).
   The generator used to stamp "/", /tracker and /guides with `new Date()`, so on 2026-10-05 the
   sitemap said all three had just changed while the tracker had not moved since 2026-09-13 and no
   guide had been touched since 2026-08-14. Search engines learn to ignore a lastmod that moves
   without the page moving, and that cost lands on every URL in the file.
   HERMETIC: fetch is stubbed, so this runs with no network and its answers do not depend on the
   clock. The stub returns the same shapes the two real REST calls return.
   Run: node tests/sitemap-lastmod.test.mjs */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('functions/sitemap.xml.js', 'utf8')
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
assert.ok(!/new Date\s*\(/.test(code) && !/Date\.now\s*\(/.test(code),
  'sitemap.xml.js reads the clock again — a lastmod must come from the content, not from today')

const GUIDES = [
  { slug: 'newest-guide', published_at: '2026-08-14 02:58:25.214+00', updated_at: '2026-08-14 02:58:25.214+00' },
  { slug: 'edited-later', published_at: '2026-07-24 16:30:04+00', updated_at: '2026-08-02 10:00:00+00' },
  { slug: 'no-updated-at', published_at: '2026-07-20T09:00:00Z', updated_at: null },
  { slug: 'no-dates-at-all', published_at: null, updated_at: null },
]
const CHANGESETS = [
  { checked: '2026-08-27', entries: [{ id: 'mcp', name: 'MCP', group: 'protocol', status: 'live', statusLabel: 'Established', links: [['x', 'https://example.com']] }] },
  { checked: '2026-09-13', entries: [{ id: 'mcp', name: 'MCP', group: 'protocol', status: 'live', statusLabel: 'Established', links: [['x', 'https://example.com']] }] },
]
let calls = []
globalThis.fetch = async (url) => {
  const u = String(url)
  calls.push(u)
  const body = u.includes('/rest/v1/articles') ? GUIDES : u.includes('/rest/v1/tracker_changesets') ? CHANGESETS : []
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const { onRequest, buildSitemap } = await import('../functions/sitemap.xml.js')
const { HUB_CONTENT_CHANGED } = await import('../functions/index.js')

const xml = await (await onRequest()).text()
const lastmodOf = (path) => {
  const m = xml.match(new RegExp(`<loc>https://agentinterface\\.app${path.replace(/[/.]/g, '\\$&')}</loc>(<lastmod>([^<]+)</lastmod>)?`))
  assert.ok(m, `${path} is missing from the sitemap`)
  return m[2] || null
}

assert.ok(calls.some(u => u.includes('tracker_changesets')), 'the sitemap did not read the tracker — its date would be a guess')
assert.equal(lastmodOf('/tracker'), '2026-09-13', '/tracker must carry the tracker\'s own derived updated date')
const hubExpected = [HUB_CONTENT_CHANGED, '2026-09-13'].sort().pop()
assert.equal(lastmodOf('/'), hubExpected, '"/" must be the later of the hub copy date and the tracker date')
assert.equal(lastmodOf('/guides'), '2026-08-14', '/guides must be the newest guide\'s date')
assert.equal(lastmodOf('/guides/newest-guide'), '2026-08-14')
assert.equal(lastmodOf('/guides/edited-later'), '2026-08-02', 'updated_at wins over published_at')
assert.equal(lastmodOf('/guides/no-updated-at'), '2026-07-20', 'published_at is the fallback')
assert.equal(lastmodOf('/guides/no-dates-at-all'), null, 'no derivable date must OMIT lastmod, never invent one')
assert.equal(lastmodOf('/terms'), null)
assert.equal(lastmodOf('/privacy'), null)

/* An empty database must not make the dates up either. */
const empty = buildSitemap({ trackerUpdated: '', hubChanged: '', guides: [] })
assert.ok(!/<lastmod>/.test(empty), 'with nothing to derive from, no URL may carry a lastmod')

/* The two URLs that must never come back. */
assert.ok(!/\/library</.test(xml), '/library is in the sitemap')
assert.ok(!/\/council/.test(xml), 'a /council URL is in the sitemap')

const dated = (xml.match(/<lastmod>/g) || []).length
const total = (xml.match(/<url>/g) || []).length
console.log(`\n  ${total} URL(s) rendered from stubbed data; ${dated} carry a derived lastmod, ${total - dated} omit it`)
console.log('  ✓ every lastmod traces to content (tracker / hub copy / article row); none to the clock')
