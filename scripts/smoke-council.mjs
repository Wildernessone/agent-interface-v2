// Council (llm-council) UNIT proof — all network mocked. Verifies the 3-stage
// flow: independent answers → anonymized peer review/ranking → chairman verdict,
// plus member gating and the podcast adapter. Live version would need real keys.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const enc = new TextEncoder()
function sseBody(frames) {
  const chunks = frames.map(f => enc.encode(f))
  let i = 0
  return { getReader: () => ({ read: () => i < chunks.length ? Promise.resolve({ done: false, value: chunks[i++] }) : Promise.resolve({ done: true }) }) }
}
const openaiFrames = (text) => text.match(/.{1,7}/gs).map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n`).concat(['data: [DONE]\n'])
const geminiFrames = (text) => text.match(/.{1,7}/gs).map(p => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] })}\n`)

// Rankings JSON a reviewer returns (covers up to 4 labels; extra labels ignored).
const RANK = '{"rankings":[{"label":"A","rank":1,"reason":"sharp"},{"label":"B","rank":2,"reason":"ok"},{"label":"C","rank":3,"reason":"thin"},{"label":"D","rank":4,"reason":"weak"}]}'
const VERDICT = 'Verdict: proceed, but narrow the scope first. The council mostly agreed; the dissent on timing is worth heeding.'
const ANSWER = 'My position: yes, with caveats. The strongest objection is cost, but the upside dominates over a 12-month window.'

// Pick the right payload for the stage by sniffing the system prompt in the body.
function payloadFor(body) {
  const b = String(body || '')
  if (b.includes('Chairman of an AI council')) return VERDICT
  if (b.includes('Reply with ONLY a JSON object')) return RANK
  return ANSWER
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.endsWith('/claude')) return { ok: true, status: 200, json: async () => ({ content: [{ text: payloadFor(opts.body) }] }) }
  if (u.endsWith('/gpt') || u.endsWith('/grok')) return { ok: true, status: 200, body: sseBody(openaiFrames(payloadFor(opts.body))) }
  if (u.endsWith('/gemini')) return { ok: true, status: 200, body: sseBody(geminiFrames(payloadFor(opts.body))) }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { runCouncil, councilMembers, councilToPodcast, councilToSpeech, displayName } = await server.ssrLoadModule('/src/utils/council.js')

  // ── member gating ──
  check('councilMembers filters un-keyed', JSON.stringify(councilMembers({ agents: { claude: { key: 'c' }, gpt: {} } })) === '["claude"]')
  check('councilMembers honors enabled subset', JSON.stringify(councilMembers({ agents: { claude: { key: 'c' }, gpt: { key: 'g' } } }, ['gpt'])) === '["gpt"]')

  const settings = { agents: { claude: { key: 'c' }, gpt: { key: 'g' }, gemini: { key: 'x' } } }
  const stages = []
  const res = await runCouncil({ question: 'Should I raise prices 20%?', settings, onStage: (s, st) => stages.push(`${s}:${st}`) })

  // ── stage 1: answers ──
  check('3 members answered', res.answers?.length === 3, `got ${res.answers?.length}`)
  check('answers carry agent + text', res.answers?.every(a => a.agent && a.text))

  // ── stage 2: anonymized peer review + aggregation ──
  check('3 reviews returned', res.reviews?.length === 3)
  check('reviews parsed rankings JSON', res.reviews?.every(r => r.rankings.length >= 2))
  check('ranking has one row per member, sorted by avgRank', res.ranking?.length === 3 &&
    res.ranking.every((r, i) => i === 0 || res.ranking[i - 1].avgRank <= r.avgRank))
  check('ranking de-anonymized to real agents', res.ranking?.every(r => ['claude', 'gpt', 'gemini'].includes(r.agent)))

  // ── stage 3: chairman verdict ──
  check('verdict text present', !!res.verdict?.text, res.verdict?.text?.slice(0, 30))
  check('chairman defaults to Claude', res.verdict?.chairman === 'claude')

  // ── stage ordering ──
  check('stages fired in order', stages.join(' ') === 'answers:started answers:done review:started review:done verdict:started verdict:done', stages.join(' '))

  // ── podcast adapter ──
  const pod = councilToPodcast(res)
  check('podcast has Host + 3 agents + verdict (5 segments)', pod?.segments?.length === 5, `got ${pod?.segments?.length}`)
  check('podcast speakers use display names', pod?.segments?.some(s => s.speaker === 'Claude') && pod?.segments?.some(s => s.speaker === 'Host'))

  // ── live-speech adapter (PR #4: one-tap "Hear them argue") ──
  const speech = councilToSpeech(res)
  check('speech has intro + 3 members + verdict (5 turns)', speech?.turns?.length === 5, `got ${speech?.turns?.length}`)
  check('speech turns carry agentId for voice mapping', speech?.turns?.every(t => ['claude', 'gpt', 'gemini', 'grok'].includes(t.agentId)))
  check('speech intro + verdict voiced by chairman (claude)', speech.turns[0].agentId === 'claude' && speech.turns[speech.turns.length - 1].agentId === 'claude')
  check('speech members ordered by council ranking', JSON.stringify(speech.turns.slice(1, 4).map(t => t.agentId)) === JSON.stringify(res.ranking.map(r => r.agent)))
  check('speech turns have labels + non-empty text', speech.turns.every(t => t.label && t.text))
  check('councilToSpeech null-safe on empty result', councilToSpeech({ answers: [] }) === null)

  // ── lean 2-stage (no peer review) ──
  const lean = await runCouncil({ question: 'X?', settings, peerReview: false })
  check('lean mode skips reviews', lean.reviews?.length === 0)
  check('lean mode still produces ranking rows + verdict', lean.ranking?.length === 3 && !!lean.verdict?.text)

  // ── guard: need ≥2 keyed agents ──
  const solo = await runCouncil({ question: 'X?', settings: { agents: { claude: { key: 'c' } } } })
  check('single-agent council refused', solo.error === 'need_two_agents')

  check('displayName maps providers', displayName('gpt') === 'ChatGPT')
} catch (e) {
  check('smoke ran without throwing', false, e.stack || e.message)
} finally {
  await server.close()
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
