// Grok diagnostic-surfacing smoke test.
//
// The bug: Grok shows a generic "isn't responding" and the app threw away the
// raw x.ai message, so we couldn't tell WHICH model x.ai was rejecting. This
// verifies the REAL testConnection() now carries the model it tried + the
// provider's own error text, so Settings → Test connections can show e.g.
// "grok-3 — The model ... does not exist".
//
// (The in-conversation error card uses the same extraction via buildErrorDetail
// in TheInterface.jsx; this exercises the exported, network-touching path.)
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

const xaiErr = (msg) => ({ ok: false, status: 404, json: async () => ({}), text: async () => JSON.stringify({ error: { message: msg } }) })

try {
  const { testConnection } = await server.ssrLoadModule('/src/utils/testConnection.js')

  // ── Case 1: x.ai rejects EVERY grok model (model retired / no access) ──
  // Mock the proxy to 404 every grok model with x.ai's real-shaped message,
  // echoing the model from the request body so we can prove we report the
  // last one tried.
  globalThis.fetch = async (_url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {}
    return xaiErr(`The model ${body.model} does not exist or you do not have access to it.`)
  }
  const r1 = await testConnection('grok', 'xai-test-key')
  check('1: not ok', r1.ok === false)
  check('1: classified model unavailable', r1.reason === 'model unavailable', r1.reason)
  check('1: reports the model it tried', !!r1.model, r1.model)
  check('1: detail carries x.ai raw message naming the model', /does not exist/.test(r1.detail || '') && r1.detail.includes(r1.model),
    r1.detail)

  // ── Case 2: key rejected (403, non-model) bails immediately ──────────
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => JSON.stringify({ error: { message: 'Incorrect API key provided.' } }) })
  const r2 = await testConnection('grok', 'xai-bad-key')
  check('2: classified key rejected', r2.reason === 'key rejected', r2.reason)
  check('2: detail carries provider message', /Incorrect API key/.test(r2.detail || ''), r2.detail)
  check('2: tried only the primary model (no pointless fallback on auth error)', r2.model === 'grok-4.3', r2.model)

  // ── Case 3: healthy → ok with the model that answered ────────────────
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
  const r3 = await testConnection('grok', 'xai-good-key')
  check('3: ok via primary model', r3.ok === true && r3.model === 'grok-4.3', r3.model)
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
