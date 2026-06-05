// State-aware suggested prompts (suggestPrompts) + project-brief auto-detect
// (classifyProjectBrief) + storage gap-fillers. Loaded via Vite SSR with a
// mocked fetch so the cheap-model calls are deterministic.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// Mocked model reply. Tests set `resp` (an object) before each call; the cheap
// model path uses the /claude branch (settings has a claude key) which reads
// res.json().content[0].text.
let resp = {}
globalThis.fetch = async () => {
  const text = JSON.stringify(resp)
  return { ok: true, status: 200, json: async () => ({ content: [{ text }] }), text: async () => text }
}

const settings = { agents: { claude: { key: 'k' } } }

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { suggestPrompts, timeAgo } = await server.ssrLoadModule('/src/utils/suggestPrompts.js')
  const { classifyProjectBrief, briefToDescription } = await server.ssrLoadModule('/src/utils/classifyProjectBrief.js')

  // ── timeAgo ─────────────────────────────────────────────────────────
  check('timeAgo recent → "just now"', timeAgo(new Date().toISOString()) === 'just now')
  check('timeAgo days', timeAgo(new Date(Date.now() - 3 * 86400000).toISOString()) === '3 days ago')
  check('timeAgo bad input → ""', timeAgo('nonsense') === '' && timeAgo(null) === '')

  // ── Stage 1: first session (no history, no storage, no transcript) ───
  const s1 = await suggestPrompts({ recentConversations: [], storageConnections: ['google_drive'], activeAgents: [{}, {}], skills: { loadedAt: 'x' }, settings })
  check('stage1 returns starters', s1.length >= 3 && s1.every(s => s.type === 'starter'), s1.map(s => s.type).join(','))
  check('stage1 starters do NOT auto-send', s1.every(s => !s.send))

  // ── Gap-fillers prepended when setup is missing ─────────────────────
  const gaps = await suggestPrompts({ recentConversations: [], storageConnections: [], activeAgents: [{}], skills: {}, settings })
  check('no drive → Connect Drive first', gaps[0]?.action === 'open_storage', gaps[0]?.action)
  check('gap-filler is a setup card', gaps[0]?.type === 'setup')
  const gapWithDrive = await suggestPrompts({ recentConversations: [], storageConnections: ['google_drive'], activeAgents: [{}], skills: { loadedAt: 'x' }, settings })
  check('drive present → no Connect Drive, add-agent first', gapWithDrive[0]?.action === 'open_agents', gapWithDrive[0]?.action)

  // ── Stage 3: returning user with active project + history ───────────
  const activeProject = { id: 'p1', name: 'Timberline' }
  const recent = [
    { id: 'c1', title: 'Q4 elk campaign', project_id: 'p1', turn_count: 12, updated_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'c2', title: 'random', project_id: null, turn_count: 3, updated_at: new Date().toISOString() },
  ]
  const s3 = await suggestPrompts({ activeProject, recentConversations: recent, storageConnections: ['google_drive'], activeAgents: [{}, {}], skills: { loadedAt: 'x' }, settings })
  const cont = s3.find(s => s.type === 'continue')
  check('stage3 has a continue card', !!cont && /Q4 elk campaign/.test(cont.label), cont?.label)
  check('continue meta shows time + turns', /2 days ago/.test(cont?.meta || '') && /12 turn/.test(cont?.meta || ''), cont?.meta)
  check('stage3 references project name', s3.some(s => /Timberline/.test(s.prompt || '')))
  check('continue card auto-sends', cont?.send === true)

  // ── Stage 3 mixed: returning user, no active project ────────────────
  const mixed = await suggestPrompts({ activeProject: null, recentConversations: recent, storageConnections: ['google_drive'], activeAgents: [{}, {}], skills: { loadedAt: 'x' }, settings })
  check('mixed has continue off most-recent convo', mixed.some(s => s.type === 'continue'))

  // ── Stage 2: short active conversation → dynamic from transcript ─────
  resp = { suggestions: ['Build a deck from what we just outlined', 'Debate whether freemium is right', 'What did Claude push back on?'] }
  const transcript = [
    { role: 'user', text: 'I want to launch a freemium tier' },
    { agent: 'claude', text: "I'd push back on freemium — your audience pays for trust" },
  ]
  const s2 = await suggestPrompts({ activeProject: null, recentConversations: [{ id: 'x', title: 't', project_id: null, updated_at: new Date().toISOString() }], storageConnections: ['google_drive'], activeAgents: [{}, {}], skills: { loadedAt: 'x' }, settings, activeConvoTranscript: transcript })
  check('stage2 uses model-generated next steps', s2.some(s => /deck from what we just outlined/.test(s.label)), s2.map(s => s.label).join(' | '))
  check('stage2 cards are examples that auto-send', s2.filter(s => s.type === 'example').every(s => s.send))

  // Stage 2 empty model reply → falls back to starters (never blank)
  resp = { suggestions: [] }
  const s2empty = await suggestPrompts({ activeProject: null, recentConversations: [], storageConnections: ['google_drive'], activeAgents: [{}, {}], skills: { loadedAt: 'x' }, settings, activeConvoTranscript: [{ role: 'user', text: 'unique-transcript-key-xyz' }, { agent: 'gpt', text: 'ok' }] })
  check('stage2 empty → never blank', s2empty.length >= 3)

  // ── classifyProjectBrief: a real brief is detected + extracted ──────
  resp = { is_project_brief: true, confidence: 0.92, extracted: { name: 'Timberline', type: 'hunting deal tracker', description: 'Scrapes 60-70 brands daily for real backcountry hunting deals, filtering fake sales.', audience: 'backcountry hunters', voice: 'blunt, no-hype' } }
  const longBrief = "I'm launching Timberline, a hunting deal tracker. It's for backcountry hunters who hate fake sales. We scrape 60-70 brands daily and only surface real markdowns, no inflated MSRPs."
  const det = await classifyProjectBrief(longBrief, settings)
  check('brief detected', det.is_project_brief === true && det.confidence > 0.7)
  check('brief name extracted', det.extracted?.name === 'Timberline')
  check('brief type extracted', det.extracted?.type === 'hunting deal tracker')

  // briefToDescription composes a brand brief that clears the gate threshold
  const desc = briefToDescription(det.extracted)
  check('description folds in what/audience/voice', /What it is:/.test(desc) && /Audience:/.test(desc) && /Voice/.test(desc))
  check('description clears MIN_BRAND_CONTEXT_CHARS (~100)', desc.length >= 100, `len=${desc.length}`)

  // Short message → never classified (no model call)
  const shortDet = await classifyProjectBrief('thinking about lunch', settings)
  check('short message → not a brief', shortDet.is_project_brief === false)

  // Model says NO → not a brief
  resp = { is_project_brief: false }
  const noDet = await classifyProjectBrief("I'm working on something cool and I'm really excited about where it could go someday soon.", settings)
  check('vague long message → not a brief', noDet.is_project_brief === false)

  // Missing name guard: model returns true but no name → rejected
  resp = { is_project_brief: true, confidence: 0.9, extracted: { name: '', description: 'a thing that does stuff for people who like things and want more of them' } }
  const noName = await classifyProjectBrief('A long message that is over the one hundred and fifty character threshold but the extracted name came back empty from the classifier model output.', settings)
  check('no name extracted → rejected', noName.is_project_brief === false)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all suggested-prompts checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
