// Image-provider fallback smoke test.
//
// Tonight's failure: image_per_slide called DALL-E only; when OpenAI hit its
// billing hard limit, the whole image step (and the ad/deck build) died. Now a
// DALL-E failure transparently falls through to the other providers the user
// has keys for (Stable Diffusion → Flux → Ideogram → Recraft).
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// Mock proxy keyed by route. dalleOk toggles whether DALL-E succeeds.
const makeProxy = ({ dalleOk }) => async (route) => {
  if (route === 'dalle') {
    return dalleOk
      ? { ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'REFM' }] }), text: async () => '' }
      : { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"Billing hard limit reached"}}' }
  }
  if (route === 'stability') {
    return { ok: true, status: 200, json: async () => ({ image: 'U1RBQg==' }), text: async () => '' }
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'no route' }
}

const slides2 = { slides: [{ prompt: 'a fox on a ridge' }, { prompt: 'a hen in grass' }] }

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { TOOLS_BY_ID, ToolError } = await server.ssrLoadModule('/src/tools/registry.js')
  const ips = TOOLS_BY_ID['image_per_slide']

  // ── Case 1: DALL-E billing-fails, user has a Stability key → fall through ──
  const out1 = await ips.run({
    structuredInput: slides2, key: 'g', proxy: makeProxy({ dalleOk: false }),
    settings: { agents: { gpt: { key: 'g' } }, toolKeys: { stability: 'sk-x' } },
  })
  check('1: returns an image_bundle (build NOT killed)', out1?.type === 'image_bundle')
  check('1: both slides produced an image', out1.files.length === 2 && out1.files.every(f => f.url?.startsWith('data:image/png;base64,')),
    out1.files.map(f => f.provider || f.error).join(', '))
  check('1: they came from Stability, not DALL-E', out1.files.every(f => f.provider === 'stability') && out1.meta.providers.includes('stability'),
    JSON.stringify(out1.meta.providers))

  // ── Case 2: DALL-E healthy → uses DALL-E (no needless fallback) ──────
  const out2 = await ips.run({
    structuredInput: slides2, key: 'g', proxy: makeProxy({ dalleOk: true }),
    settings: { agents: { gpt: { key: 'g' } }, toolKeys: { stability: 'sk-x' } },
  })
  check('2: served by DALL-E when healthy', out2.files.every(f => f.provider === 'dalle'), JSON.stringify(out2.meta.providers))

  // ── Case 3: DALL-E fails, NO other provider key → clear combined error ──
  let err = null
  try {
    await ips.run({ structuredInput: slides2, key: 'g', proxy: makeProxy({ dalleOk: false }), settings: { agents: { gpt: { key: 'g' } } } })
  } catch (e) { err = e }
  check('3: throws when every available provider fails', err instanceof ToolError)
  check('3: error names the real DALL-E billing cause', /billing hard limit/i.test(err?.message || ''), err?.message?.slice(0, 120))
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
