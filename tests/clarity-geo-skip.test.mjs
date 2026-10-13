/* Clarity must not load in the EEA, the UK or Switzerland, or when the country is unknown (2026-10-13).
   James's decision, option (b): decided server-side from Cloudflare's country, in functions/clarity.js.js,
   which answers the /clarity.js URL every page already loads. Google Analytics is unchanged.

   What it checks, against the REAL function (fake requests, a fake env.ASSETS):
     1. The region list is pinned: every code below skips, and the constant holds exactly these codes,
        so a deletion or an addition is a reviewed change. US, CA, MX, AU, JP, BR load.
     2. Skipped visitors (DE, GB, CH, FR, NO, missing, XX, T1, ...) get the one-line no-op body, as
        JavaScript, with Cache-Control private/no-store, and ASSETS.fetch is never called — so no byte
        of the real loader, and no clarity.ms URL, reaches them.
     3. An allowed visitor (US) gets exactly what ASSETS.fetch returned, re-wrapped with no-store.
     4. The geo_test cookie overrides the country on a *.pages.dev preview and is IGNORED on the
        production hostnames.
   Run: node tests/clarity-geo-skip.test.mjs
   CLARITY_FN=<path> points it at another copy of the function (how its red-first proof was run). */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FN = process.env.CLARITY_FN
  ? pathToFileURL(resolve(process.env.CLARITY_FN)).href
  : new URL('../functions/clarity.js.js', import.meta.url).href
const mod = await import(FN)

let bad = 0
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : '\n        ' + detail}`); if (!ok) bad++ }

const EU27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
const EEA = ['IS', 'LI', 'NO']
const UK_CH = ['GB', 'CH']
const TERRITORIES = ['AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'EA', 'IC', 'GG', 'JE', 'IM', 'GI']
const SPEC = [...EU27, ...EEA, ...UK_CH, ...TERRITORIES]
const LOAD = ['US', 'CA', 'MX', 'AU', 'JP', 'BR']
const UNKNOWN = [undefined, null, '', '  ', 'XX', 'T1', 'xx', 'USA', '1', 7]

// Anti-vacuity: the spec list itself.
check(`the spec list has 27 EU + 3 EEA + 2 + 13 territories = ${SPEC.length} codes`, EU27.length === 27 && SPEC.length === 45 && new Set(SPEC).size === 45)

/* 1. The list. */
const { CLARITY_SKIP, clarityLoads, onRequest, SKIPPED_BODY } = mod
check('functions/clarity.js.js exports CLARITY_SKIP, clarityLoads, onRequest and SKIPPED_BODY',
  Array.isArray(CLARITY_SKIP) && typeof clarityLoads === 'function' && typeof onRequest === 'function' && typeof SKIPPED_BODY === 'string')
const have = [...(CLARITY_SKIP || [])].sort().join(',')
check('CLARITY_SKIP is exactly the spec list (no code dropped, none added)', have === [...SPEC].sort().join(','),
  `missing: ${SPEC.filter(c => !(CLARITY_SKIP || []).includes(c)).join(' ') || '-'}; extra: ${(CLARITY_SKIP || []).filter(c => !SPEC.includes(c)).join(' ') || '-'}`)
const loadingInSkip = SPEC.filter(c => clarityLoads(c) !== false)
check(`all ${SPEC.length} listed codes skip`, loadingInSkip.length === 0, `these load: ${loadingInSkip.join(' ')}`)
check('lower-case listed codes skip too', SPEC.every(c => clarityLoads(c.toLowerCase()) === false))
const notLoading = LOAD.filter(c => clarityLoads(c) !== true)
check(`${LOAD.join(', ')} load`, notLoading.length === 0, `these do not load: ${notLoading.join(' ')}`)
const unknownLoading = UNKNOWN.filter(c => clarityLoads(c) !== false)
check('unknown countries skip: missing, null, empty, blank, XX, T1, xx, USA, 1, a number', unknownLoading.length === 0,
  `these load: ${JSON.stringify(unknownLoading)}`)

/* 2-4. The real handler, with fake requests. */
const LOADER = '/* the real static loader */ https://www.clarity.ms/tag/ x'
const call = async ({ host = 'agentinterface.app', country, cookie } = {}) => {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  const request = new Request(`https://${host}/clarity.js`, { headers })
  if (country !== undefined) Object.defineProperty(request, 'cf', { value: { country } })
  let assetCalls = 0
  const env = {
    ASSETS: {
      fetch: async () => {
        assetCalls++
        return new Response(LOADER, { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=0, must-revalidate', etag: '"abc"' } })
      },
    },
  }
  const res = await onRequest({ request, env, next: () => { throw new Error('next() must not be called') } })
  return { res, body: await res.text(), assetCalls }
}
const isSkip = ({ res, body, assetCalls }) =>
  res.status === 200 && body === SKIPPED_BODY && !/clarity\.ms/.test(body) && assetCalls === 0 &&
  /^application\/javascript/.test(res.headers.get('content-type') || '') &&
  /\bno-store\b/.test(res.headers.get('cache-control') || '') && /\bprivate\b/.test(res.headers.get('cache-control') || '')
const isLoad = ({ res, body, assetCalls }) =>
  res.status === 200 && body === LOADER && assetCalls === 1 &&
  res.headers.get('cache-control') === 'private, no-store' && res.headers.get('etag') === '"abc"'
const show = r => `status ${r.res.status}, ASSETS.fetch x${r.assetCalls}, cache-control "${r.res.headers.get('cache-control')}", content-type "${r.res.headers.get('content-type')}", body ${JSON.stringify(r.body.slice(0, 80))}`

check('the no-op body is one comment and names no clarity.ms URL',
  /^\/\*[^]*\*\/\s*$/.test(SKIPPED_BODY || '') && !/clarity\.ms|https?:/.test(SKIPPED_BODY || '') && (SKIPPED_BODY || '').split('*/').length === 2)

for (const c of ['DE', 'GB', 'CH', 'FR', 'NO', 'IE', 'IC', 'JE', 'XX', 'T1', '']) {
  const r = await call({ country: c })
  check(`cf.country ${JSON.stringify(c)} → the no-op body, no-store, ASSETS never fetched`, isSkip(r), show(r))
}
{
  const r = await call({})
  check('no request.cf at all → the no-op body', isSkip(r), show(r))
}
for (const c of ['US', 'CA', 'JP']) {
  const r = await call({ country: c })
  check(`cf.country ${c} → the real loader from ASSETS.fetch, re-wrapped with private, no-store`, isLoad(r), show(r))
}

/* 4. The preview override. */
const PREVIEW = 'fix-clarity-geo-skip.agent-interface-v2.pages.dev'
for (const [cookie, cf, want] of [
  ['geo_test=DE', 'US', 'skip'], ['geo_test=GB', 'US', 'skip'], ['geo_test=CH', 'US', 'skip'],
  ['a=1; geo_test=DE; b=2', 'US', 'skip'], ['geo_test=', 'US', 'skip'],
  ['geo_test=US', 'DE', 'load'], ['geo_test=US', undefined, 'load'],
]) {
  const r = await call({ host: PREVIEW, country: cf, cookie })
  check(`preview host, cookie "${cookie}", cf ${cf} → ${want}`, want === 'skip' ? isSkip(r) : isLoad(r), show(r))
}
{
  const r = await call({ host: 'x.pages.dev', country: 'US', cookie: 'geo_test=DE' })
  check('x.pages.dev honors geo_test=DE', isSkip(r), show(r))
}
for (const host of ['agentinterface.app', 'www.agentinterface.app']) {
  const a = await call({ host, country: 'DE', cookie: 'geo_test=US' })
  check(`production ${host} IGNORES geo_test=US for a DE visitor (still skipped)`, isSkip(a), show(a))
  const b = await call({ host, country: 'US', cookie: 'geo_test=DE' })
  check(`production ${host} IGNORES geo_test=DE for a US visitor (still loads)`, isLoad(b), show(b))
}
// A host that merely CONTAINS pages.dev is not a preview.
{
  const r = await call({ host: 'pages.dev.agentinterface.app', country: 'DE', cookie: 'geo_test=US' })
  check('a host that only contains "pages.dev" is not a preview (cookie ignored)', isSkip(r), show(r))
}
// ignore cookie names that only end in geo_test
{
  const r = await call({ host: PREVIEW, country: 'DE', cookie: 'not_geo_test=US' })
  check('a cookie named not_geo_test is not the override', isSkip(r), show(r))
}

// ── the cached-loader tail (Grok SEND-BACK 1608): every page asks for the CURRENT version ──
// Production served the old /clarity.js as public, max-age=14400, so a browser that had cached it would keep running
// the real loader for up to 4 hours after the gate shipped. A new URL is a new cache entry; the old one is never asked for.
{
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const CLARITY_V = 'geo1'
  const walk = (d, out = []) => { for (const e of readdirSync(d)) { const q = join(d, e); statSync(q).isDirectory() ? walk(q, out) : (/\.(html|js)$/.test(e) && out.push(q)) } return out }
  const refs = [...walk('public'), ...walk('functions')].flatMap(f => [...readFileSync(f, 'utf8').matchAll(/<script[^>]*\ssrc="(\/clarity\.js[^"]*)"[^>]*\sdefer/g)].map(m => [f, m[1]]))
  check(`every page that loads Clarity asks for /clarity.js?v=${CLARITY_V} (${refs.length} reference(s))`,
    refs.length >= 4 && refs.every(([, src]) => src === '/clarity.js?v=' + CLARITY_V),
    refs.filter(([, src]) => src !== '/clarity.js?v=' + CLARITY_V).map(([f, src]) => f + ': ' + src).join(', ') || `only ${refs.length} reference(s) found`)
}
console.log(bad ? `\n  clarity-geo-skip: ${bad} failure(s)` : '\n  clarity-geo-skip: green')
process.exit(bad ? 1 : 0)
