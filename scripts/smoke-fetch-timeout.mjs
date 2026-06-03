// Provider-call timeout smoke test.
//
// Covers the generalized hang fix: (1) the makeIdleTimeout primitive fires on
// idle, survives a bump, and stays quiet after clear; (2) the orchestrate call
// (callOpenClaw) turns a hung/aborted socket into a graceful "discuss" fallback
// instead of spinning forever. The 4 agent stream fns use the same primitive +
// pattern, so (1) covers their timing and (2) covers the integration shape.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

try {
  // ── 1. makeIdleTimeout primitive (short windows, real timers) ───────
  const { makeIdleTimeout, isAbort } = await server.ssrLoadModule('/src/utils/fetchTimeout.js')

  const a = makeIdleTimeout(40)
  check('idle: not aborted immediately', a.signal.aborted === false)
  await sleep(70)
  check('idle: aborts after the window with no activity', a.signal.aborted === true)
  a.clear()

  const b = makeIdleTimeout(40)
  await sleep(25); b.bump()          // activity resets the window
  await sleep(25)
  check('bump: a progressing stream is NOT aborted', b.signal.aborted === false, `bumped at 25ms`)
  await sleep(60)
  check('bump: but a stall after the last bump still aborts', b.signal.aborted === true)
  b.clear()

  const c = makeIdleTimeout(40)
  c.clear()
  await sleep(70)
  check('clear: a settled call never aborts', c.signal.aborted === false)

  check('isAbort: matches an AbortError', isAbort(Object.assign(new Error('x'), { name: 'AbortError' })) === true)
  check('isAbort: matches an "aborted" message', isAbort(new Error('The operation was aborted')) === true)
  check('isAbort: ignores ordinary errors', isAbort(new Error('boom')) === false)

  // ── 2. orchestrate call: a hung/aborted socket → graceful fallback ──
  const { orchestrate } = await server.ssrLoadModule('/src/utils/openClaw.js')
  globalThis.fetch = async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e }
  const decision = await orchestrate({
    userMessage: 'What do you all think of this idea?',
    enabledAgents: ['claude', 'gemini'],
    settings: { agents: { claude: { key: 'sk-ant-smoke' } } },
  })
  check('orchestrate: returns (does not hang) on an aborted call', !!decision)
  check('orchestrate: degrades to discuss mode', decision.mode === 'discuss', decision.mode)
  check('orchestrate: surfaces the timeout in reasoning', /timeout/i.test(decision.reasoning || ''), decision.reasoning)
  check('orchestrate: still routes to the enabled agents', Array.isArray(decision.agents_to_respond) && decision.agents_to_respond.length > 0, JSON.stringify(decision.agents_to_respond))
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
