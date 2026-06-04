// Orchestrator resilience — the turn must NEVER die because routing failed.
//
// SPOF fixed: if orchestrate() throws, TheInterface used to addErrorTurn +
// return — the whole turn died, no agent answered. Now it falls back to a plain
// discuss decision (defaultDecision, now exported) and continues. This smoke
// covers the two testable building blocks:
//   1. defaultDecision is exported and yields a usable discuss decision.
//   2. orchestrate() itself stays resilient when the model network call fails —
//      it returns a discuss decision rather than throwing/returning null.
// (The component-level "continue instead of return" is a 4-line wiring change,
//  exercised by the Playwright E2E in task D1.)
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { orchestrate, defaultDecision } = await server.ssrLoadModule('/src/utils/openClaw.js')

  // 1. defaultDecision export + shape
  const d = defaultDecision(['claude', 'gpt'], false)
  check('defaultDecision is exported', typeof defaultDecision === 'function')
  check('fallback is a discuss round', d.mode === 'discuss')
  check('fallback responds with the given agents', JSON.stringify(d.agents_to_respond) === JSON.stringify(['claude', 'gpt']))
  check('fallback has no build plan', Array.isArray(d.plan) && d.plan.length === 0)
  const dv = defaultDecision(['claude'], true)
  check('voice fallback stays concise', dv.response_mode === 'concise')

  // 2. orchestrate stays resilient when the model call throws (dead network)
  globalThis.fetch = async () => { throw new Error('network down') }
  let threw = false, res = null
  try {
    res = await orchestrate({
      userMessage: 'what should I name my company',
      enabledAgents: ['claude'],
      settings: { agents: { claude: { key: 'k' } } },
    })
  } catch { threw = true }
  check('orchestrate does NOT throw on dead network', !threw)
  check('orchestrate returns a usable discuss decision', res?.mode === 'discuss', res?.mode)
  check('orchestrate still names agents to respond', Array.isArray(res?.agents_to_respond))
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all orchestrator-fallback checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
