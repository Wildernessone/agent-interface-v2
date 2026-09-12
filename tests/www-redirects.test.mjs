/* www.agentinterface.app must 301 to the apex (2026-09-12). It served a full 200 COPY of the site
   while the canonical pointed at the apex — GA fired on both hosts and every www URL was an
   indexable duplicate. The other four portfolio sites already redirect.
   ⭐ This EXTRACTS the real branch out of functions/_middleware.js and runs it, rather than
   restating the condition here — a test that restates the logic agrees with itself, not the code.
   ⭐ A preview deployment cannot carry the www custom domain, so the host match cannot be proven on
   a preview URL; this is what CAN be proven pre-merge, and the live 301 is checked after deploy.
   Run: node tests/www-redirects.test.mjs */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('functions/_middleware.js', 'utf8')
/* ⚠ SHAPE-AGNOSTIC EXTRACTION, ON PURPOSE. The first version required `===`, so a mutation to
   startsWith('www.') failed at EXTRACTION ("branch is missing") instead of at the exact-match
   assertion below — red either way, but by the wrong mechanism, and a guard that works by accident
   is one refactor away from not working. This matches any hostname test so the assertions that
   follow are the ones doing the work. */
const m = src.match(/if \(url\.hostname[\s\S]*?\) \{[\s\S]*?\n {2}\}/)
assert.ok(m, 'the www redirect branch is missing from the middleware')
const branch = m[0]

/* ⛔ EXACT match, never a prefix: a startsWith('www.') test would also catch preview hosts, and
   agent-interface-v2.pages.dev plus the per-deployment URLs must keep serving so a preview can be
   walked. This is the assertion that keeps the next editor from "simplifying" it. */
assert.ok(/url\.hostname === 'www\.agentinterface\.app'/.test(branch),
  'the host test must be an exact === match on www.agentinterface.app')
assert.ok(!/startsWith\(|\.includes\(|\/\^www/.test(branch), 'the host test must not be a prefix or regex match')
assert.ok(/301/.test(branch), 'the redirect must be a permanent 301, not a 302')

/* RUN it. */
const run = new Function('url', branch + '\nreturn null')
const cases = [
  ['https://www.agentinterface.app/tracker?a=1#f', 'https://agentinterface.app/tracker?a=1#f', true],
  ['https://agentinterface.app/tracker',            null,                                      false],
  ['https://agent-interface-v2.pages.dev/tracker',  null,                                      false],
  ['https://diag2.agent-interface-v2.pages.dev/',   null,                                      false],
]
let n = 0
for (const [from, to, shouldRedirect] of cases) {
  const res = run(new URL(from))
  if (shouldRedirect) {
    assert.ok(res, `${from} should redirect`)
    assert.equal(res.status, 301, `${from} must be 301`)
    assert.equal(res.headers.get('location'), to, `${from} must preserve path and query`)
  } else {
    assert.equal(res, null, `${from} must NOT redirect`)
  }
  n++
  console.log('  ✓ ' + (shouldRedirect ? `301 ${from} → ${to}` : `passes through: ${from}`))
}

/* The redirect must answer before the crawler logging, or a redirect counts as a pageview. */
assert.ok(src.indexOf("url.hostname === 'www.agentinterface.app'") < src.indexOf("log(context, 'ai_crawls'"),
  'the redirect must come before the ai_crawls logging — a redirect is not a pageview')
console.log(`  ✓ it answers before the ai_crawls logging\n\nall ${n + 4} green`)
