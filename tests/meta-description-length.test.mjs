/* A route's meta description must fit the SERP (2026-09-14). functions/_site.js has promised
   "description <=155" in its header comment since the site was built, and nothing checked it:
   the homepage shipped 170 chars, so Google cut the sentence mid-definition and dropped the
   whole second half — "and the protocols it uses to operate software" — which is half of what
   the page exists to define.
   The homepage assertions below are deliberately not just a length: a trim that fits by
   deleting one side of the definition would pass a length check and lose the point.
   ⚠ Denominator: this parses single-quoted description literals under functions/. It does NOT
   cover template-literal descriptions, or /guides/<slug>, whose description is derived from DB
   content and already hard-capped with .slice(0, 155).
   Run: node tests/meta-description-length.test.mjs */
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIMIT = 155
const ROOT = process.env.FUNCTIONS_DIR || 'functions'
const files = []
;(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (e.endsWith('.js')) files.push(p)
  }
})(ROOT)

/* `const desc = '...'` and `desc: '...'`, single-quoted, escapes allowed. */
const LIT = /(?:const\s+desc\s*=|desc:)\s*'((?:[^'\\]|\\.)*)'/g
const found = []
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(LIT)) found.push({ file: f, text: m[1] })
}

const tooLong = found.filter(d => d.text.length > LIMIT)
console.log(`\n  parsed ${found.length} description literal(s) across ${files.length} file(s) under ${ROOT}/`)
for (const d of found) console.log(`    ${String(d.text.length).padStart(4)}  ${d.file}`)

/* Anti-vacuity: an empty or shrunken harvest would make every assertion below pass for free. */
assert.ok(found.length >= 3, `only ${found.length} description literals parsed — the matcher broke, which would make this vacuous`)
assert.ok(found.some(d => d.file.endsWith('index.js')),
  'no homepage description literal was parsed — this test is not looking at the thing it guards')
assert.match(readFileSync(join(ROOT, 'index.js'), 'utf8'), /const DEFINITION = '/,
  'the homepage has no DEFINITION constant — the checks below would be measuring nothing')

assert.ok(tooLong.length === 0,
  `description over ${LIMIT} chars, the SERP will truncate it:\n    ` +
  tooLong.map(d => `${d.file} (${d.text.length}): ${d.text}`).join('\n    '))

/* ⭐ THE HOMEPAGE HAS TWO STRINGS AND THE RELATIONSHIP BETWEEN THEM IS THE CHECK.
   DEFINITION is the site's canonical sentence — the DefinedTerm node publishes it and the page
   says it in its own words. `desc` is the SERP-fitted snippet. The first version of this test
   pinned two verbatim tails on `desc`, which a review pointed out is backwards: it FORCED whatever
   opening clause happened to be there and would still pass a rewrite that replaced the definition
   with a different claim, as long as the two tails survived. So instead:
     1. DEFINITION is pinned verbatim (this site's whole claim is being the reference for the term);
     2. `desc` must be a CONTIGUOUS SUBSTRING of DEFINITION, ignoring its leading capital — which
        makes it structurally impossible for the snippet to say anything the canonical does not;
     3. the DefinedTerm node must publish DEFINITION, never the snippet. */
const idx = readFileSync(join(ROOT, 'index.js'), 'utf8')
const CANON = 'An agent interface is the layer where an AI agent meets everything outside the model: the controls humans use to direct it, and the protocols it uses to operate software.'
const def = (idx.match(/const DEFINITION = '((?:[^'\\]|\\.)*)'/) || [])[1]
assert.equal(def, CANON, 'the canonical definition changed — that is a decision, not a trim, and it needs the page and this pin updated together')
const home = found.find(d => d.file.endsWith('index.js') && d.text.length <= LIMIT && CANON.toLowerCase().includes(d.text.toLowerCase()))
assert.ok(home, 'no homepage description literal is a substring of the canonical definition')
const snippet = home.text
assert.ok(CANON.toLowerCase().includes(snippet.toLowerCase()),
  `the snippet is not lifted from the canonical definition — it says something the definition does not:\n    ${snippet}`)
assert.ok(snippet.includes('the controls humans use to direct it'), 'the human-control half of the definition is gone from the snippet')
assert.ok(snippet.includes('the protocols it uses to operate software'), 'the protocol half of the definition is gone from the snippet')
assert.match(idx, /description: DEFINITION\b/, 'the DefinedTerm node must publish the canonical definition, not the snippet-fitted one')

/* The title is 54 chars and was not in scope; this pins it so a future trim does not drift. */
const title = (readFileSync(join(ROOT, 'index.js'), 'utf8').match(/title:\s*'((?:[^'\\]|\\.)*)'/) || [])[1]
assert.ok(title && title.length <= 60, `homepage title missing or over 60 chars: ${title && title.length}`)

console.log(`  ✓ ${found.length} descriptions within ${LIMIT}; the ${snippet.length}-char snippet is lifted verbatim from the ${def.length}-char canonical definition; title ${title.length} chars`)
