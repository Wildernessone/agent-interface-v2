/* A guide body must start at h2, never jump h1 -> h3 (2026-09-14).
   Measured against all 26 published guides: 22 rendered <h1> and then went straight to h3
   with NO h2 anywhere in the body. The cause was one expression in mdToHtml, a per-line
   clamp (hashes + 1, capped at 4), so a body written in ##/### could only ever start at h3.
   The four that were correct (acp-one-year-in…, mcp-goes-stateless…, undo-for-agents…,
   what-to-log…) got their h2 from a body-level single #.
   ⛔ The fix is DOCUMENT-RELATIVE, not a floor: clamping every line to a minimum of h2 would
   flatten those four (their # and ## would both land on h2). The shallowest level present in
   a body maps to h2 and deeper levels descend from there, so both shapes come out right.
   ⛔ mdToHtml must never emit an h1: the page's only h1 is the article title, rendered by
   functions/guides/[slug].js outside this function.
   Why two fixtures cover the whole corpus: read straight from the articles table, all 26
   published bodies use exactly one of two shapes -- 22 are ## only, 4 are # plus ##. No body
   uses ####, indented hashes, five hashes, or a code fence. The deeper cases below are
   therefore about future bodies, not present ones.
   Run: node tests/guide-heading-depth.test.mjs
   Red run (proves these assertions discriminate): copy functions/_site.js, restore the old
   per-line clamp in the copy, and point SITE_MODULE at it. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MOD = process.env.SITE_MODULE || '../functions/_site.js'
const { mdToHtml } = await import(MOD)

const levels = html => [...html.matchAll(/<h([1-6])>/g)].map(m => Number(m[1]))
const cases = []
const check = (name, md, want) => {
  const got = levels(mdToHtml(md))
  cases.push(name)
  assert.deepEqual(got, want, `${name}\n    markdown: ${JSON.stringify(md)}\n    want h${want.join(',h')}  got h${got.join(',h') || '(none)'}`)
}

/* 1. The 22-guide shape: a flat body written entirely in ##. Every section is a sibling,
      so every one is an h2. This is the assertion the shipped bug failed. */
check('flat ## body -> all h2',
  '## One\n\ntext\n\n## Two\n\ntext\n\n## Three', [2, 2, 2])

/* 2. The same shape one level deeper. Absolute depth is not the point; relative is. */
check('flat ### body -> all h2', '### One\n\n### Two', [2, 2])

/* 3. Two levels starting at ##. */
check('##/### body -> h2/h3', '## Section\n\n### Detail\n\n## Section two', [2, 3, 2])

/* 4. The four-guide shape that was ALREADY correct and must not change or flatten. */
check('#/## body -> h2/h3 (must not flatten)',
  '# Lead\n\n## One\n\n## Two\n\n## Three', [2, 3, 3, 3])

/* 5. Three and four levels from a body-level #. Capped at h4, as before the fix. */
check('#/##/### body -> h2/h3/h4', '# A\n\n## B\n\n### C', [2, 3, 4])
check('#/##/###/#### body -> h2/h3/h4/h4 (clamped)', '# A\n\n## B\n\n### C\n\n#### D', [2, 3, 4, 4])

/* 6. A single heading, whatever its depth, is an h2. */
check('lone # -> h2', '# Only', [2])
check('lone ## -> h2', '## Only', [2])
check('lone #### -> h2', '#### Only', [2])

/* 7. Out-of-order depths: the SHALLOWEST present sets the datum, not the first seen. */
check('deep first, shallow later', '### Deep\n\n# Shallow\n\n### Deep again', [4, 2, 4])

/* 8. Not headings, and the renderer must still agree with itself about that. Five hashes
      and indented hashes fail the heading regex, so they are paragraph text — the scan uses
      the very same regex, so it cannot set a datum off a line the renderer will not head. */
assert.equal(levels(mdToHtml('##### Five\n\n  ## Indented')).length, 0, 'five hashes / indented hashes are not headings')
assert.match(mdToHtml('##### Five'), /<p>/, 'a five-hash line should render as a paragraph')
const mixed = mdToHtml('  ## Indented\n\n## Real\n\n### Sub')
assert.deepEqual(levels(mixed), [2, 3], 'an indented line must not lower the datum for real headings')

/* 9. NEVER an h1, on any input. */
const h1probe = ['# A', '# A\n## B', '## A', '### A\n#### B', '#### A', '# A\n\n# B\n\n## C']
for (const md of h1probe) {
  const got = levels(mdToHtml(md))
  assert.ok(!got.includes(1), `mdToHtml emitted an h1 for ${JSON.stringify(md)} — the article title is the only h1`)
  assert.ok(got.every(l => l >= 2 && l <= 4), `levels out of the 2..4 range for ${JSON.stringify(md)}: ${got}`)
}

/* 10. The first heading of a body is always h2 whenever the body has any heading. */
for (const md of ['## a', '### a\n\n### b', '# a\n\n## b', '#### a']) {
  assert.equal(levels(mdToHtml(md))[0], 2, `first heading is not h2 for ${JSON.stringify(md)}`)
}

/* 11. Headings interact with the rest of the hand-rolled pass — lists, tables, hr, inline,
       blockquote, paragraph runs — so prove the two-pass change did not disturb them. */
const rich = mdToHtml([
  '## Heading with `code` and **bold**',
  '',
  '- one',
  '- two',
  '',
  '1. first',
  '2. second',
  '',
  '---',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '> quoted',
  '',
  'A paragraph that',
  'wraps two lines.',
  '### Sub right after a paragraph',
].join('\n'))
for (const frag of ['<h2>', '<code>code</code>', '<strong>bold</strong>', '<ul>', '<li>one</li>', '<ol>', '<li>first</li>', '<hr>',
  '<div class="tbl"><table><thead><tr><th>a</th>', '<td>1</td>', '<blockquote>quoted</blockquote>',
  '<p>A paragraph that wraps two lines.</p>', '<h3>Sub right after a paragraph</h3>']) {
  assert.ok(rich.includes(frag), `the rich-body render lost ${frag}`)
}
assert.ok(!/<h[14-6]>/.test(rich), 'the rich body should be h2/h3 only')

/* 12. An escaping spot-check, since headings run through inline() which escapes first. */
assert.ok(mdToHtml('## <script>x</script>').includes('&lt;script&gt;'), 'heading text must stay escaped')

/* Anti-vacuity: if the level extractor stopped matching, every deepEqual above would
   compare [] to [] and this file would pass while proving nothing. */
assert.ok(cases.length >= 9, `only ${cases.length} heading cases ran`)
assert.ok(levels('<h2>a</h2><h3>b</h3>').length === 2, 'the level extractor itself is broken — every case above would be vacuous')

/* The module under test really is the shipped one unless deliberately overridden. */
if (!process.env.SITE_MODULE) {
  const src = readFileSync('functions/_site.js', 'utf8')
  const code = src.split('\n').filter(l => !l.trim().startsWith('//'))
  assert.ok(code.some(l => l.includes('const hLevel = n =>')), 'functions/_site.js has no document-relative heading map')
  assert.ok(!code.some(l => l.includes('m[1].length + 1')), 'the old per-line heading clamp is back in functions/_site.js')
}

console.log(`\n  ran ${cases.length} heading-shape case(s) + ${h1probe.length} no-h1 probe(s) against ${MOD}`)
console.log('  ✓ every body starts at h2, #/## bodies keep h2/h3, no input yields an h1')
