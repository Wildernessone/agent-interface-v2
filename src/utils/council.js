/**
 * COUNCIL — Karpathy "llm-council" flow for Agent Interface
 * =========================================================
 * Three-stage, multi-model deliberation that turns a question/decision/belief
 * into a stress-tested verdict. Adapted from Andrej Karpathy's open-source
 * `llm-council` (github.com/karpathy/llm-council):
 *
 *   Stage 1 — INDEPENDENT ANSWERS
 *     Every enabled agent (Claude/GPT/Gemini/Grok/DeepSeek) answers the prompt
 *     on its own, in parallel. No agent sees another's answer yet.
 *
 *   Stage 2 — ANONYMIZED PEER REVIEW
 *     Each agent is shown ALL answers with identities stripped ("Response A/B/
 *     C…", order shuffled) and ranks them on accuracy + insight. Anonymizing is
 *     the trick: a model can't flatter itself or play favorites when it doesn't
 *     know which answer is whose.
 *
 *   Stage 3 — CHAIRMAN SYNTHESIS
 *     One chairman model receives every answer + the aggregated rankings and
 *     writes the single unified verdict, noting where the council agreed and
 *     where it split.
 *
 * BYOK: every call uses the user's own provider key — marginal cost to us is $0.
 * Proxy wiring mirrors cheapModel.js (claude = JSON, gpt/grok/gemini = SSE).
 * The result is structured so the UI can render the stages AND hand the
 * transcript to build_podcast for a listenable multi-voice debate (see
 * councilToPodcast).
 */

import { supabase } from './supabase'
import { modelFor } from '../config/models'
import { makeIdleTimeout, isAbort } from './fetchTimeout'
import { parseJsonObject } from './cheapModel'

const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'

// Canonical roster + display names. Only providers the proxy actually routes
// (claude/gpt/gemini/grok) — there is NO /deepseek route, so a DeepSeek key
// would hit OpenAI and fail; it's deliberately excluded until the worker adds a
// route. Voice names line up with build_podcast's AGENT_VOICES so
// councilToPodcast() renders each agent in its own voice.
export const COUNCIL_AGENTS = ['claude', 'gpt', 'gemini', 'grok']
const DISPLAY = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' }
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export function displayName(provider) { return DISPLAY[provider] || provider }

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

function keyFor(settings, provider) { return settings?.agents?.[provider]?.key || null }

/**
 * Which agents can actually sit on the council: enabled (or the full roster)
 * AND holding a usable key. DeepSeek rides the OpenAI wire format via /gpt-style
 * routing only if the proxy supports it; here we only call the four first-class
 * routes (claude/gpt/gemini/grok). DeepSeek is included only if a dedicated key
 * exists and the caller routes it — otherwise it's filtered out.
 */
export function councilMembers(settings, enabledAgents) {
  const pool = (Array.isArray(enabledAgents) && enabledAgents.length ? enabledAgents : COUNCIL_AGENTS)
  return pool.filter(p => COUNCIL_AGENTS.includes(p) && keyFor(settings, p))
}

const ROUTE = { claude: 'claude', gpt: 'gpt', grok: 'grok', gemini: 'gemini' }

// One non-streaming-feeling completion from a SPECIFIC provider with that
// provider's own key. Returns { text, error }. Never throws.
async function callAgent({ provider, key, system = '', prompt, maxTokens = 1400 }) {
  if (!key) return { text: '', error: 'no_key' }
  const composed = system ? `${system}\n\n${prompt}` : prompt
  const route = ROUTE[provider] || 'gpt'
  const model = provider === 'gemini' ? undefined : modelFor(provider)
  const t = makeIdleTimeout()
  try {
    let raw = ''
    if (route === 'claude') {
      const res = await fetch(`${PROXY}/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: 'user', content: composed }], max_tokens: maxTokens, ...(model ? { model } : {}) }),
        signal: t.signal,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data || data.error) { t.clear(); return { text: '', error: `claude_${res.status}` } }
      raw = data.content?.[0]?.text || ''
    } else if (route === 'gemini') {
      const res = await fetch(`${PROXY}/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: composed }] }] }),
        signal: t.signal,
      })
      if (!res.ok) { t.clear(); return { text: '', error: `gemini_${res.status}` } }
      raw = await streamSSE(res, 'gemini', t)
    } else {
      // gpt / grok / deepseek — OpenAI wire format, Bearer auth
      const res = await fetch(`${PROXY}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: 'user', content: composed }], ...(model ? { model } : {}) }),
        signal: t.signal,
      })
      if (!res.ok) { t.clear(); return { text: '', error: `${provider}_${res.status}` } }
      raw = await streamSSE(res, 'openai', t)
    }
    t.clear()
    return { text: (raw || '').trim(), error: raw ? null : 'empty' }
  } catch (e) {
    t.clear()
    return { text: '', error: isAbort(e) ? 'timeout' : e.message }
  }
}

async function streamSSE(res, kind, timeout) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    timeout?.bump()
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      if (!l.startsWith('data: ') || l.includes('[DONE]')) continue
      try {
        const d = JSON.parse(l.slice(6))
        if (kind === 'gemini') {
          const tx = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (tx) full += tx
        } else {
          const c = d.choices?.[0]?.delta?.content
          if (c) full += c
        }
      } catch { /* partial frame */ }
    }
  }
  return full
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const ANSWER_SYS =
  'You sit on a council of independent AI advisors convened to stress-test a ' +
  "question, decision, or belief. Give YOUR best, most honest answer — take a " +
  'clear position, surface the real tradeoffs, and name the strongest objection ' +
  'to your own view. Be specific and substantive, not hedged or generic. ' +
  'No preamble. Aim for 150–300 words.'

function reviewSys(n) {
  return (
    `Below are ${n} anonymous answers (Response ${LABELS.slice(0, n).join('/')}) ` +
    'from other council members to the same prompt. Judge them ONLY on accuracy, ' +
    'insight, and honesty — not length or style. You do not know who wrote which, ' +
    'and one of them may be your own; judge impartially.\n\n' +
    'Reply with ONLY a JSON object:\n' +
    '{"rankings":[{"label":"A","rank":1,"reason":"<one short clause>"}, ...]} ' +
    'where rank 1 = best. Rank every response, no ties.'
  )
}

const CHAIRMAN_SYS =
  'You are the Chairman of an AI council. You are given the original prompt, ' +
  "every member's answer, and the council's aggregated ranking of those answers. " +
  'Synthesize ONE decisive verdict: lead with the answer/recommendation, then the ' +
  'key reasoning, then explicitly note where the council AGREED and where it SPLIT ' +
  '(and which dissent is worth taking seriously). Do not just average them — judge. ' +
  'Be direct and well-structured. No preamble.'

// ── Anonymization ──────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Main flow ────────────────────────────────────────────────────────────────

/**
 * Run the full 3-stage council.
 * @param {object}   o
 * @param {string}   o.question        the user's prompt/decision/belief
 * @param {object}   o.settings        app settings (holds settings.agents[p].key)
 * @param {string[]} [o.enabledAgents] subset of COUNCIL_AGENTS; defaults to all keyed
 * @param {string}   [o.chairman]      provider id to chair; defaults to Claude if keyed
 * @param {boolean}  [o.peerReview]    run stage 2 (default true); false = lean 2-stage
 * @param {function} [o.onStage]       (stage, status, data) progress callback
 * @returns {Promise<object>} { question, members, answers, reviews, ranking, verdict, error }
 */
export async function runCouncil({ question, settings, enabledAgents, chairman, peerReview = true, onStage }) {
  const members = councilMembers(settings, enabledAgents)
  if (members.length < 2) return { error: 'need_two_agents', members }
  const stage = (s, st, d) => { try { onStage?.(s, st, d) } catch { /* non-fatal */ } }

  // ── Stage 1: independent answers (parallel) ──
  stage('answers', 'started', { members })
  const settled = await Promise.all(members.map(async (provider) => {
    const { text, error } = await callAgent({ provider, key: keyFor(settings, provider), system: ANSWER_SYS, prompt: question })
    return { agent: provider, text, error }
  }))
  const answers = settled.filter(a => a.text)
  stage('answers', 'done', { answers })
  if (answers.length < 2) return { error: 'too_few_answers', members, answers }

  // Assign anonymized, shuffled labels.
  const labeled = shuffle(answers).map((a, i) => ({ ...a, label: LABELS[i] }))
  const anonBlock = labeled
    .map(l => `Response ${l.label}:\n${l.text}`)
    .join('\n\n———\n\n')

  // ── Stage 2: anonymized peer review (parallel) ──
  let reviews = []
  const tally = Object.fromEntries(labeled.map(l => [l.label, []]))
  if (peerReview) {
    stage('review', 'started', { count: answers.length })
    reviews = await Promise.all(answers.map(async ({ agent }) => {
      const { text } = await callAgent({
        agent, provider: agent, key: keyFor(settings, agent),
        system: reviewSys(answers.length),
        prompt: `PROMPT:\n${question}\n\nANSWERS:\n${anonBlock}`,
        maxTokens: 500,
      })
      const parsed = parseJsonObject(text)
      const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : []
      for (const r of rankings) {
        if (tally[r.label] && Number.isFinite(Number(r.rank))) tally[r.label].push(Number(r.rank))
      }
      return { agent, rankings, raw: text }
    }))
    stage('review', 'done', { reviews })
  }

  // Aggregate: lower mean rank = better. De-anonymize for display.
  const ranking = labeled.map(l => {
    const ranks = tally[l.label]
    const avg = ranks.length ? ranks.reduce((s, x) => s + x, 0) / ranks.length : null
    return { agent: l.agent, label: l.label, avgRank: avg, votes: ranks.length }
  }).sort((a, b) => {
    if (a.avgRank == null) return 1
    if (b.avgRank == null) return -1
    return a.avgRank - b.avgRank
  })

  // ── Stage 3: chairman synthesis ──
  const chair = (chairman && members.includes(chairman)) ? chairman
    : (members.includes('claude') ? 'claude' : members[0])
  stage('verdict', 'started', { chairman: chair })

  const answersBlock = answers
    .map(a => `${displayName(a.agent)}:\n${a.text}`)
    .join('\n\n———\n\n')
  const rankingBlock = peerReview
    ? 'COUNCIL RANKING (best → worst, by peer vote):\n' +
      ranking.map((r, i) => `${i + 1}. ${displayName(r.agent)}${r.avgRank != null ? ` (avg rank ${r.avgRank.toFixed(2)})` : ''}`).join('\n')
    : '(peer review skipped — synthesize directly from the answers.)'

  const { text: verdictText, error: verdictErr } = await callAgent({
    provider: chair, key: keyFor(settings, chair),
    system: CHAIRMAN_SYS,
    prompt: `PROMPT:\n${question}\n\nMEMBER ANSWERS:\n${answersBlock}\n\n${rankingBlock}`,
    maxTokens: 1600,
  })
  const verdict = { chairman: chair, text: verdictText || '', error: verdictErr }
  stage('verdict', 'done', { verdict })

  return { question, members, answers, reviews, ranking, verdict }
}

// ── Audio adapter ──────────────────────────────────────────────────────────────

/**
 * Turn a council result into build_podcast segments: each member states its
 * position in its own voice, then the chairman delivers the verdict. Speaker
 * names match build_podcast's AGENT_VOICES so each agent gets a distinct voice.
 * Returns { title, segments:[{speaker,text}] }.
 */
export function councilToPodcast(result, { question } = {}) {
  if (!result || !Array.isArray(result.answers)) return null
  const q = question || result.question || 'the question'
  const segments = []
  segments.push({
    speaker: 'Host',
    text: `Today the council convenes on a single question: ${q}. Five AI advisors, each arguing its own view — then a verdict. Let's hear them.`,
  })
  // Lead with the order the council ranked them (best first) when available.
  const order = (result.ranking?.length ? result.ranking.map(r => r.agent) : result.answers.map(a => a.agent))
  for (const agent of order) {
    const ans = result.answers.find(a => a.agent === agent)
    if (!ans) continue
    segments.push({ speaker: displayName(agent), text: condense(ans.text) })
  }
  if (result.verdict?.text) {
    segments.push({ speaker: displayName(result.verdict.chairman) || 'Host', text: `The verdict. ${condense(result.verdict.text)}` })
  }
  return { title: `Council: ${q.slice(0, 60)}`, segments }
}

/**
 * Turn a council result into ordered turns for LIVE in-browser playback via
 * VoiceEngine.speak(text, agentId) — each turn carries the agentId (so the engine
 * picks that model's voice) plus a display label and condensed text. The intro and
 * verdict are voiced by the chairman. Distinct from councilToPodcast (which targets
 * the build_podcast .mp3 pipeline and labels speakers by display name).
 * Returns { title, turns:[{ agentId, label, text }] }.
 */
export function councilToSpeech(result) {
  if (!result || !Array.isArray(result.answers) || !result.answers.length) return null
  const q = result.question || 'the question'
  const chair = result.verdict?.chairman || result.answers[0].agent
  const turns = []
  turns.push({ agentId: chair, label: 'The Council', text: `The council convenes on one question. ${q}` })
  const order = (result.ranking?.length ? result.ranking.map(r => r.agent) : result.answers.map(a => a.agent))
  for (const agent of order) {
    const ans = result.answers.find(a => a.agent === agent)
    if (ans) turns.push({ agentId: agent, label: displayName(agent), text: condense(ans.text) })
  }
  if (result.verdict?.text) {
    turns.push({ agentId: chair, label: `${displayName(chair)} · verdict`, text: `The verdict. ${condense(result.verdict.text)}` })
  }
  return { title: `Council: ${q.slice(0, 60)}`, turns }
}

// Keep each spoken turn listenable — first ~90 spoken words, sentence-aware.
function condense(text, maxWords = 90) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  const words = clean.split(' ')
  if (words.length <= maxWords) return clean
  const cut = words.slice(0, maxWords).join(' ')
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return lastStop > 40 ? cut.slice(0, lastStop + 1) : cut + '…'
}
