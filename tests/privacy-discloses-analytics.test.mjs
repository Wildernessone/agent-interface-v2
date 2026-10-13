/* The privacy policy must name every analytics script the pages load (2026-10-13).
   public/privacy.html said "There is no advertising network, no analytics vendor, and no
   third-party tracking script on any page". True when written on 2026-08-01; false from 2026-08-20
   (Microsoft Clarity, PR #143) and again from 2026-09-07 (Google Analytics 4, PR #148). Both PRs
   added their script to the <head> of privacy.html itself, above the sentence denying it, and
   neither touched the sentence. Nothing read the policy against the code, so this does.

   What it checks, against the SOURCES the site is served from (public/**.html and every
   functions/**.js that emits a whole HTML document):
     1. If any page loads /ga.js, the policy's visible text names Google Analytics, the measurement
        ID actually in public/ga.js, and the _ga cookie. Same for /clarity.js → Microsoft Clarity,
        _clck, _clsk. And the reverse: a policy that names a tool no page loads is also wrong.
     2. The policy and the Terms' privacy summary carry no denial of third-party analytics.
     3. The policy's page-scope claims still hold: "every page except the retired Library notice"
        loads both tools, and our own beacon runs "on the hub, the tracker and the guides". A new
        page template, or a new page() caller, fails here until the sentence is re-checked.
     4. The beacon's storage keys the policy names (cc_anon_id, cc_session_id) are the ones the
        beacon actually writes.
     5. Where Clarity loads (added 2026-10-13). functions/clarity.js.js answers /clarity.js and skips
        the EEA, the UK, Switzerland and unknown countries. While it exists, the policy must say
        Clarity does not load for those visitors, and every place that sentence names must really be
        skipped by the function. If the function is gone, the policy must stop saying it.
   ⚠ Comments are stripped before reading the policy: its own header comment quotes the old denial
     on purpose, and a check that matched it would fail the fix.
   ⚠ Denominator: public/**.html + functions/**.js. Out of scope, stated rather than skipped: the
     repo-root index.html (the retired app's Vite entry; /index.html 308s to / on production,
     verified 2026-10-13) and src/ (the retired app). Vendor facts (cookie lifetimes, IP handling,
     retention) are sourced by link in the page and cannot be checked from here.
   Run: node tests/privacy-discloses-analytics.test.mjs */
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PRIVACY = process.env.PRIVACY_HTML || 'public/privacy.html'
const TERMS = process.env.TERMS_HTML || 'public/terms.html'

const walk = (d, ext, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, ext, out)
    else if (e.endsWith(ext)) out.push(p)
  }
  return out
}

/* Visible text: no comments, scripts or styles; tags dropped; whitespace collapsed. */
const visible = html => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&rsquo;|&#39;/g, "'").replace(/&mdash;/g, '—')
  .replace(/\s+/g, ' ')

/* Every source that emits a whole HTML document. */
const sources = [
  ...walk('public', '.html'),
  ...walk('functions', '.js').filter(f => /<!doctype html/i.test(readFileSync(f, 'utf8'))),
].map(f => ({ file: f, src: readFileSync(f, 'utf8') }))
for (const s of sources) {
  s.ga = /src="\/ga\.js"/.test(s.src)
  s.clarity = /src="\/clarity\.js(\?[^"]*)?"/.test(s.src)  // ?v= is the cache-busting version (Grok SEND-BACK 1608)
  s.beacon = /rest\/v1\/analytics_events/.test(s.src)
}

console.log(`\n  ${sources.length} HTML source(s) under public/ and functions/:`)
for (const s of sources) console.log(`    ga:${s.ga ? 'y' : '-'} clarity:${s.clarity ? 'y' : '-'} beacon:${s.beacon ? 'y' : '-'}  ${s.file}`)

/* Anti-vacuity: an empty or shrunken harvest would make every assertion below pass for free. */
assert.ok(sources.length >= 5, `only ${sources.length} HTML sources found — the walk broke, which would make this vacuous`)
assert.ok(sources.some(s => s.file === PRIVACY || s.file.endsWith('privacy.html')), 'privacy.html itself was not among the sources')
assert.ok(sources.some(s => s.file.endsWith('_site.js')), 'functions/_site.js (the page() shell) was not found — the doctype match broke')

const policyHtml = readFileSync(PRIVACY, 'utf8')
const policy = visible(policyHtml)
const terms = visible(readFileSync(TERMS, 'utf8'))
const problems = []
const need = (cond, msg) => { if (!cond) problems.push(msg) }

const anyGa = sources.some(s => s.ga)
const anyClarity = sources.some(s => s.clarity)
const anyBeacon = sources.some(s => s.beacon)

/* 1. Each loaded tool is named, with the identifiers the code actually uses. */
const gaId = (readFileSync('public/ga.js', 'utf8').match(/MEASUREMENT_ID\s*=\s*'([^']+)'/) || [])[1]
if (anyGa) {
  assert.ok(gaId, 'could not read MEASUREMENT_ID from public/ga.js — the matcher broke')
  need(/Google Analytics/.test(policy), 'pages load /ga.js but privacy.html never says "Google Analytics"')
  need(policy.includes(gaId), `pages load /ga.js with ${gaId} but privacy.html does not name that measurement ID`)
  need(/\b_ga\b/.test(policy), 'pages load /ga.js but privacy.html does not name the _ga cookie')
  need(/Google Analytics/.test(terms), "pages load /ga.js but the Terms' privacy summary does not mention Google Analytics")
} else {
  need(!/Google Analytics/.test(policy), 'privacy.html names Google Analytics but no page loads /ga.js — the policy describes a script that is gone')
}
if (anyClarity) {
  need(/Microsoft Clarity/.test(policy), 'pages load /clarity.js but privacy.html never says "Microsoft Clarity"')
  need(/\b_clck\b/.test(policy) && /\b_clsk\b/.test(policy), 'pages load /clarity.js but privacy.html does not name the _clck / _clsk cookies')
  need(/Clarity/.test(terms), "pages load /clarity.js but the Terms' privacy summary does not mention Clarity")
} else {
  need(!/Clarity/.test(policy), 'privacy.html names Clarity but no page loads /clarity.js — the policy describes a script that is gone')
}

/* 2. No denial of third-party analytics while one is loaded. "not in cookies" is NOT a denial: it is
      the true statement that OUR two identifiers live in browser storage, so it is not listed. */
const DENIALS = [
  /no analytics vendor/i,
  /no third[- ]party (tracking|analytics|tracker)/i,
  /no (tracking|analytics) scripts?/i,
  /no trackers?\b/i,
  /(do not|don't|never) (use|set) (any )?cookies/i,
  /no cookies/i,
  /a couple of anonymous traffic signals/i,
  /a short list of anonymous traffic signals/i,
]
if (anyGa || anyClarity) {
  for (const re of DENIALS) {
    need(!re.test(policy), `privacy.html still says ${JSON.stringify((policy.match(re) || [])[0])} while pages load a third-party analytics script`)
    need(!re.test(terms), `terms.html still says ${JSON.stringify((terms.match(re) || [])[0])} while pages load a third-party analytics script`)
  }
  /* The meta description is not visible text but it is what a search result shows. */
  const desc = (policyHtml.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''
  for (const re of DENIALS) need(!re.test(desc), `privacy.html's meta description still says ${JSON.stringify((desc.match(re) || [])[0])}`)
}

/* 3a. "Every page on this site except the retired Library notice" — the exceptions must be exactly
       the pages that load neither tool. */
const without = sources.filter(s => !s.ga && !s.clarity).map(s => s.file).sort()
const partial = sources.filter(s => s.ga !== s.clarity).map(s => s.file)
need(partial.length === 0, `these pages load one analytics tool but not the other, which the policy does not describe: ${partial.join(', ')}`)
if (/except the retired Library notice/.test(policy)) {
  need(JSON.stringify(without) === JSON.stringify(['functions/library/index.js']),
    `privacy.html says every page except the Library notice loads both tools, but the pages loading neither are: ${JSON.stringify(without)}`)
} else if (anyGa || anyClarity) {
  problems.push('privacy.html no longer says which pages load the analytics tools ("except the retired Library notice") — restate the scope and update this check')
}

/* 3b. "On the hub, the tracker and the guides" — the beacon lives only in the page() shell, and only
       those routes call page(). */
const beaconFiles = sources.filter(s => s.beacon).map(s => s.file)
const callers = walk('functions', '.js')
  .filter(f => /import\s*\{[^}]*\bpage\b[^}]*\}\s*from\s*'\.{1,2}\/_site\.js'/.test(readFileSync(f, 'utf8')))
  .sort()
const EXPECT_CALLERS = ['functions/guides/[slug].js', 'functions/guides/index.js', 'functions/index.js', 'functions/tracker.js']
console.log(`  beacon in: ${beaconFiles.join(', ') || '(none)'}   page() callers: ${callers.length}`)
if (anyBeacon) {
  need(JSON.stringify(beaconFiles) === JSON.stringify(['functions/_site.js']),
    `the analytics_events beacon is in ${JSON.stringify(beaconFiles)}, not only the page() shell — the policy's "hub, tracker and guides" scope may be wrong`)
  need(/On the hub, the tracker and the guides/.test(policy), 'privacy.html no longer says which pages run our page-view script')
  assert.ok(callers.length >= 3, `only ${callers.length} page() callers found — the import matcher broke, which would make 3b vacuous`)
  need(JSON.stringify(callers) === JSON.stringify(EXPECT_CALLERS),
    `page() (and so the beacon) is now called by ${JSON.stringify(callers)}; the policy says "the hub, the tracker and the guides" — re-check that sentence, then update EXPECT_CALLERS`)

  /* 4. The storage keys the policy names are the ones the beacon writes. */
  const site = readFileSync('functions/_site.js', 'utf8')
  for (const k of ['cc_anon_id', 'cc_session_id']) {
    need(site.includes(`'${k}'`), `privacy.html names ${k} but the beacon in functions/_site.js no longer writes it`)
    need(policy.includes(k), `the beacon writes ${k} but privacy.html does not name it`)
  }
}

/* 5. Where Clarity loads. The sentence is matched whole, so a policy that drops a place, or the
      unknown-country case, fails here; the places it names are then checked against the function. */
const GEO_FN = process.env.CLARITY_FN || 'functions/clarity.js.js'
const GEO_CLAIM = /Clarity does not load at all for visitors in the European Economic Area, the United Kingdom or Switzerland, or when we can't tell where a visit comes from\./
if (existsSync(GEO_FN)) {
  const { clarityLoads } = await import(pathToFileURL(resolve(GEO_FN)).href)
  assert.equal(typeof clarityLoads, 'function', `${GEO_FN} no longer exports clarityLoads — the matcher broke`)
  if (anyClarity) {
    need(GEO_CLAIM.test(policy), `${GEO_FN} skips Clarity for the EEA, the UK, Switzerland and unknown countries, but privacy.html no longer says so`)
  }
  const EEA = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']
  const named = [...EEA, 'GB', 'CH']
  const leaks = named.filter(c => clarityLoads(c) !== false)
  need(leaks.length === 0, `privacy.html says Clarity does not load in the EEA, the UK or Switzerland, but ${GEO_FN} loads it for: ${leaks.join(' ')}`)
  const unknownLeaks = [undefined, '', 'XX', 'T1'].filter(c => clarityLoads(c) !== false)
  need(unknownLeaks.length === 0, `privacy.html says Clarity does not load when the country is unknown, but ${GEO_FN} loads it for: ${JSON.stringify(unknownLeaks)}`)
  /* Anti-vacuity: a function that skips everyone would pass the two checks above for free. */
  need(clarityLoads('US') === true, `${GEO_FN} does not load Clarity for US — the policy's "Clarity" bullet would describe nobody`)
  console.log(`  geo: ${GEO_FN} skips ${named.length} named places + unknown; US loads`)
} else {
  need(!/does not load at all for visitors in the European Economic Area/.test(policy),
    `privacy.html says Clarity is skipped by location, but ${GEO_FN} (the code that did it) is gone`)
}

if (problems.length) {
  console.log(`\n  FAIL — ${problems.length} problem(s):`)
  for (const p of problems) console.log('    ✗ ' + p)
  process.exit(1)
}
console.log(`  PASS — privacy.html names every analytics script the ${sources.length} HTML sources load, denies none, and its page-scope claims hold.`)
