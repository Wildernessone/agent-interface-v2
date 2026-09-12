/* Method-specific Pages Function handlers DO NOT ROUTE in this project (2026-09-12).
   Every function exporting onRequestGet returned 404 in production — /tracker, /guides,
   /guides/<slug>, /sitemap.xml, /llms.txt, /tracker.json, /guides-feed.xml — while the three
   exporting bare onRequest (library, feed.xml, mcp) served normally. 8 of 8. /mcp answering 405
   proved the runtime was fine, and a preview with ONE file renamed brought /tracker back to 200.
   The homepage was the cruel part: it links /tracker and /guides, and its own function was broken
   too — but the build prerenders the landing into dist/index.html, and a static file beats a
   function, so the front door looked healthy while everything behind it 404'd.
   ⚠ Matches the EXPORT, not the word: tracker.js explains this in a comment that necessarily
   contains the forbidden name, and a grep for the string would flag its own documentation.
   Run: node tests/handlers-route.test.mjs */
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const files = []
;(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (e.endsWith('.js')) files.push(p)
  }
})('functions')

/* export [async] function onRequestGet/Post/... — or the const form. */
const METHODY = /export\s+(?:async\s+)?(?:function|const)\s+onRequest(Get|Post|Put|Patch|Delete|Head|Options)\b/g
const offenders = [], routed = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const base = f.split('/').pop()
  const isRoutable = !base.startsWith('_') && !f.includes('/_')
  for (const m of src.matchAll(METHODY)) offenders.push(`${f}: exports onRequest${m[1]}`)
  if (isRoutable && /export\s+(?:async\s+)?(?:function|const)\s+onRequest\b(?!Get|Post|Put|Patch|Delete|Head|Options)/.test(src)) routed.push(f)
}

console.log(`\n  walked ${files.length} file(s) under functions/; ${routed.length} export a routable onRequest`)
assert.ok(files.length > 5, `only ${files.length} files walked — the sweep broke, which would make this vacuous`)
assert.ok(offenders.length === 0,
  'method-specific handlers do not route in this project — they 404 silently:\n    ' + offenders.join('\n    '))
/* Every non-underscore .js under functions/ is a route and must export something routable. */
const missing = files.filter(f => {
  const base = f.split('/').pop()
  if (base.startsWith('_') || f.includes('/_')) return false
  return !/export\s+(?:async\s+)?(?:function|const)\s+onRequest\b/.test(readFileSync(f, 'utf8'))
})
assert.ok(missing.length === 0, 'these routes export no handler at all: ' + missing.join(', '))
console.log('  ✓ every route exports a bare onRequest; none is method-specific')
