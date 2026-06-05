// Panel-first builds (S3) + options generation (S4). A SUBJECTIVE build (reason
// content into existence) must debate first → mode build_options with a
// panel_round; a MECHANICAL build (transform existing content) builds directly.
// generateBuildOptions turns a debate into normalized, runnable options.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

let resp = {}
globalThis.fetch = async () => {
  const text = JSON.stringify(resp)
  return { ok: true, status: 200, json: async () => ({ content: [{ text }] }), text: async () => text }
}

const buildPlan = {
  mode: 'build', spend_mode: 'balanced', agents_to_respond: [], rounds: 1,
  response_mode: 'concise', build_intent: 'create', requires_brand_context: false,
  deliverable: 'Plan', plan: { steps: [
    { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'document', input: 'draft' },
    { id: 's2', tool: 'docgen', needs: ['s1'], input: '{s1}' },
  ] }, reasoning: 'x',
}
const settings = { agents: { claude: { key: 'k' } } }
const run = (msg) => ({ userMessage: msg, enabledAgents: ['claude', 'gpt'], settings })

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { classifyBuildIntent } = await server.ssrLoadModule('/src/utils/buildClass.js')
  const { orchestrate, generateBuildOptions } = await server.ssrLoadModule('/src/utils/openClaw.js')

  // ── classifier ──────────────────────────────────────────────────────
  check('subjective: write an ad', classifyBuildIntent('write me an ad for my coffee') === 'subjective')
  check('subjective: recommend', classifyBuildIntent('recommend the best approach') === 'subjective')
  check('subjective: pros and cons', classifyBuildIntent('pros and cons of remote work') === 'subjective')
  check('subjective: default unknown', classifyBuildIntent('a poem about the sea') === 'subjective')
  check('mechanical: turn this into', classifyBuildIntent('turn this into a spreadsheet') === 'mechanical')
  check('mechanical: compile', classifyBuildIntent('compile the numbers') === 'mechanical')
  check('mechanical: organize w/ prior', classifyBuildIntent('organize the above', { hasPriorDiscussion: true }) === 'mechanical')

  // ── orchestrate: subjective build → build_options ───────────────────
  resp = buildPlan
  const sub = await orchestrate(run('recommend the best way to structure my week'))
  check('subjective build → build_options', sub.mode === 'build_options', sub.mode)
  check('build_options has a panel_round', !!sub.panel_round && sub.panel_round.agents?.length >= 2)
  check('debaters get debate roles', Object.values(sub.role_assignments || {}).includes('skeptic'))
  check('base_plan preserved', sub.base_plan?.steps?.length === 2)
  check('agents_to_respond = debaters', Array.isArray(sub.agents_to_respond) && sub.agents_to_respond.length >= 2)

  // ── orchestrate: mechanical build → builds directly ─────────────────
  resp = buildPlan
  const mech = await orchestrate(run('turn this into a spreadsheet'))
  check('mechanical build stays build', mech.mode === 'build', mech.mode)
  check('mechanical build_class set', mech.build_class === 'mechanical')

  // ── generateBuildOptions: normalizes a debate into runnable options ──
  resp = { options: [
    { name: 'Lean MVP', description: 'Ship the smallest version', est_cost: '~$0.04', est_time: '~2 min', champions: ['claude'], consensus: 3,
      plan: { deliverable: 'Lean', steps: [{ id: 's1', tool: 'agent_synth', needs: [], output_schema: 'document', input: 'x' }, { id: 's2', tool: 'docgen', needs: ['s1'], input: '{s1}' }] } },
    { name: 'Full Pitch', description: 'The complete deck', champions: ['gpt', 'gemini'], consensus: 4,
      plan: { steps: [{ id: 's1', tool: 'agent_synth', needs: [], output_schema: 'slides', input: 'y' }, { id: 's2', tool: 'pptxgen', needs: ['s1'], input: '{s1}' }] } },
    { name: 'Empty', description: 'no plan', plan: { steps: [] } }, // dropped (no steps)
  ] }
  const opts = await generateBuildOptions({ userMessage: 'pitch my idea', debate: [{ agent: 'claude', role: 'builder', text: 'go lean' }], deliverable: 'Pitch', enabledTools: {}, settings })
  check('options normalized + empty dropped', opts.length === 2, `len=${opts.length}`)
  check('option carries name/desc', opts[0].name === 'Lean MVP' && /smallest/.test(opts[0].description))
  check('consensus clamped 1-4', opts[1].consensus === 4)
  check('champions kept', opts[1].champions.join(',') === 'gpt,gemini')
  check('plan steps runnable', opts[0].plan.steps.length === 2 && opts[0].plan.steps[0].tool === 'agent_synth')
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all panel-first checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
