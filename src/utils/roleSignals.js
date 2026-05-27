/**
 * Role outcome signals — V3a passive learning loop.
 *
 * Reads what the user does after a turn and turns it into per-role
 * outcome rows. Aggregated over time, these become priors the
 * dispatcher injects into its next decision.
 *
 * Signal sources (passive only in v3a):
 *  - correction_phrase: user said something corrective ("no", "wrong",
 *      "that's not what I meant"). The previous turn's roles get a
 *      negative signal — we don't know which one failed, so all share blame.
 *  - build_approval: user said "build it" / "ship it" / "perfect" after
 *      a discuss turn. Previous turn's roles get positive.
 *  - role_request: user said "what does the [Skeptic] think" — the
 *      previous turn's assigned roles get a soft negative ("you should
 *      have called X instead"), and we hint that the requested role
 *      had high value for this context.
 *  - audit_fail: comes from V2's audit pass when a specialist drifted.
 *      Already specific to (agent, role) — written directly via the
 *      logAuditFail helper, not derived from user messages.
 *
 * Future (v3b): explicit thumbs ⌃/⌄ wired through logExplicitSignal.
 */

import { supabase } from './supabase'
import { ROLE_POOL } from './openClaw'

const CORRECTION_PHRASES = [
  "that's not what i meant", "not what i wanted", "no i wanted", "no i meant",
  "actually", "i meant", "i said", "wrong", "not right", "try again",
  "that's not", "you should have", "you didn't",
]

const BUILD_APPROVAL_PHRASES = [
  "build it", "build this", "ship it", "let's ship", "go for it",
  "do it now", "yes do it", "yes build", "yes make it",
  "perfect", "love it", "great call",
]

const ROLE_NAMES_LOWER = Object.fromEntries(
  Object.entries(ROLE_POOL).map(([id, def]) => [def.name.toLowerCase(), id])
)

/**
 * Read a user message + the prior turn's role assignments, return a list
 * of signals to log. Empty list = no signal, don't log anything.
 */
export function detectSignalsFromUserMessage(userText, previousAssignments) {
  if (!userText || !previousAssignments) return []
  const lower = userText.toLowerCase()
  const signals = []
  const assignments = Object.entries(previousAssignments) // [[agentId, roleId], ...]
  if (assignments.length === 0) return []

  const isCorrection = CORRECTION_PHRASES.some(p => lower.includes(p))
  const isBuildApproval = BUILD_APPROVAL_PHRASES.some(p => lower.includes(p))

  // "What does the Skeptic think" / "I want the Builder to weigh in"
  let requestedRoleId = null
  for (const [name, id] of Object.entries(ROLE_NAMES_LOWER)) {
    if (lower.includes(`the ${name}`) || lower.includes(`${name} think`) || lower.includes(`${name} say`)) {
      requestedRoleId = id
      break
    }
  }

  if (isCorrection) {
    for (const [agentId, roleId] of assignments) {
      signals.push({ agent_id: agentId, role_id: roleId, signal: 'negative', signal_source: 'correction_phrase' })
    }
  } else if (isBuildApproval) {
    for (const [agentId, roleId] of assignments) {
      signals.push({ agent_id: agentId, role_id: roleId, signal: 'positive', signal_source: 'build_approval' })
    }
  }

  if (requestedRoleId && !assignments.some(([, r]) => r === requestedRoleId)) {
    // User wanted a role we didn't assign — log each assigned role as a soft
    // miss, plus a single "role_request" marker so the dispatcher learns
    // this user values that role
    for (const [agentId, roleId] of assignments) {
      signals.push({ agent_id: agentId, role_id: roleId, signal: 'negative', signal_source: 'role_request' })
    }
    // The requested role itself: no agent to attribute, log under a placeholder
    signals.push({ agent_id: '_any_', role_id: requestedRoleId, signal: 'role_request', signal_source: 'role_request' })
  }

  return signals
}

/**
 * Batch-insert signals. Silent failure — outcomes are best-effort, never
 * block the conversation flow.
 */
export async function logSignals(signals, conversationId = null) {
  if (!signals?.length) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const rows = signals.map(s => ({
      ...s,
      user_id: user.id,
      conversation_id: conversationId,
      created_at: new Date().toISOString(),
    }))
    await supabase.from('role_outcomes').insert(rows)
  } catch {
    // best-effort
  }
}

/**
 * Log a single audit failure from V2 — written directly with full
 * (agent, role) attribution. Called from a window event listener.
 */
export async function logAuditFail(agentId, roleId, conversationId = null) {
  return logSignals(
    [{ agent_id: agentId, role_id: roleId, signal: 'audit_fail', signal_source: 'v2_audit' }],
    conversationId
  )
}

/**
 * Read aggregated performance for the current user. Returns:
 *   [{ agent_id, role_id, total, positive, negative, positive_pct }]
 * Rolling 90-day window so the system adapts to the user's evolving
 * preferences and to model improvements.
 */
export async function getRecentRolePerformance(daysBack = 90) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase.from('role_outcomes')
      .select('agent_id, role_id, signal')
      .eq('user_id', user.id)
      .gte('created_at', since)
    if (!data?.length) return []

    // Aggregate in JS — small dataset, no need for a DB view
    const buckets = new Map()
    for (const row of data) {
      const key = `${row.agent_id}::${row.role_id}`
      if (!buckets.has(key)) buckets.set(key, { agent_id: row.agent_id, role_id: row.role_id, total: 0, positive: 0, negative: 0 })
      const b = buckets.get(key)
      b.total += 1
      // Explicit signals weight 10× passive ones — see v3b roadmap
      const weight = row.signal.startsWith('explicit_') ? 10 : 1
      if (row.signal === 'positive' || row.signal === 'explicit_up') b.positive += weight
      if (row.signal === 'negative' || row.signal === 'explicit_down' || row.signal === 'audit_fail') b.negative += weight
    }
    return Array.from(buckets.values())
      .map(b => ({ ...b, positive_pct: b.total ? Math.round((b.positive / (b.positive + b.negative + 1)) * 100) : 0 }))
      .filter(b => b.total >= 2) // ignore single-sample noise
      .sort((a, b) => b.total - a.total)
  } catch {
    return []
  }
}
