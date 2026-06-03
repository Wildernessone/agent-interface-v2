// Brand-context hard-gate smoke test.
//
// Bug: handed only a project NAME, the panel fabricated an entire product
// identity (Timberline deal-tracker → invented real-estate platform, fake
// "prior brainstorm"). Fix: before any brand-facing build, require real brand
// context — from the project's brief OR pasted into the message. No context →
// the dispatcher returns mode:"blocked" and asks for a brief instead of
// building. A verbose prompt about HOW to market does NOT satisfy the gate.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// Mutable canned dispatcher decision — the mocked proxy returns whatever this
// holds, so each case sets it before calling orchestrate().
let currentDecision = {}
globalThis.fetch = async () => {
  const text = JSON.stringify(currentDecision)
  return { ok: true, status: 200, json: async () => ({ content: [{ text }] }), text: async () => text }
}

const deckPlan = {
  mode: 'build', spend_mode: 'balanced', agents_to_respond: [], rounds: 1,
  response_mode: 'concise', build_intent: 'create', deliverable: 'Launch deck',
  plan: { steps: [
    { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'slides', input: 'draft the deck' },
    { id: 's2', tool: 'pptxgen', needs: ['s1'], input: '{s1}' },
  ] },
  reasoning: 'x',
}

const RICH_BRIEF = 'What it is: a free hunting-gear deal tracker that surfaces the genuine cheapest price online — no fake markdowns, no inflated MSRPs. Audience: budget-minded hunters. Voice: plainspoken, built-by-hunters, no hype.'

const settings = { agents: { claude: { key: 'k' } } }
const run = (over) => ({ userMessage: 'make a launch deck', enabledAgents: ['claude'], settings, ...over })

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { orchestrate } = await server.ssrLoadModule('/src/utils/openClaw.js')
  const { brandBriefFrom, buildRequiresBrandContext, MIN_BRAND_CONTEXT_CHARS, BRIEF_TEMPLATE } =
    await server.ssrLoadModule('/src/utils/brandContext.js')
  const { buildSystemPrompt } = await server.ssrLoadModule('/src/utils/buildSystemPrompt.js')

  // ── Pure helpers ────────────────────────────────────────────────────
  check('helper: rich brief passes', brandBriefFrom({ description: RICH_BRIEF }) === RICH_BRIEF)
  check('helper: empty → ""', brandBriefFrom({ description: '' }) === '')
  check('helper: short desc → ""', brandBriefFrom({ description: 'a deal site' }) === '')
  check('helper: unfilled template → ""', brandBriefFrom({ description: BRIEF_TEMPLATE }) === '',
    `len=${BRIEF_TEMPLATE.length}`)
  check('helper: MIN is ~100', MIN_BRAND_CONTEXT_CHARS === 100)
  check('helper: explicit false not brand', buildRequiresBrandContext({ requiresBrandFlag: false, steps: [{ tool: 'pptxgen' }] }) === false)
  check('helper: pptxgen backstops when flag absent', buildRequiresBrandContext({ requiresBrandFlag: null, steps: [{ tool: 'pptxgen' }] }) === true)
  check('helper: xlsxgen not brand', buildRequiresBrandContext({ requiresBrandFlag: null, steps: [{ tool: 'xlsxgen' }] }) === false)

  // ── Gate: brand build, NO project → blocked ─────────────────────────
  currentDecision = { ...deckPlan, requires_brand_context: true }
  const a = await orchestrate(run({ activeProject: null }))
  check('A: blocked when no project', a.mode === 'blocked', a.mode)
  check('A: block reason set', a.block?.reason === 'needs_brand_context')
  check('A: message asks for brief', /add a description|paste a brand brief/i.test(a.block?.message || ''))
  check('A: reasoning admits no context', /no project is active|no usable brief/i.test(a.reasoning || ''))

  // ── Gate: brand build, project WITHOUT usable brief → blocked ───────
  currentDecision = { ...deckPlan, requires_brand_context: true }
  const b = await orchestrate(run({ activeProject: { id: 'p1', name: 'Timberline', description: 'deals' } }))
  check('B: blocked, thin brief', b.mode === 'blocked', b.mode)
  check('B: names the project', (b.block?.message || '').includes('Timberline'))

  // ── Gate: brand build, project WITH rich brief → builds + carries it ─
  currentDecision = { ...deckPlan, requires_brand_context: true }
  const c = await orchestrate(run({ activeProject: { id: 'p1', name: 'Timberline', description: RICH_BRIEF } }))
  check('C: builds with brief', c.mode === 'build', c.mode)
  check('C: plan carries brandContext', c.plan?.brandContext === RICH_BRIEF)

  // ── Gate: in-message brief escape (no project) → builds, uses message ─
  currentDecision = { ...deckPlan, requires_brand_context: true, brand_brief_in_message: true }
  const d = await orchestrate(run({ userMessage: 'Our product is X for Y, voice is Z. Make a deck.', activeProject: null }))
  check('D: builds via in-message brief', d.mode === 'build', d.mode)
  check('D: carries message as brandContext', /Our product is X/.test(d.plan?.brandContext || ''))

  // ── Trust an explicit "not brand" → builds even with pptxgen ─────────
  currentDecision = { ...deckPlan, requires_brand_context: false }
  const e = await orchestrate(run({ userMessage: 'turn my quarterly numbers into a deck', activeProject: null }))
  check('E: explicit non-brand builds', e.mode === 'build', e.mode)
  check('E: no brandContext attached', !e.plan?.brandContext)

  // ── Neutral build (data spreadsheet), flag absent → not gated ───────
  currentDecision = {
    mode: 'build', spend_mode: 'balanced', agents_to_respond: [], rounds: 1,
    response_mode: 'concise', build_intent: 'create', deliverable: 'Data',
    plan: { steps: [
      { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'spreadsheet', input: 'tabulate' },
      { id: 's2', tool: 'xlsxgen', needs: ['s1'], input: '{s1}' },
    ] }, reasoning: 'x',
  }
  const f = await orchestrate(run({ userMessage: 'make a spreadsheet of my expenses', activeProject: null }))
  check('F: neutral build not gated', f.mode === 'build', f.mode)

  // ── System prompt: no context → forbids fabrication ─────────────────
  const pNoCtx = buildSystemPrompt({ agentId: 'claude', projectName: 'Timberline' })
  check('G: prompt names project w/o brief', pNoCtx.includes('NO brand brief is on file'))
  check('G: prompt forbids inventing', /do NOT infer it from the name/i.test(pNoCtx))
  check('G: prompt forbids fake prior sessions', /No prior conversations/i.test(pNoCtx))

  const pBrief = buildSystemPrompt({ agentId: 'claude', projectName: 'Timberline', projectBrief: RICH_BRIEF })
  check('H: prompt injects brief', pBrief.includes('BRAND BRIEF FOR TIMBERLINE'))
  check('H: brief content present', pBrief.includes('built-by-hunters'))

  const pPrior = buildSystemPrompt({ agentId: 'claude', projectContext: '- "old chat" (yesterday): something' })
  check('I: with prior ctx, no negative note', !/No prior conversations/i.test(pPrior))
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all brand-gate checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
