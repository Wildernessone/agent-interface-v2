// Boss 302 COMPILE-build smoke test.
//
// Exercises the compile-mode fix end to end through the REAL modules:
//   1. orchestrate() classifies a "compile what we discussed" build as
//      build_intent=compile and injects the actual panel discussion into the
//      first agent_synth step's input (instead of a from-scratch prompt).
//   2. The heuristic fallback also lands on compile when the dispatcher omits
//      build_intent.
//   3. The REAL agent_synth tool receives the injected digest (we assert the
//      request body the tool sends contains the prior discussion).
//   4. The REAL xlsxgen tool turns the synthesized rows into a valid .xlsx.
//
// What is SIMULATED (no live keys available to this harness): the model's
// reply to the dispatcher (a decision JSON) and to agent_synth (a spreadsheet
// JSON). Everything else — routing, digest injection, plan normalization,
// xlsx byte generation — is the real code path. The cloud-save layer is
// bypassed (needs Supabase creds, irrelevant to this fix).
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// ── Browser polyfills xlsxgen needs (Blob exists in Node 18+; createObjectURL does not)
const blobs = new Map()
globalThis.URL.createObjectURL = (b) => { const id = `blob:mock/${blobs.size}`; blobs.set(id, b); return id }

// ── The Boss 302 scenario ────────────────────────────────────────────
const PRIOR_QUESTION = 'What are the key things to know about the 2012 Mustang Boss 302 before buying one?'
const COMPILE_TRIGGER = 'Compile what we discussed into a spreadsheet.'

const PANEL = [
  { agent: 'claude', text: 'Critical Boss 302 buying points: (1) the 5.0L "Road Runner" V8 makes 444 hp and revs to 7500 rpm — confirm the engine has had regular oil changes since it is high-strung. (2) Only ~4,000 made in 2012 plus the Laguna Seca variant, so values are climbing; verify it is a real Boss via the door tag and VIN, not a GT clone. (3) The TremecTR-6060 6-speed manual is the only transmission — check the clutch. (4) Adjustable shocks and the optional Recaro seats matter for value. (5) Watch for track abuse: inspect brakes, tires, and for any roll-bar drill holes.' },
  { agent: 'gemini', text: 'Adding to that: the Boss 302 used a unique intake and "TracKey" second ECU calibration — make sure the TracKey was not lost, it adds value. Documented service history is essential because owners track these. Laguna Seca cars delete the rear seat and add a chassis brace, carbon parts, and stickier tires — they command a premium. Rust is rarely an issue on these late cars but check for accident repaints with a paint gauge. Budget for ~$35k-$55k depending on mileage and which variant.' },
]

// Mock the proxy. Route by request body: the dispatcher prompt says
// "DISPATCHER"; the agent_synth prompt carries the injected digest.
let agentSynthRequestBody = null
const makeFetch = (decisionJson) => async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {}
  const content = body?.messages?.[0]?.content || body?.contents?.[0]?.parts?.[0]?.text || ''
  if (content.includes('DISPATCHER')) {
    return { ok: true, status: 200, json: async () => ({ content: [{ text: decisionJson }] }), text: async () => decisionJson }
  }
  // agent_synth call — capture it so we can assert the digest was injected,
  // then return a representative "organized" spreadsheet (SIMULATED model output).
  agentSynthRequestBody = content
  const sheet = JSON.stringify({
    title: 'Boss 302 Buying Checklist',
    sheets: [{
      name: 'Checklist',
      rows: [
        ['Item', 'What to check', 'Why it matters'],
        ['Engine (5.0 Road Runner)', 'Oil-change history, 7500 rpm health', '444 hp high-strung V8'],
        ['Authenticity', 'Door tag + VIN vs GT clone', 'Only ~4,000 built'],
        ['Transmission', 'TR-6060 6-speed clutch wear', 'Only gearbox offered'],
        ['TracKey', 'Second ECU calibration present', 'Adds value if not lost'],
        ['Variant', 'Laguna Seca brace/carbon/seats', 'Commands a premium'],
        ['Track abuse', 'Brakes, tires, roll-bar holes', 'These get tracked hard'],
        ['Paint', 'Paint-gauge for repaints', 'Detect accident repair'],
        ['Seats', 'Optional Recaro seats', 'Affects value'],
        ['Budget', '$35k–$55k by mileage/variant', 'Set expectations'],
      ],
    }],
  })
  return { ok: true, status: 200, json: async () => ({ content: [{ text: sheet }] }), text: async () => sheet }
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

try {
  const { orchestrate } = await server.ssrLoadModule('/src/utils/openClaw.js')
  const { TOOLS_BY_ID } = await server.ssrLoadModule('/src/tools/registry.js')

  const settings = { agents: { claude: { key: 'sk-ant-smoke' } } }
  const conversationHistory = [
    { role: 'user', content: PRIOR_QUESTION },
    { role: 'user', content: COMPILE_TRIGGER },
  ]
  const baseArgs = {
    userMessage: COMPILE_TRIGGER,
    conversationHistory,
    agentResponses: PANEL,
    enabledAgents: ['claude', 'gemini'],
    enabledTools: {},
    settings,
  }

  // The plan a competent dispatcher returns for this compile request.
  const decisionWithIntent = JSON.stringify({
    mode: 'build', spend_mode: 'balanced', agents_to_respond: [], rounds: 1,
    response_mode: 'concise', build_intent: 'compile', deliverable: 'Boss 302 Checklist',
    plan: { steps: [
      { id: 's1', tool: 'agent_synth', needs: [], output_schema: 'spreadsheet',
        input: 'Organize the panel\'s key Boss 302 buying points into a spreadsheet with columns Item / What to check / Why it matters. Do not add new information.', label: 'Draft the data' },
      { id: 's2', tool: 'xlsxgen', needs: ['s1'], input: '{s1}', label: 'Build the .xlsx' },
    ] },
    reasoning: 'compile prior discussion into a spreadsheet',
  })

  // ── Case A: dispatcher explicitly returns build_intent=compile ──────
  globalThis.fetch = makeFetch(decisionWithIntent)
  const decA = await orchestrate(baseArgs)
  check('A: mode is build', decA.mode === 'build', decA.mode)
  check('A: build_intent is compile', decA.build_intent === 'compile', String(decA.build_intent))
  const sA = decA.plan.steps
  check('A: plan is s1=agent_synth → s2=xlsxgen', sA[0]?.tool === 'agent_synth' && sA[1]?.tool === 'xlsxgen' && sA[1]?.needs?.includes('s1'),
    sA.map(s => s.tool).join(' → '))
  const synthA = sA.find(s => s.tool === 'agent_synth')
  check('A: digest injected into agent_synth input', /PRIOR PANEL DISCUSSION/.test(synthA.input) && synthA.input.includes('Road Runner') && synthA.input.includes('Laguna Seca'),
    `${synthA.input.length} chars`)
  check('A: digest carries the prompting question', synthA.input.includes(PRIOR_QUESTION))
  check('A: original task instruction preserved after digest', /TASK:/.test(synthA.input) && synthA.input.includes('What to check'))
  check('A: digest stays compact (<4500 chars)', synthA.input.length < 4500, `${synthA.input.length} chars`)

  // ── Case B: dispatcher OMITS build_intent → heuristic must infer compile ──
  const decisionNoIntent = JSON.stringify({ ...JSON.parse(decisionWithIntent), build_intent: null })
  globalThis.fetch = makeFetch(decisionNoIntent)
  const decB = await orchestrate(baseArgs)
  check('B: heuristic infers compile when dispatcher omits it', decB.build_intent === 'compile', String(decB.build_intent))
  check('B: digest still injected', /PRIOR PANEL DISCUSSION/.test(decB.plan.steps.find(s => s.tool === 'agent_synth').input))

  // ── Run the REAL agent_synth on Case A's injected input ─────────────
  globalThis.fetch = makeFetch(decisionWithIntent)
  const synthOut = await TOOLS_BY_ID['agent_synth'].run({ prompt: synthA.input, settings, outputSchema: synthA.output_schema })
  check('synth: agent_synth received the injected digest', agentSynthRequestBody?.includes('PRIOR PANEL DISCUSSION') && agentSynthRequestBody?.includes('Road Runner'))
  check('synth: returns {title, sheets[]}', !!synthOut?.title && Array.isArray(synthOut?.sheets) && synthOut.sheets.length === 1)
  const rows = synthOut.sheets[0].rows
  check('synth: ~10 rows incl. header', rows.length >= 8 && rows.length <= 12, `${rows.length} rows`)

  // ── Run the REAL xlsxgen on the synthesized rows (s2 input "{s1}") ───
  const xlsxOut = await TOOLS_BY_ID['xlsxgen'].run({ structuredInput: synthOut, label: 'Boss 302 Checklist' })
  check('xlsx: returns a document with .xlsx filename', xlsxOut?.type === 'document' && /\.xlsx$/.test(xlsxOut.filename), xlsxOut?.filename)
  check('xlsx: reports 1 sheet', xlsxOut?.meta?.sheetCount === 1)
  const blob = blobs.get(xlsxOut.url)
  const buf = blob ? Buffer.from(await blob.arrayBuffer()) : null
  check('xlsx: produced a real (PK-zip) .xlsx file', !!buf && buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 1000, buf ? `${buf.length} bytes` : 'no blob')
} catch (e) {
  check('harness ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
