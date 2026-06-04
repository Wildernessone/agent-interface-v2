/**
 * TIER MATRIX — single source of truth for what each plan unlocks.
 * ===============================================================
 * Feature-gated (BYOK, so we don't bill for inference — we gate capability):
 *   Free     — 1 agent, 1 tool at a time, no memory, no cloud storage
 *   Standard — 1 agent, 2 tools at a time, memory + storage
 *   Pro      — the full multi-agent panel (all agents), all tools, everything
 *
 * The multi-agent panel/debate is the Pro hallmark; Free/Standard are
 * single-agent. `null` means UNLIMITED (no cap) — enforcement treats null as
 * "don't cap". Kept as a plain number/null (not Infinity) so it survives any
 * accidental JSON round-trip.
 */
export const TIERS = {
  free:     { label: 'Free',     rank: 0, agents: 1,    tools: 1,    memory: false, storage: false },
  standard: { label: 'Standard', rank: 1, agents: 1,    tools: 2,    memory: true,  storage: true  },
  pro:      { label: 'Pro',      rank: 2, agents: null, tools: null, memory: true,  storage: true  },
}

export const TIER_ORDER = ['free', 'standard', 'pro']

// 20-day trial schedule, expressed as day boundaries from trial_starts_at:
//   days 0–14  → Pro       (the first 15 days)
//   days 15–19 → Standard  (the next 5)
//   day  20+   → Free
export const TRIAL = { proDays: 15, standardEndsDay: 20, totalDays: 20 }

// Normalize any stored value to a known tier (defensive against bad/legacy data).
export function normalizeTier(tier) {
  return TIERS[tier] ? tier : 'free'
}

export function tierLimits(tier) {
  return TIERS[normalizeTier(tier)]
}

// True when `tier` is at least `min` in the ladder (free < standard < pro).
export function tierAtLeast(tier, min) {
  return TIERS[normalizeTier(tier)].rank >= TIERS[normalizeTier(min)].rank
}

// Cap a count to a tier limit. null limit → unlimited (returns n unchanged).
export function capToLimit(n, limit) {
  return limit == null ? n : Math.min(n, limit)
}
