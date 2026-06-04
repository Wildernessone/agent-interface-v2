// Build executor at scale — a big branching plan must run seamlessly: correct
// topo order, per-step failure ISOLATION (one failure doesn't sink independent
// branches), and a finished deliverable for every branch that can produce one.
//
// Also covers CONTENT RESCUE: if agent_synth wrote the content but the
// generator after it FAILED, the content must still be surfaced (never thrown
// away) — while a synth whose generator SUCCEEDED is not double-surfaced.
//
// Loads the REAL buildExecutor via Vite SSR with fake tools. No network.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

try {
  const reg = await server.ssrLoadModule('/src/tools/registry.js')
  const { runBuild } = await server.ssrLoadModule('/src/utils/buildExecutor.js')

  // agent_synth returns an object tagged with the step's label, so we can prove
  // which content got surfaced.
  reg.TOOLS_BY_ID.agent_synth = {
    id: 'agent_synth', keySource: 'agent.claude',
    run: async ({ label }) => ({ title: label || 'synth', sections: [{ heading: 'Body', body: `CONTENT[${label}]` }] }),
  }
  reg.TOOLS_BY_ID.gen_ok = { id: 'gen_ok', keySource: null, run: async () => ({ type: 'document', url: 'data:text/plain,ok', filename: 'g.txt', tool: 'gen_ok' }) }
  reg.TOOLS_BY_ID.gen_fail = { id: 'gen_fail', keySource: null, run: async () => { throw new Error('generator boom') } }
  reg.TOOLS_BY_ID.img_ok = { id: 'img_ok', keySource: null, run: async () => ({ type: 'image', url: 'data:image/png;base64,QQ==', filename: 'p.png', tool: 'img_ok' }) }

  // A 12-step branching plan:
  //  s1..s4  terminal synth  → 4 inline .md deliverables
  //  s5 synth → s6 gen_ok    → 1 file (content delivered; s5 NOT separately surfaced)
  //  s7 synth → s8 gen_fail  → s8 fails; s7 content RESCUED
  //  s9 gen_ok needs s8      → dependency_failed (cascade isolation)
  //  s10 img_ok              → independent image file (unaffected by s8)
  //  s11 synth → s12 gen_fail→ s11 content RESCUED (second orphaned branch)
  const steps = [
    { id: 's1', tool: 'agent_synth', needs: [], label: 'note 1' },
    { id: 's2', tool: 'agent_synth', needs: [], label: 'note 2' },
    { id: 's3', tool: 'agent_synth', needs: [], label: 'note 3' },
    { id: 's4', tool: 'agent_synth', needs: [], label: 'note 4' },
    { id: 's5', tool: 'agent_synth', needs: [], label: 'deck copy' },
    { id: 's6', tool: 'gen_ok', needs: ['s5'], input: '{s5}', label: 'Build deck' },
    { id: 's7', tool: 'agent_synth', needs: [], label: 'ad script' },
    { id: 's8', tool: 'gen_fail', needs: ['s7'], input: '{s7}', label: 'Render ad' },
    { id: 's9', tool: 'gen_ok', needs: ['s8'], input: '{s8}', label: 'Package ad' },
    { id: 's10', tool: 'img_ok', needs: [], label: 'Hero image' },
    { id: 's11', tool: 'agent_synth', needs: [], label: 'email copy' },
    { id: 's12', tool: 'gen_fail', needs: ['s11'], input: '{s11}', label: 'Build email' },
  ]

  const order = []
  const res = await runBuild({ deliverable: 'Big build', steps }, { settings: {}, project: null, proxy: null, hasStorage: false },
    (id, status) => order.push(`${id}:${status}`))

  const fileIds = res.files.map(f => f.stepId)
  const errIds = res.errors.map(e => e.stepId)
  const has = (id) => fileIds.includes(id)
  const textOf = (id) => res.files.find(f => f.stepId === id)?.output?.text || ''

  // Isolation: failures don't crash the build or sink independent work
  check('build did not crash', !!res && Array.isArray(res.files))
  check('terminal notes all delivered (s1-s4)', ['s1', 's2', 's3', 's4'].every(has), fileIds.join(','))
  check('independent image delivered despite failures (s10)', has('s10'))
  check('successful generator delivered (s6)', has('s6'))
  check('s5 NOT double-surfaced (content went into s6)', !has('s5'))

  // Failure recording + cascade
  check('failed generator recorded (s8)', errIds.includes('s8'))
  check('dependent cascaded to dependency_failed (s9)', res.errors.find(e => e.stepId === 's9')?.error === 'dependency_failed')

  // Content rescue: orphaned synth content surfaced, not lost
  check('orphaned synth content rescued (s7)', has('s7'))
  check('rescued file carries the real content', /CONTENT\[ad script\]/.test(textOf('s7')))
  check('rescue is labelled as a generator failure', /generator step failed/.test(res.files.find(f => f.stepId === 's7')?.label || ''))
  check('second orphaned branch rescued (s11)', has('s11') && /CONTENT\[email copy\]/.test(textOf('s11')))

  // Topo order: producers ran before consumers
  check('s5 ran before s6', order.indexOf('s5:done') < order.indexOf('s6:started'))
  check('s7 ran before s8', order.indexOf('s7:done') < order.indexOf('s8:started'))

  // The whole point: the user is NEVER left with nothing usable
  check('build produced usable deliverables', res.files.length >= 7, `files=${res.files.length}`)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all build-stress checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
