/* /clarity.js — the Microsoft Clarity loader, gated by the visitor's country (2026-10-13).
 *
 * James's decision (option b): Clarity does NOT load for visitors in the EEA, the UK or Switzerland,
 * and does NOT load when the country is unknown. Google Analytics is unchanged. No consent banner.
 *
 * ⭐ WHY A FUNCTION ON THIS ONE ROUTE: every page already gates Clarity in exactly one file,
 *    public/clarity.js, and loads it as <script src="/clarity.js">. This function answers that one
 *    URL (functions/<name>.js.js serves /<name>.js, the same pattern as functions/llms.txt.js), so
 *    no page, no CSP and no gate inside public/clarity.js changes. Allowed visitors get the real
 *    static loader unchanged; everyone else gets a one-line comment that makes no network call.
 * ⭐ THE RULE: load ONLY when the country is a known 2-letter code that is NOT in CLARITY_SKIP.
 *    Missing, empty, "XX" (Cloudflare: no country data) and "T1" (Tor) are unknown, so they skip.
 *    The list is pinned by tests/clarity-geo-skip.test.mjs.
 * ⛔ Cache-Control: private, no-store on BOTH answers. The body now depends on where the request
 *    came from; a cached copy served to the next visitor would carry someone else's decision.
 * ⭐ PREVIEW TEST OVERRIDE: a `geo_test=XX` cookie stands in for the country, but ONLY on a
 *    *.pages.dev host, so DE/GB/CH can be verified from a US machine. Production custom domains
 *    ignore it (pinned by the test). On a pages.dev host public/clarity.js's own host gate returns
 *    before injecting the tag anyway, so the override can only choose which of two inert bodies a
 *    preview gets; it can never load Clarity for anyone.
 * ⚠ The privacy page states this rule (public/privacy.html §4), and
 *    tests/privacy-discloses-analytics.test.mjs fails if the two drift apart.
 */

// EU 27, EEA non-EU, UK + Switzerland, then territories Cloudflare may report separately that are
// under EU or UK law (EU outermost regions, Ceuta/Melilla, the Canaries, the Crown Dependencies,
// Gibraltar). One list, one place.
export const CLARITY_SKIP = Object.freeze([
  // EU 27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA, not EU
  'IS', 'LI', 'NO',
  // UK + Switzerland
  'GB', 'CH',
  // Territories reported separately
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'EA', 'IC',
  'GG', 'JE', 'IM', 'GI',
])

// Codes Cloudflare uses when it does not know the country. They match /^[A-Z]{2}$/ or not, but
// either way they are not a place, so they skip.
export const UNKNOWN_COUNTRY = Object.freeze(['XX', 'T1'])

const SKIP = new Set(CLARITY_SKIP)
const UNKNOWN = new Set(UNKNOWN_COUNTRY)

/** true only for a known 2-letter country code outside CLARITY_SKIP. */
export function clarityLoads (country) {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : ''
  if (!/^[A-Z]{2}$/.test(c)) return false
  if (UNKNOWN.has(c)) return false
  return !SKIP.has(c)
}

export const SKIPPED_BODY = '/* Microsoft Clarity is not loaded for visitors in the EEA, the UK or Switzerland, or when the country is unknown. */\n'

const NO_STORE = 'private, no-store'

/** The country this request is decided on: Cloudflare's, or the geo_test cookie on a *.pages.dev preview. */
export function countryFor (request) {
  let country = request.cf && request.cf.country
  const host = new URL(request.url).hostname
  if (host.endsWith('.pages.dev')) {
    const m = /(?:^|;\s*)geo_test=([^;]*)/.exec(request.headers.get('cookie') || '')
    if (m) country = m[1]
  }
  return country
}

export async function onRequest ({ request, env }) {
  if (!clarityLoads(countryFor(request))) {
    return new Response(SKIPPED_BODY, {
      status: 200,
      headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': NO_STORE },
    })
  }
  const res = await env.ASSETS.fetch(request)
  const out = new Response(res.body, res)
  out.headers.set('cache-control', NO_STORE)
  return out
}
