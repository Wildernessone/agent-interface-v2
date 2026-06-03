// Build-internal credential gate smoke test.
//
// Bug: build plans could include a credential-gated internal tool (stripe,
// twilio, image_per_slide, …) even with no key, so the step ran and 500'd
// mid-build. The dispatcher's plan normalizer now drops any such step whose
// credential is missing — while keeping agent_synth (any orchestration model)
// and keyless tools (xlsxgen, …).
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// A plan the dispatcher might emit: synth → xlsx, plus a stripe step and a
// per-slide image step (both credential-gated).
const decision = JSON.stringify({
  mode: 'build', spend_mode: 'balanced', agents_to_respond: [], rounds: 1,
  response_mode: 'concise', build_intent: 'create', deliverable: 'Pro tier kit',
  plan: { steps: [
    { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'spreadsheet', input: 'tabulate the tiers' },
    { id: 's2', tool: 'xlsxgen', needs: ['s1'], input: '{s1}' },
    { id: 's3', tool: 'stripe', needs: [], input: '{"name":"Pro","amount":25}' },
    { id: 's4', tool: 'image_per_slide', needs: [], input: '{"slides":[{"title":"cover"}]}' },
  ] },
  reasoning: 'x',
})

// Dispatcher uses the claude branch (simple JSON) when a claude key is present.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: decision }] }), text: async () => decision })

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { orchestrate, selectOrchestrationModel } = await server.ssrLoadModule('/src/utils/openClaw.js')
  const tools = (d) => d.plan.steps.map(s => s.tool)

  // ── Case A: claude key only — no stripe key, no gpt key ─────────────
  const a = await orchestrate({ userMessage: 'make a pro tier kit', enabledAgents: ['claude'], settings: { agents: { claude: { key: 'k' } } } })
  check('A: stays a build', a.mode === 'build', a.mode)
  check('A: keyless agent_synth + xlsxgen kept', tools(a).includes('agent_synth') && tools(a).includes('xlsxgen'))
  check('A: stripe DROPPED (no stripe key)', !tools(a).includes('stripe'), tools(a).join(','))
  check('A: image_per_slide DROPPED (no OpenAI key)', !tools(a).includes('image_per_slide'), tools(a).join(','))

  // ── Case B: all credentials present ─────────────────────────────────
  const b = await orchestrate({ userMessage: 'make a pro tier kit', enabledAgents: ['claude'],
    settings: { agents: { claude: { key: 'k' }, gpt: { key: 'g' } }, toolKeys: { stripe: 'sk_test_x' } } })
  check('B: stripe kept when key present', tools(b).includes('stripe'), tools(b).join(','))
  check('B: image_per_slide kept when OpenAI key present', tools(b).includes('image_per_slide'), tools(b).join(','))

  // ── Unit: agent_synth must survive on ANY orchestration model ───────
  // (it falls back claude→gpt→gemini internally; gating on its nominal
  // 'agent.claude' keySource would wrongly kill builds for GPT-only users.)
  check('agent_synth allowed with only a GPT key', !!selectOrchestrationModel({ agents: { gpt: { key: 'g' } } }))
  check('agent_synth allowed with only a Gemini key', !!selectOrchestrationModel({ agents: { gemini: { key: 'x' } } }))
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
