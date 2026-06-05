/**
 * SUGGESTED PROMPTS — state-aware empty-state suggestions.
 * ========================================================
 * "Don't ask users to build something the panel knows nothing about."
 *
 * Three stages, each more specific than the last:
 *   1. First session (no history, no storage) → conversation STARTERS that
 *      establish context, not build requests.
 *   2. Mid-conversation (2-5 turns, no project) → dynamic next-steps generated
 *      from the actual transcript via the cheapest fast model (cached 60s).
 *   3. Returning user with project context → reflective / next-deliverable
 *      prompts grounded in real project history.
 *
 * Gap-fillers (connect Drive, add an agent, drop a brief) are PREPENDED when
 * the relevant setup is missing — the most useful thing to surface is the
 * thing blocking real work.
 *
 * Each suggestion: { type, label, prompt, meta, icon, send?, action? }
 *   type   — visual treatment + icon ('continue'|'example'|'setup'|'next'|'starter')
 *   prompt — what gets put in the composer
 *   send   — true → auto-send on click; false/absent → just populate the input
 *   action — for setup cards: 'open_storage'|'open_agents'|'open_skills' (no send)
 */

import { callCheapModel, parseJsonObject } from './cheapModel'

const ICONS = { continue: '➜', example: '✨', setup: '🔧', next: '💡', starter: '💬' }

function icon(type) { return ICONS[type] || '💬' }

// Human "3 days ago" from an ISO/Date string. Defensive — bad input → ''.
export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24); if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`
  const w = Math.floor(d / 7); if (w < 5) return `${w} week${w > 1 ? 's' : ''} ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo} month${mo > 1 ? 's' : ''} ago`
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) > 1 ? 's' : ''} ago`
}

// ── Stage 1: conversation starters (invitations, not builds) ───────────
function stage1() {
  return [
    { type: 'starter', label: "Tell the panel what you're working on", prompt: "Here's what I'm working on right now: ", send: false },
    { type: 'starter', label: "Describe a project you'd like to build with the panel", prompt: "I'd like to build ", send: false },
    { type: 'starter', label: "What's a decision you're stuck on? Watch the panel debate it", prompt: "I'm stuck deciding whether to ", send: false },
    { type: 'starter', label: "What are you trying to ship this month?", prompt: "This month I'm trying to ship ", send: false },
  ].map(s => ({ ...s, icon: icon(s.type), meta: null }))
}

// ── Stage 2: dynamic next-steps from the live transcript ───────────────
// Cached so it doesn't re-fire on every render of the empty/idle state.
let _stage2Cache = { key: null, at: 0, value: null }
const STAGE2_TTL = 60_000

function transcriptKey(transcript) {
  const last = transcript?.[transcript.length - 1]
  return `${transcript?.length || 0}:${(last?.text || last?.content || '').slice(0, 40)}`
}

async function stage2(transcript, settings) {
  const key = transcriptKey(transcript)
  if (_stage2Cache.key === key && Date.now() - _stage2Cache.at < STAGE2_TTL && _stage2Cache.value) {
    return _stage2Cache.value
  }

  const convo = (transcript || [])
    .map(t => {
      const who = t.role === 'user' || t.type === 'user' ? 'User'
        : (t.agent ? String(t.agent).toUpperCase() : 'Panel')
      return `${who}: ${(t.text || t.content || '').slice(0, 500)}`
    })
    .join('\n')

  const prompt = [
    "The user has been chatting with an AI panel. Below is the transcript.",
    "Return 3-4 short suggested next prompts (under 12 words each) that would",
    "naturally continue THIS conversation. Use specifics from what was actually",
    "discussed — not generic prompts.",
    "Examples of good output:",
    "  - 'Build a deck from what we just outlined'",
    "  - 'Have the panel debate whether the freemium tier is the right framing'",
    "  - \"What did Claude push back on that's worth revisiting?\"",
    "Return ONLY JSON: { \"suggestions\": [\"...\", \"...\", \"...\"] }",
    "",
    "=== TRANSCRIPT ===",
    convo,
  ].join("\n")

  const { text } = await callCheapModel({ prompt, settings, maxTokens: 400 })
  const parsed = parseJsonObject(text)
  const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : []
  const value = list
    .map(s => (typeof s === 'string' ? s : s?.prompt || s?.label || ''))
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map(label => ({ type: 'example', label, prompt: label, send: true, icon: icon('example'), meta: null }))

  if (value.length) _stage2Cache = { key, at: Date.now(), value }
  return value
}

// ── Stage 3: returning user, grounded in project history ───────────────
function stage3({ activeProject, recentConversations }) {
  const name = activeProject?.name || 'this project'
  const inProject = (recentConversations || []).filter(c => c.project_id === activeProject?.id)
  const last = inProject[0]
  const out = []

  if (last?.title) {
    const turns = last.turn_count ? ` · ${last.turn_count} turn${last.turn_count === 1 ? '' : 's'}` : ''
    out.push({
      type: 'continue',
      label: `Continue "${last.title}"`,
      prompt: `Let's pick up where we left off on "${last.title}".`,
      meta: `${timeAgo(last.updated_at)}${turns}`.trim(),
      send: true,
    })
  }
  out.push({ type: 'next', label: `What's the next deliverable for ${name}?`, prompt: `What's the next deliverable we should build for ${name}?`, send: true, meta: null })
  out.push({ type: 'next', label: 'Review everything the panel built for this project', prompt: `Review everything the panel has built for ${name} so far and tell me where the gaps are.`, send: true, meta: null })
  out.push({ type: 'next', label: 'Start a fresh angle', prompt: `Let's take a fresh angle on ${name}. `, send: false, meta: null })

  return out.map(s => ({ ...s, icon: icon(s.type) }))
}

// Returning user, but no active project (or no convos in it yet): mix a
// "continue" off their most recent conversation with a couple of grounded
// examples so it still feels like the app remembers them.
function stage3MixedWithExamples({ recentConversations }) {
  const last = (recentConversations || [])[0]
  const out = []
  if (last?.title) {
    const turns = last.turn_count ? ` · ${last.turn_count} turn${last.turn_count === 1 ? '' : 's'}` : ''
    out.push({
      type: 'continue',
      label: `Continue "${last.title}"`,
      prompt: `Let's pick up where we left off on "${last.title}".`,
      meta: `${timeAgo(last.updated_at)}${turns}`.trim(),
      send: true,
    })
  }
  out.push({ type: 'next', label: 'Pick up a thread from a past conversation', prompt: "Remind me what we were working on, and let's pick the most promising thread.", send: true, meta: null })
  out.push({ type: 'starter', label: "Start something new — tell the panel what you're working on", prompt: "Here's what I'm working on right now: ", send: false, meta: null })
  out.push({ type: 'next', label: 'Turn one of these into a saved project', prompt: 'Help me turn what I keep coming back to into a proper project.', send: true, meta: null })
  return out.slice(0, 4).map(s => ({ ...s, icon: icon(s.type) }))
}

// ── Gap-fillers: surface blocking setup first ──────────────────────────
function gapFillers({ storageConnections = [], activeAgents = [], skills }) {
  const out = []
  if (!storageConnections.includes('google_drive')) {
    out.push({ type: 'setup', label: "Connect Drive — without it, builds don't save", prompt: '', action: 'open_storage', meta: 'one-time setup' })
  }
  if ((activeAgents?.length || 0) < 2) {
    out.push({ type: 'setup', label: 'Add another AI so the panel can actually debate', prompt: '', action: 'open_agents', meta: 'a panel needs ≥2 voices' })
  }
  if (!skills?.loadedAt) {
    out.push({ type: 'setup', label: 'Drop a brand brief into Skills', prompt: '', action: 'open_skills', meta: 'on-brand builds' })
  }
  return out.map(s => ({ ...s, icon: icon('setup'), send: false }))
}

/**
 * Compute 3-4 suggestions for the current app state. Async — stage 2 makes a
 * cheap model call. Always resolves (never throws); on any failure it falls
 * back to stage-1 starters.
 */
export async function suggestPrompts({
  activeProject,
  recentConversations = [],
  settings,
  skills,
  storageConnections = [],
  activeAgents = [],
  activeConvoTranscript = null,
} = {}) {
  let base
  try {
    if (activeProject && recentConversations.some(c => c.project_id === activeProject.id)) {
      base = stage3({ activeProject, recentConversations })
    } else if (recentConversations.length === 0 && storageConnections.length === 0 && !activeConvoTranscript) {
      base = stage1()
    } else if (activeConvoTranscript && activeConvoTranscript.length >= 2) {
      base = await stage2(activeConvoTranscript, settings)
      if (!base.length) base = stage1()   // model came back empty → never blank
    } else if (recentConversations.length > 0) {
      base = stage3MixedWithExamples({ recentConversations })
    } else {
      base = stage1()
    }
  } catch {
    base = stage1()
  }

  const fillers = gapFillers({ storageConnections, activeAgents, skills })
  return [...fillers, ...base].slice(0, 4)
}
