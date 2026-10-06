/* No page links /library, and /library itself stays a 200 + noindex,follow stub (2026-10-06).
   The Library indexed the council verdicts, which were deleted 2026-09-09. After that the primary
   nav and the footer on every page still sent visitors to a page announcing there was nothing
   there, and the footer, the hub FAQ, the feed and the Terms all still described an "archive of
   verdicts" that no longer existed.
   This renders the shared shell rather than grepping it, because a link is what the page emits,
   not what the source happens to spell.
   Run: node tests/nav-no-library.test.mjs */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// No network: the hub reads the tracker; a failing fetch makes loadTracker fall back to the
// repo baseline, which is all the render needs.
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })

const LIB = /href="(?:https:\/\/agentinterface\.app)?\/library\/?"/

const { page } = await import('../functions/_site.js')
const shell = await page({ title: 't', desc: 'd', path: '/', body: '<p>x</p>' }).text()   // page() returns a Response
assert.ok(!LIB.test(shell), 'the shared nav/footer still links /library')
assert.ok(/href="\/tracker"/.test(shell) && /href="\/guides"/.test(shell), 'the nav lost Tracker or Guides — the render broke, which would make this vacuous')

const rendered = {}
for (const [route, mod] of [['/', '../functions/index.js'], ['/tracker', '../functions/tracker.js'], ['/guides', '../functions/guides/index.js']]) {
  const { onRequest } = await import(mod)
  const res = await onRequest({ request: new Request('https://agentinterface.app' + route), params: {}, env: {} })
  rendered[route] = await res.text()
  assert.ok(!LIB.test(rendered[route]), `${route} links /library`)
  assert.ok(!/\bLibrary\b/.test(rendered[route].replace(/<script[\s\S]*?<\/script>/g, '')), `${route} still names "Library" in its visible text or markup`)
}

/* Static pages and the feed. */
for (const f of readdirSync('public').filter(f => f.endsWith('.html'))) {
  assert.ok(!LIB.test(readFileSync('public/' + f, 'utf8')), `public/${f} links /library`)
}
const { onRequest: feed } = await import('../functions/feed.xml.js')
const rss = await (await feed()).text()
assert.ok(!/\/library</.test(rss) && !/remain readable/.test(rss), 'feed.xml still points at the Library or says the verdicts are readable')

/* The stub itself: still answers, still noindex,follow. */
const { onRequest: lib } = await import('../functions/library/index.js')
const res = await lib()
assert.equal(res.status, 200, '/library must stay 200 for old bookmarks')
assert.ok(/<meta name="robots" content="noindex,follow">/.test(await res.text()), '/library lost its noindex,follow')

console.log(`\n  rendered the shell + ${Object.keys(rendered).length} routes, ${readdirSync('public').filter(f => f.endsWith('.html')).length} static page(s) and feed.xml`)
console.log('  ✓ nothing links /library; /library answers 200 with noindex,follow')
