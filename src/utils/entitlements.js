/**
 * ENTITLEMENTS — turn a user's billing row into hard caps, and apply them.
 * =======================================================================
 * The real, unbypassable enforcement layer. effectiveTier() decides the tier;
 * this resolves it to {agents, tools, memory, storage} and provides pure
 * helpers the send path uses to actually CAP what a turn may use. UI lock
 * badges are a separate nicety — these caps are the source of truth.
 *
 * BYOK means we don't bill for inference, so we gate CAPABILITY, not message
 * count: how many agents talk at once, how many tools are active, and whether
 * memory + cloud storage are available.
 */
import { effectiveTier } from './tier'
import { tierLimits } from '../config/tiers'

export function entitlements(billing, nowMs = Date.now()) {
  const tier = effectiveTier(billing || {}, nowMs)
  const lim = tierLimits(tier)
  return { tier, agents: lim.agents, tools: lim.tools, memory: lim.memory, storage: lim.storage }
}

// Cap the agents that may respond this turn. null limit → unlimited.
// Returns { agents: [...kept], trimmed: <count removed> }.
export function capAgents(agentList, ent) {
  const list = agentList || []
  if (ent.agents == null || list.length <= ent.agents) return { agents: list, trimmed: 0 }
  return { agents: list.slice(0, ent.agents), trimmed: list.length - ent.agents }
}

// Cap the set of ENABLED tools. enabledTools is a map { id: <truthy> }. We keep
// the first N enabled (by key order) and flip the rest off, so downstream code
// (orchestrate, build) only ever sees tools the tier allows.
// Returns { tools: {...}, trimmed }.
export function capTools(enabledTools, ent) {
  const map = enabledTools || {}
  const enabledIds = Object.keys(map).filter(id => map[id])
  if (ent.tools == null || enabledIds.length <= ent.tools) return { tools: map, trimmed: 0 }
  const keep = new Set(enabledIds.slice(0, ent.tools))
  const tools = {}
  for (const [id, v] of Object.entries(map)) tools[id] = keep.has(id) ? v : false
  return { tools, trimmed: enabledIds.length - keep.size }
}

// One concise upgrade nudge describing what the current turn had to trim.
// Returns null when nothing was capped.
export function capNudge({ agentsTrimmed = 0, toolsTrimmed = 0 }, ent) {
  if (!agentsTrimmed && !toolsTrimmed) return null
  const bits = []
  if (agentsTrimmed) bits.push(`${ent.agents} agent${ent.agents === 1 ? '' : 's'} at a time`)
  if (toolsTrimmed) bits.push(`${ent.tools} tool${ent.tools === 1 ? '' : 's'} at a time`)
  return `Your ${ent.tier === 'free' ? 'Free' : 'Standard'} plan allows ${bits.join(' and ')}. Upgrade to Pro for the full multi-agent panel and every tool at once.`
}
