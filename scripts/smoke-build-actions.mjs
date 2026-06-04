// Action-type build steps (email/sheet/event/payment-link/notion) must surface
// their result so the build card can show a confirmation + link — otherwise a
// build that "creates a Google Sheet" or "sends an email" looks empty (✓ with
// nothing to click). This guards the executor→card contract: action outputs
// land in files[] carrying {type:'action', summary, link}.
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

  reg.TOOLS_BY_ID.fake_sheet = {
    id: 'fake_sheet', keySource: null,
    run: async () => ({ type: 'action', tool: 'gsheets', summary: 'Google Sheet "Budget" created with 2 tabs', link: 'https://docs.google.com/x' }),
  }
  reg.TOOLS_BY_ID.fake_email = {
    id: 'fake_email', keySource: null,
    run: async () => ({ type: 'action', tool: 'gmail', summary: 'Email sent to a@b.com' }), // no link
  }
  reg.TOOLS_BY_ID.fake_doc = {
    id: 'fake_doc', keySource: null,
    run: async () => ({ type: 'document', url: 'data:text/plain,hi', filename: 'd.txt', tool: 'fake_doc' }),
  }

  // Action-only build (the "send an email / make a sheet" case)
  const res = await runBuild(
    { deliverable: 'Ops', steps: [
      { id: 's1', tool: 'fake_sheet', needs: [], label: 'Create budget sheet' },
      { id: 's2', tool: 'fake_email', needs: [], label: 'Email the team' },
    ] },
    { settings: {}, project: null, proxy: null, hasStorage: false }, () => {})

  const actions = res.files.filter(f => f.output?.type === 'action')
  check('both actions surfaced in files[]', actions.length === 2, `count=${actions.length}`)
  check('sheet action carries a summary', /Budget/.test(actions.find(f => f.stepId === 's1')?.output?.summary || ''))
  check('sheet action carries a clickable link', actions.find(f => f.stepId === 's1')?.output?.link === 'https://docs.google.com/x')
  check('email action has summary, no link', /Email sent/.test(actions.find(f => f.stepId === 's2')?.output?.summary || '') && !actions.find(f => f.stepId === 's2')?.output?.link)
  check('no save_failed for actions (no file to save)', !res.errors.some(e => e.error === 'save_failed'))

  // Mixed build: action + a real file → both paths coexist; card separates them.
  const mixed = await runBuild(
    { deliverable: 'Mixed', steps: [
      { id: 's1', tool: 'fake_doc', needs: [], label: 'Doc' },
      { id: 's2', tool: 'fake_sheet', needs: [], label: 'Sheet' },
    ] },
    { settings: {}, project: null, proxy: null, hasStorage: false }, () => {})
  const fileItems = mixed.files.filter(f => f.output?.type !== 'action')
  const actionItems = mixed.files.filter(f => f.output?.type === 'action')
  check('mixed: one real file', fileItems.length === 1 && fileItems[0].stepId === 's1')
  check('mixed: one action result', actionItems.length === 1 && actionItems[0].stepId === 's2')
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all build-action checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
