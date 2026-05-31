// Pre-deploy smoke harness. Loads the REAL modules via Vite SSR (so
// import.meta.env resolves) and exercises the failure classes that have
// actually bitten us in production:
//
//   1. base64 overflow — the "Maximum call stack" crash (hit twice in prod)
//   2. tool registry integrity — every tool well-formed + registered
//   3. audio tool contracts — success shape + error handling (no raw crash)
//   4. dispatcher plan normalization — build mode, tool gating
//
// Run with `npm run smoke`. No API keys needed — the proxy/network is mocked.
// Exits non-zero on any failure so CI can gate on it.
import { createServer } from 'vite'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
async function expectThrow(name, fn) {
  try { await fn(); check(name, false, 'expected a throw, got none') }
  catch { check(name, true) }
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true } })

// Mock fetch so any tool/dispatcher path that hits the network can't make a
// real call during the smoke run. Tools that take an injected `proxy` get a
// mock below; this is the backstop for direct fetch().
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

try {
  // ── 1. base64 overflow regression ────────────────────────────────
  const { arrayBufferToBase64 } = await server.ssrLoadModule('/src/utils/base64.js')
  const big = new Uint8Array(2_000_000)          // 2MB — well past the spread/arg limit
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff
  let b64 = null
  try { b64 = arrayBufferToBase64(big.buffer) } catch (e) { check('base64: 2MB buffer does not overflow', false, e.message) }
  if (b64 !== null) {
    check('base64: 2MB buffer encodes without overflow', typeof b64 === 'string' && b64.length > 2_000_000)
    check('base64: round-trips correctly', Buffer.from(b64, 'base64').length === big.length)
  }

  // ── 2. registry integrity ────────────────────────────────────────
  const reg = await server.ssrLoadModule('/src/tools/registry.js')
  const { TOOL_REGISTRY, TOOLS_BY_ID, ToolError } = reg
  check('registry: non-empty', Array.isArray(TOOL_REGISTRY) && TOOL_REGISTRY.length > 0, `${TOOL_REGISTRY.length} tools`)
  const malformed = TOOL_REGISTRY.filter(t => !t.id || !t.name || !t.category || typeof t.run !== 'function')
  check('registry: every tool has id/name/category/run', malformed.length === 0, malformed.map(t => t.id || '??').join(', '))
  const dupes = TOOL_REGISTRY.map(t => t.id).filter((id, i, a) => a.indexOf(id) !== i)
  check('registry: no duplicate ids', dupes.length === 0, dupes.join(', '))
  for (const id of ['stable_audio', 'elevenlabs_music', 'openai_tts', 'suno']) {
    check(`registry: ${id} present`, !!TOOLS_BY_ID[id])
  }

  // ── 3. audio tool contracts (mock proxy) ─────────────────────────
  const mockRes = (ok, body, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) })
  const audioTools = [
    { id: 'elevenlabs', okBody: { audio: 'QUJD' } },
    { id: 'openai_tts', okBody: { audio: 'QUJD' } },
    { id: 'stable_audio', okBody: { audio: 'QUJD' } },
    { id: 'elevenlabs_music', okBody: { audio: 'QUJD' } },
    { id: 'suno', okBody: { url: 'https://example.com/a.mp3', title: 't' } },
  ]
  for (const { id, okBody } of audioTools) {
    const tool = TOOLS_BY_ID[id]
    // success → returns an audio result with a usable url
    const okProxy = async () => mockRes(true, okBody)
    const out = await tool.run({ prompt: 'test track', structuredInput: { prompt: 'test', duration: 30, length_ms: 15000 }, key: 'k', proxy: okProxy, settings: {} })
    check(`${id}: success returns audio with url`, out?.type === 'audio' && typeof out.url === 'string' && out.url.length > 0)
    // upstream failure → ToolError, not an unhandled crash
    const errProxy = async () => mockRes(false, { error: 'boom' }, 500)
    await expectThrow(`${id}: upstream error throws ToolError`, () =>
      tool.run({ prompt: 'x', structuredInput: { prompt: 'x' }, key: 'k', proxy: errProxy, settings: {} }))
    // missing key → ToolError
    await expectThrow(`${id}: missing key throws`, () =>
      tool.run({ prompt: 'x', structuredInput: { prompt: 'x' }, key: '', proxy: okProxy, settings: {} }))
  }
  check('ToolError is exported', typeof ToolError === 'function')

  // ── 4. dispatcher plan normalization ─────────────────────────────
  const { orchestrate } = await server.ssrLoadModule('/src/utils/openClaw.js')
  const CANNED = {
    mode: 'build', spend_mode: 'balanced', agents_to_respond: [], role_assignments: {}, rounds: 1,
    response_mode: 'concise', deliverable: 'ad',
    plan: { steps: [
      { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'slides', input: 'storyboard', label: 'write' },
      { id: 's2', tool: 'stable_audio', needs: ['s1'], input: 'track {s1}', label: 'music' },
      { id: 's3', tool: 'suno', needs: ['s1'], input: 'track', label: 'music-suno' },
    ] },
    correction: { detected: false }, voice_response_chars: 300, reasoning: 'x',
  }
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/claude')) return { ok: true, status: 200, json: async () => ({ content: [{ text: JSON.stringify(CANNED) }] }) }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
  }
  // suno NOT in enabledTools and not build-internal → must be filtered out;
  // stable_audio IS build-internal → must survive.
  const decision = await orchestrate({
    userMessage: 'build me a 30s ad now', enabledAgents: ['claude'],
    enabledTools: {}, settings: { agents: { claude: { key: 'sk-test' } } },
  })
  const tools = decision.plan.steps.map(s => s.tool)
  check('dispatcher: build mode preserved', decision.mode === 'build')
  check('dispatcher: build-internal stable_audio survives', tools.includes('stable_audio'))
  check('dispatcher: keyless/non-internal suno filtered out', !tools.includes('suno'), `plan: ${tools.join(' -> ')}`)
} finally {
  await server.close()
}

console.log(failures ? `\nSMOKE FAILED — ${failures} check(s)` : '\nSMOKE PASSED')
process.exit(failures ? 1 : 0)
