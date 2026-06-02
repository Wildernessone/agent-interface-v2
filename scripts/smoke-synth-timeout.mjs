// agent_synth hard-timeout smoke test.
//
// The bug: a hung proxy/socket left the build card's agent_synth step stuck on
// ◐ "in progress" forever (observed 16 min) — tool.run() never resolved or
// rejected, so runBuild emitted neither done nor failed. Fix: a 90s
// AbortController per attempt; an abort surfaces as a ToolError so the build
// card shows a failure instead of limbo.
//
// We can't wait 90s, so we simulate the abort: a mocked fetch that rejects
// with an AbortError-shaped error (exactly what AbortController triggers).
// Asserts agent_synth turns that into a ToolError naming the 90s timeout, and
// fails fast (one call, no retry storm). A second case confirms a normal
// response still parses.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

try {
  const { TOOLS_BY_ID, ToolError } = await server.ssrLoadModule('/src/tools/registry.js')
  const agentSynth = TOOLS_BY_ID['agent_synth']
  const settings = { agents: { claude: { key: 'sk-ant-smoke' } } }

  // ── Case 1: every fetch aborts (simulating the 90s ceiling firing) ──
  let calls = 0
  globalThis.fetch = async () => { calls++; const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e }
  let err = null
  try {
    await agentSynth.run({ prompt: 'Organize X into a spreadsheet', settings, outputSchema: 'spreadsheet' })
  } catch (e) { err = e }
  check('1: threw an error', !!err)
  check('1: it is a ToolError for agent_synth', err instanceof ToolError && err.toolId === 'agent_synth', err?.toolId)
  check('1: message names the 90s timeout', /90s/.test(err?.message || ''), err?.message)
  check('1: failed fast — no retry storm on a timeout', calls === 1, `${calls} fetch call(s)`)

  // ── Case 2: a healthy response still parses (no false timeout) ──────
  const okJson = JSON.stringify({ title: 'X', sheets: [{ name: 'S', rows: [['A'], ['1']] }] })
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: okJson }] }), text: async () => okJson })
  const out = await agentSynth.run({ prompt: 'Organize X', settings, outputSchema: 'spreadsheet' })
  check('2: normal call returns parsed JSON', out?.title === 'X' && Array.isArray(out?.sheets), JSON.stringify(out?.sheets?.length))
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
