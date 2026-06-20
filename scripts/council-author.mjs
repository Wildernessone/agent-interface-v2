/**
 * COUNCIL AUTHOR — the autonomous SEO flywheel author (PR #3c)
 * ============================================================
 * Runs the llm-council 3-stage flow SERVER-SIDE on a high-search-intent topic and
 * inserts the result into `council_pages` as a DRAFT. James approves drafts in the
 * app (CouncilPage admin "Publish to library") → status flips to 'published' →
 * the page goes live at /council/<slug> (functions/council/[slug].js). That published
 * page is the rankable asset — see docs/content-engine/council-content-engine.md.
 *
 * WHY DIRECT PROVIDER CALLS (not the claude-proxy worker):
 *   The browser council (src/utils/council.js) goes through the claude-proxy worker,
 *   which REQUIRES a Supabase user JWT (x-supabase-auth) + an allowed browser Origin
 *   on every model route (infrastructure/cloudflare-proxy/worker.js). A headless cron
 *   has neither. So the author calls each provider's REST API directly with the same
 *   BYOK keys — fewer moving parts, no worker/CORS/rate-limit dependency. The prompts
 *   and 3-stage flow below mirror src/utils/council.js so drafts read like in-app runs.
 *
 * FRUGAL BY DESIGN (real money — these are James's paid keys):
 *   - Drafts ONLY. This script never publishes. Approval is a human step.
 *   - One topic per run by default (--count to raise); skips topics already drafted/
 *     published (dedup by question) so re-runs don't burn tokens on dupes.
 *   - Exits cleanly (code 0) when there's nothing fresh or <2 keys are present, so a
 *     daily routine is a no-op rather than an error once the backlog is caught up.
 *
 * ENV:
 *   COUNCIL_SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)  — required to insert
 *   SUPABASE_URL            — default https://oqbpuspnmznqxgkmyzyb.supabase.co
 *   ANTHROPIC_API_KEY / CLAUDE_API_KEY      — Claude member
 *   OPENAI_API_KEY                          — ChatGPT member
 *   GEMINI_API_KEY / GOOGLE_API_KEY         — Gemini member
 *   XAI_API_KEY / GROK_API_KEY              — Grok member
 *   COUNCIL_TOPICS_FILE     — default docs/content-engine/council-topics.md
 *   COUNCIL_SITE            — default https://agentinterface.app (for the printed link)
 *
 * CLI:
 *   node scripts/council-author.mjs                 # 1 fresh topic → draft
 *   node scripts/council-author.mjs --count=3       # up to 3 fresh topics
 *   node scripts/council-author.mjs --topic="..."   # ad-hoc question (skips topics file)
 *   node scripts/council-author.mjs --dry-run       # run the council, print, DO NOT insert
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { modelFor } from '../src/config/models.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const env = process.env

const SUPABASE_URL = env.SUPABASE_URL || 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const SERVICE_KEY = env.COUNCIL_SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''
const SITE = env.COUNCIL_SITE || 'https://agentinterface.app'
const TOPICS_FILE = env.COUNCIL_TOPICS_FILE || resolve(ROOT, 'docs/content-engine/council-topics.md')
const CALL_TIMEOUT_MS = Number(env.COUNCIL_CALL_TIMEOUT_MS || 120000)

// ── Roster (mirrors COUNCIL_AGENTS in src/utils/council.js) ──────────────────────
const DISPLAY = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', deepseek: 'DeepSeek' }
const ROSTER = ['claude', 'gpt', 'gemini', 'grok', 'deepseek']
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F']
export const displayName = p => DISPLAY[p] || p

function keysFromEnv(e = env) {
  return {
    claude: e.ANTHROPIC_API_KEY || e.CLAUDE_API_KEY || null,
    gpt: e.OPENAI_API_KEY || null,
    gemini: e.GEMINI_API_KEY || e.GOOGLE_API_KEY || null,
    grok: e.XAI_API_KEY || e.GROK_API_KEY || null,
    deepseek: e.DEEPSEEK_API_KEY || null,
  }
}

// ── Prompts (copied verbatim from src/utils/council.js so drafts == in-app runs) ──
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

// ── Direct provider calls (REST, non-streaming). Returns { text, error }. ────────
async function callProvider({ provider, key, system = '', prompt, maxTokens = 1400 }) {
  if (!key) return { text: '', error: 'no_key' }
  const composed = system ? `${system}\n\n${prompt}` : prompt
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
  try {
    let res, data, text
    if (provider === 'claude') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelFor('claude'), max_tokens: maxTokens, messages: [{ role: 'user', content: composed }] }),
        signal: ctrl.signal,
      })
      data = await res.json().catch(() => null)
      if (!res.ok || !data || data.error) return { text: '', error: `claude_${res.status}` }
      text = data.content?.[0]?.text || ''
    } else if (provider === 'gemini') {
      const model = modelFor('gemini')
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: composed }] }], generationConfig: { maxOutputTokens: maxTokens } }),
        signal: ctrl.signal,
      })
      data = await res.json().catch(() => null)
      if (!res.ok || !data || data.error) return { text: '', error: `gemini_${res.status}` }
      text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    } else {
      // gpt / grok / deepseek — OpenAI-compatible chat completions, Bearer auth
      const base = provider === 'grok' ? 'https://api.x.ai/v1'
        : provider === 'deepseek' ? 'https://api.deepseek.com/v1'
        : 'https://api.openai.com/v1'
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: modelFor(provider), max_tokens: maxTokens, messages: [{ role: 'user', content: composed }], stream: false }),
        signal: ctrl.signal,
      })
      data = await res.json().catch(() => null)
      if (!res.ok || !data || data.error) return { text: '', error: `${provider}_${res.status}` }
      text = data.choices?.[0]?.message?.content || ''
    }
    return { text: (text || '').trim(), error: text ? null : 'empty' }
  } catch (e) {
    return { text: '', error: e.name === 'AbortError' ? 'timeout' : (e.message || 'error') }
  } finally {
    clearTimeout(timer)
  }
}

// ── Pure helpers (exported for the smoke test) ───────────────────────────────────
export const slugify = q => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
export const shortId = () => Math.random().toString(36).slice(2, 7)
const normQ = q => String(q || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()

/** Parse `- question` bullets out of the topics markdown. Ignores headings, blanks,
 *  HTML comments, and `>` notes. A topic line may carry a `:: topic-tag` suffix. */
export function parseTopics(md) {
  const out = []
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('<!--')) continue
    const m = line.match(/^[-*]\s+(.+)$/)
    if (!m) continue
    let q = m[1].trim()
    let topic = null
    const tag = q.match(/\s*::\s*([a-z0-9-]+)\s*$/i)
    if (tag) { topic = tag[1].toLowerCase(); q = q.slice(0, tag.index).trim() }
    q = q.replace(/\*\*/g, '').replace(/__/g, '').trim()
    if (q.length > 8) out.push({ question: q, topic })
  }
  return out
}

/** Drop topics whose question already exists (drafted or published), then take `count`. */
export function pickFreshTopics(topics, existingQuestions, count = 1) {
  const seen = new Set((existingQuestions || []).map(normQ))
  const fresh = []
  for (const t of topics) {
    const k = normQ(t.question)
    if (!k || seen.has(k)) continue
    seen.add(k)
    fresh.push(t)
    if (fresh.length >= count) break
  }
  return fresh
}

/** Tolerant single-JSON-object extractor for the peer-review reply. */
export function parseJsonLoose(text) {
  const s = String(text || '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(body.slice(start, end + 1)) } catch { return null }
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Aggregate per-label rank tallies (lower mean = better) into a de-anonymized,
 *  sorted ranking. `labeled` = [{ agent, label }], `tally` = { label: [ranks] }. */
export function aggregateRanking(labeled, tally) {
  return labeled.map(l => {
    const ranks = tally[l.label] || []
    const avg = ranks.length ? ranks.reduce((s, x) => s + x, 0) / ranks.length : null
    return { agent: l.agent, label: l.label, avgRank: avg, votes: ranks.length }
  }).sort((a, b) => {
    if (a.avgRank == null) return 1
    if (b.avgRank == null) return -1
    return a.avgRank - b.avgRank
  })
}

/** Shape a finished council result into a council_pages DRAFT row. */
export function shapeRow(result, { topic = null } = {}) {
  return {
    slug: `${slugify(result.question) || 'verdict'}-${shortId()}`,
    question: result.question,
    topic,
    verdict: result.verdict?.text || '',
    chairman: result.verdict?.chairman || null,
    members: result.answers.map(a => a.agent),
    answers: result.answers.map(a => ({ agent: a.agent, text: a.text })),
    ranking: (result.ranking || []).map(r => ({ agent: r.agent, meanRank: r.avgRank })),
    status: 'draft',
    created_by: null,
  }
}

// ── The 3-stage council (mirrors runCouncil in src/utils/council.js) ─────────────
export async function runCouncil({ question, members, keys, call = callProvider, rnd = Math.random }) {
  if (members.length < 2) return { error: 'need_two_agents', members }

  // Stage 1 — independent answers
  const settled = await Promise.all(members.map(async provider => {
    const { text, error } = await call({ provider, key: keys[provider], system: ANSWER_SYS, prompt: question })
    return { agent: provider, text, error }
  }))
  const answers = settled.filter(a => a.text)
  if (answers.length < 2) return { error: 'too_few_answers', members, answers }

  // Anonymize + shuffle
  const labeled = shuffle(answers, rnd).map((a, i) => ({ ...a, label: LABELS[i] }))
  const anonBlock = labeled.map(l => `Response ${l.label}:\n${l.text}`).join('\n\n———\n\n')

  // Stage 2 — blind peer review
  const tally = Object.fromEntries(labeled.map(l => [l.label, []]))
  const reviews = await Promise.all(answers.map(async ({ agent }) => {
    const { text } = await call({
      provider: agent, key: keys[agent], system: reviewSys(answers.length),
      prompt: `PROMPT:\n${question}\n\nANSWERS:\n${anonBlock}`, maxTokens: 500,
    })
    const parsed = parseJsonLoose(text)
    const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : []
    for (const r of rankings) if (tally[r.label] && Number.isFinite(Number(r.rank))) tally[r.label].push(Number(r.rank))
    return { agent, rankings }
  }))

  const ranking = aggregateRanking(labeled, tally)

  // Stage 3 — chairman synthesis (Claude chairs if present, else best-ranked)
  const chair = members.includes('claude') ? 'claude' : (ranking[0]?.agent || members[0])
  const answersBlock = answers.map(a => `${displayName(a.agent)}:\n${a.text}`).join('\n\n———\n\n')
  const rankingBlock = 'COUNCIL RANKING (best → worst, by peer vote):\n' +
    ranking.map((r, i) => `${i + 1}. ${displayName(r.agent)}${r.avgRank != null ? ` (avg rank ${r.avgRank.toFixed(2)})` : ''}`).join('\n')
  const { text: verdictText, error: verdictErr } = await call({
    provider: chair, key: keys[chair], system: CHAIRMAN_SYS,
    prompt: `PROMPT:\n${question}\n\nMEMBER ANSWERS:\n${answersBlock}\n\n${rankingBlock}`, maxTokens: 1600,
  })

  return { question, members, answers, reviews, ranking, verdict: { chairman: chair, text: verdictText || '', error: verdictErr } }
}

// ── Supabase REST (service key — bypasses RLS for the headless author) ───────────
async function sbExistingQuestions() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/council_pages?select=question&limit=2000`, {
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error(`list council_pages failed: ${r.status} ${await r.text().catch(() => '')}`)
  return (await r.json()).map(x => x.question)
}

async function sbInsertDraft(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/council_pages`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!r.ok) throw new Error(`insert draft failed: ${r.status} ${await r.text().catch(() => '')}`)
  return (await r.json())[0]
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { count: 1, dryRun: false, topic: null }
  for (const s of argv) {
    if (s === '--dry-run') a.dryRun = true
    else if (s.startsWith('--count=')) a.count = Math.max(1, Number(s.slice(8)) || 1)
    else if (s.startsWith('--topic=')) a.topic = s.slice(8)
  }
  return a
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const keys = keysFromEnv()
  const members = ROSTER.filter(p => keys[p])

  console.log(`[council-author] members with keys: ${members.map(displayName).join(', ') || '(none)'}`)
  if (members.length < 2) {
    console.log('[council-author] need ≥2 provider keys to convene a council — nothing to do. Exiting cleanly.')
    return
  }
  if (!args.dryRun && !SERVICE_KEY) {
    console.error('[council-author] COUNCIL_SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required to insert drafts. Use --dry-run to test without it.')
    process.exitCode = 1
    return
  }

  // Pick topics
  let chosen
  if (args.topic) {
    chosen = [{ question: args.topic.trim(), topic: null }]
  } else {
    let md = ''
    try { md = readFileSync(TOPICS_FILE, 'utf8') } catch { console.error(`[council-author] cannot read topics file: ${TOPICS_FILE}`); process.exitCode = 1; return }
    const topics = parseTopics(md)
    const existing = args.dryRun ? [] : await sbExistingQuestions()
    chosen = pickFreshTopics(topics, existing, args.count)
    console.log(`[council-author] ${topics.length} topics in file, ${existing.length} already drafted/published, ${chosen.length} fresh selected.`)
  }
  if (!chosen.length) { console.log('[council-author] no fresh topics — backlog caught up. Exiting cleanly.'); return }

  let made = 0
  for (const t of chosen) {
    console.log(`\n[council-author] convening on: ${t.question}`)
    const result = await runCouncil({ question: t.question, members, keys })
    if (result.error) { console.error(`[council-author]   council failed (${result.error}) — skipping.`); continue }
    const okMembers = result.answers.map(a => displayName(a.agent)).join(', ')
    console.log(`[council-author]   answered: ${okMembers}; chaired by ${displayName(result.verdict.chairman)}`)
    console.log(`[council-author]   verdict (${(result.verdict.text || '').length} chars): ${(result.verdict.text || '').slice(0, 160).replace(/\s+/g, ' ')}…`)

    const row = shapeRow(result, { topic: t.topic })
    if (args.dryRun) { console.log(`[council-author]   --dry-run: NOT inserting. Would draft slug=${row.slug}`); made++; continue }
    const saved = await sbInsertDraft(row)
    made++
    console.log(`[council-author]   DRAFT saved: ${saved.slug}  (approve in-app → live at ${SITE}/council/${saved.slug})`)
  }
  console.log(`\n[council-author] done. ${made} draft(s). Approve them in CouncilPage (admin “Publish to library”).`)
}

// Run main() only when invoked directly — the smoke test imports the pure helpers.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error('[council-author] fatal:', e.message); process.exitCode = 1 })
}
