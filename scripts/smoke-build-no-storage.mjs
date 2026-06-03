// Smoke: builds must still deliver output when NO cloud storage is connected.
//
// Regression for the bug where runBuild marked every file-producing step
// `save_failed` (and discarded the generated data: URL) whenever the user had
// no Drive/Dropbox connected — because saveToCloud returns null for BOTH "no
// storage" and "save errored". A new BYOK user saw every media/doc build fail.
//
// We load the REAL buildExecutor via Vite SSR and inject fake tools into the
// shared registry, then run a build two ways:
//   - hasStorage:false  → steps succeed, outputs kept inline, no save_failed
//   - hasStorage:true   → saveToCloud (no provider in test) returns null, so
//                         the legitimate save_failed path is preserved
//
// Run with `npm run smoke:nostorage`. No keys/network needed.
import { createServer } from 'vite'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

// Backstop: nothing in this test should hit the network.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })

try {
  const reg = await server.ssrLoadModule('/src/tools/registry.js')
  const { runBuild } = await server.ssrLoadModule('/src/utils/buildExecutor.js')

  const IMG = 'data:image/png;base64,QUJD'
  // Inject fake tools into the SAME registry object buildExecutor imports.
  reg.TOOLS_BY_ID.fake_img = {
    id: 'fake_img', name: 'Fake Image', category: 'media', keySource: null,
    run: async () => ({ type: 'image', url: IMG, filename: 'pic.png', tool: 'fake_img' }),
  }
  reg.TOOLS_BY_ID.fake_bundle = {
    id: 'fake_bundle', name: 'Fake Bundle', category: 'media', keySource: null,
    run: async () => ({ type: 'image_bundle', tool: 'fake_bundle', files: [
      { url: IMG, filename: 'a.png' }, { url: IMG, filename: 'b.png' },
    ] }),
  }

  const plan = {
    deliverable: 'Test build',
    steps: [
      { id: 's1', tool: 'fake_img', needs: [], input: 'make a picture', label: 'Hero image' },
      { id: 's2', tool: 'fake_bundle', needs: [], input: 'make some frames', label: 'Frames' },
    ],
  }

  // ── Case 1: NO storage connected ────────────────────────────────
  {
    const statuses = {}
    const res = await runBuild(plan, { settings: {}, project: null, proxy: null, hasStorage: false },
      (id, status) => { statuses[id] = status })

    check('no-storage: no save_failed errors', !res.errors.some(e => e.error === 'save_failed'),
      JSON.stringify(res.errors))
    check('no-storage: both steps reported done', statuses.s1 === 'done' && statuses.s2 === 'done',
      `s1=${statuses.s1} s2=${statuses.s2}`)
    const f1 = res.files.find(f => f.stepId === 's1')
    check('no-storage: single-file output retained inline', !!f1 && f1.output?.url === IMG && f1.savedLink === null && f1.unsaved === true)
    const f2 = res.files.find(f => f.stepId === 's2')
    check('no-storage: bundle output retained inline', !!f2 && Array.isArray(f2.output?.files) && f2.output.files.length === 2 && f2.unsaved === true)
    check('no-storage: downstream can interpolate the data: URL', res.stepOutputs?.s1?.url === IMG)
  }

  // ── Case 2: storage "connected" but the save returns null ───────
  // (pickProvider finds no provider in the test env, so saveToCloud → null;
  //  with hasStorage:true that must still surface as save_failed.)
  {
    const statuses = {}
    const res = await runBuild(plan, { settings: {}, project: null, proxy: null, hasStorage: true },
      (id, status) => { statuses[id] = status })

    check('storage-but-save-fails: s1 marked save_failed', res.errors.some(e => e.stepId === 's1' && e.error === 'save_failed'))
    check('storage-but-save-fails: s1 reported failed', statuses.s1 === 'failed', `s1=${statuses.s1}`)
    check('storage-but-save-fails: failed file not in files[]', !res.files.some(f => f.stepId === 's1'))
  }
} catch (e) {
  check('smoke ran without throwing', false, e?.stack || String(e))
} finally {
  await server.close()
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
