// Tier matrix + trial clock. These decide what every user can do, so the day
// boundaries and the paid-override must be exact: Pro days 1-15, Standard 16-20,
// Free after; an active paid subscription ignores the clock.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { TIERS, tierLimits, tierAtLeast, capToLimit } = await server.ssrLoadModule('/src/config/tiers.js')
  const { effectiveTier, trialInfo } = await server.ssrLoadModule('/src/utils/tier.js')

  const NOW = 1_900_000_000_000 // fixed reference; values are relative to it
  const DAY = 86400000
  const startedDaysAgo = (n) => ({ trial_starts_at: new Date(NOW - n * DAY).toISOString() })

  // ── Matrix ──────────────────────────────────────────────────────────
  check('free = 1 agent, 1 tool, no memory/storage', TIERS.free.agents === 1 && TIERS.free.tools === 1 && !TIERS.free.memory && !TIERS.free.storage)
  check('standard = 1 agent, 2 tools, memory+storage', TIERS.standard.agents === 1 && TIERS.standard.tools === 2 && TIERS.standard.memory && TIERS.standard.storage)
  check('pro = unlimited agents/tools, everything', TIERS.pro.agents === null && TIERS.pro.tools === null && TIERS.pro.memory && TIERS.pro.storage)
  check('tierAtLeast ladder', tierAtLeast('pro', 'standard') && tierAtLeast('standard', 'free') && !tierAtLeast('free', 'standard'))
  check('capToLimit: free caps to 1', capToLimit(4, tierLimits('free').agents) === 1)
  check('capToLimit: pro uncapped', capToLimit(4, tierLimits('pro').agents) === 4)

  // ── Trial clock boundaries ──────────────────────────────────────────
  check('day 0 → pro', effectiveTier(startedDaysAgo(0), NOW) === 'pro')
  check('day 14 → pro (last Pro day)', effectiveTier(startedDaysAgo(14), NOW) === 'pro')
  check('day 15 → standard (first step-down)', effectiveTier(startedDaysAgo(15), NOW) === 'standard')
  check('day 19 → standard (last Standard day)', effectiveTier(startedDaysAgo(19), NOW) === 'standard')
  check('day 20 → free', effectiveTier(startedDaysAgo(20), NOW) === 'free')
  check('day 45 → free', effectiveTier(startedDaysAgo(45), NOW) === 'free')
  check('missing trial_starts_at → fresh pro', effectiveTier({}, NOW) === 'pro')

  // ── Paid override ignores the clock ─────────────────────────────────
  const paidPro = { ...startedDaysAgo(99), subscription_status: 'active', subscription_tier: 'pro' }
  check('active paid pro stays pro past day 99', effectiveTier(paidPro, NOW) === 'pro')
  const canceled = { ...startedDaysAgo(99), subscription_status: 'canceled', subscription_tier: 'pro' }
  check('canceled sub falls back to trial clock (free)', effectiveTier(canceled, NOW) === 'free')

  // ── trialInfo for banners ───────────────────────────────────────────
  const t13 = trialInfo(startedDaysAgo(13), NOW)
  check('day 13: next=standard in 2 days', t13.nextTier === 'standard' && t13.daysUntilDowngrade === 2 && t13.onTrial)
  const t18 = trialInfo(startedDaysAgo(18), NOW)
  check('day 18: next=free in 2 days', t18.nextTier === 'free' && t18.daysUntilDowngrade === 2)
  const t25 = trialInfo(startedDaysAgo(25), NOW)
  check('day 25: trial over, no next step', t25.onTrial === false && t25.nextTier === null)
  check('paid: trialInfo paid=true, onTrial=false', trialInfo(paidPro, NOW).paid === true && trialInfo(paidPro, NOW).onTrial === false)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all tier checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
