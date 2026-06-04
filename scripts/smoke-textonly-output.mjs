// Smoke: a TERMINAL agent_synth step (a text deliverable with no generator
// after it — "write me an IG caption") must surface its text. Before this fix
// the build reported "No files produced yet" because agent_synth's JSON isn't a
// file/bundle/action type, so it fell through every handler and vanished.
//
// runBuild now synthesizes a Markdown document from a terminal agent_synth's
// output (readable inline, downloadable). A CONSUMED agent_synth (feeding
// mdgen/pptxgen/etc.) is untouched — that generator makes the real deliverable.
//
// Loads the REAL buildExecutor via Vite SSR and injects fake tools into the
// shared registry. Run with `npm run smoke:textonly`. No keys/network needed.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

// Nothing here should hit the network.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

try {
  const reg = await server.ssrLoadModule('/src/tools/registry.js')
  const { runBuild } = await server.ssrLoadModule('/src/utils/buildExecutor.js')

  // Fake agent_synth returns whatever we stash here (no network). The synthesis
  // path keys off step.tool === 'agent_synth', so we must override that exact id.
  let synthReturn = {}
  reg.TOOLS_BY_ID.agent_synth = {
    id: 'agent_synth', name: 'Agent synthesis', category: 'meta', keySource: 'agent.claude',
    run: async () => synthReturn,
  }
  // A fake downstream generator so we can test the CONSUMED case.
  reg.TOOLS_BY_ID.fake_doc = {
    id: 'fake_doc', name: 'Fake Doc', category: 'document', keySource: null,
    run: async () => ({ type: 'document', url: 'data:text/plain,hi', filename: 'd.txt', tool: 'fake_doc' }),
  }
  const ctxNoStore = { settings: {}, project: null, proxy: null, hasStorage: false }
  const terminalPlan = (label = 'IG caption') => ({
    deliverable: 'Caption', steps: [{ id: 's1', tool: 'agent_synth', needs: [], input: 'x', label }],
  })

  // ── Case A: terminal agent_synth, generic "captions" shape ──────────
  synthReturn = { captions: ['No fake markdowns. Tracked fresh this morning.', 'Real elk gear prices, right now.'] }
  const a = await runBuild(terminalPlan(), ctxNoStore, () => {})
  check('A: produced exactly one file', a.files.length === 1, `len=${a.files.length}`)
  check('A: file is a document', a.files[0]?.output?.type === 'document')
  check('A: filename is .md', /\.md$/.test(a.files[0]?.output?.filename || ''))
  check('A: inline text present', !!a.files[0]?.output?.text)
  check('A: text carries both captions',
    /No fake markdowns/.test(a.files[0].output.text) && /right now/.test(a.files[0].output.text))
  check('A: data: url is markdown', (a.files[0]?.output?.url || '').startsWith('data:text/markdown'))
  check('A: marked unsaved (no storage)', a.files[0]?.unsaved === true)
  check('A: no save_failed error', !a.errors.some(e => e.error === 'save_failed'))

  // ── Case B: terminal agent_synth, post/document shape ───────────────
  synthReturn = { title: 'Elk Week', sections: [{ heading: 'Hook', body: 'Stop overpaying.' }, { heading: 'CTA', items: ['Shop the drops'] }] }
  const b = await runBuild(terminalPlan('Post'), ctxNoStore, () => {})
  check('B: one document file', b.files.length === 1 && b.files[0].output.type === 'document')
  check('B: heading + body rendered',
    /# Elk Week/.test(b.files[0].output.text) && /## Hook/.test(b.files[0].output.text) && /Stop overpaying/.test(b.files[0].output.text))
  check('B: list item rendered', /- Shop the drops/.test(b.files[0].output.text))

  // ── Case C: CONSUMED agent_synth (feeds a generator) → NOT synthesized ─
  synthReturn = { title: 'unused', sections: [{ body: 'intermediate' }] }
  const cPlan = { deliverable: 'Doc build', steps: [
    { id: 's1', tool: 'agent_synth', needs: [], input: 'draft', label: 'Draft' },
    { id: 's2', tool: 'fake_doc', needs: ['s1'], input: '{s1}', label: 'Build doc' },
  ] }
  const c = await runBuild(cPlan, ctxNoStore, () => {})
  check('C: no synth doc for consumed s1', !c.files.some(f => f.stepId === 's1'))
  check('C: only the generator file', c.files.length === 1 && c.files[0].stepId === 's2')

  // ── Case D: terminal agent_synth WITH storage but save returns null ──
  // The text must STILL surface inline (never lose readable copy), unsaved.
  synthReturn = { caption: 'Tracked fresh every morning.' }
  const d = await runBuild(terminalPlan(), { ...ctxNoStore, hasStorage: true }, () => {})
  check('D: file still present when save fails', d.files.length === 1)
  check('D: text preserved', /Tracked fresh/.test(d.files[0]?.output?.text || ''))
  check('D: marked unsaved on failed save', d.files[0]?.unsaved === true)

  // ── Case E: empty/garbage synth output → graceful (no crash) ────────
  synthReturn = {}
  const e = await runBuild(terminalPlan(), ctxNoStore, () => {})
  check('E: empty object yields a file with JSON fallback text', e.files.length === 1 && typeof e.files[0].output.text === 'string')
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all text-only output checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
