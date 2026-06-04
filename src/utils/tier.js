/**
 * EFFECTIVE TIER — resolves the tier a user is ACTUALLY on right now.
 * ==================================================================
 * A paid, active subscription wins. Otherwise the 20-day trial clock decides,
 * counting days since `trial_starts_at` (defaults to signup):
 *   < 15 days → pro    (days 1–15)
 *   < 20 days → standard (days 16–20)
 *   ≥ 20 days → free
 *
 * Reads the user_settings shape: { subscription_status, subscription_tier,
 * trial_starts_at }. `nowMs` is injectable for testing.
 */
import { TRIAL, normalizeTier } from '../config/tiers'

const DAY = 86400000

function isPaid(settings = {}) {
  return settings.subscription_status === 'active' &&
    (settings.subscription_tier === 'pro' || settings.subscription_tier === 'standard')
}

function daysElapsed(settings = {}, nowMs) {
  const parsed = settings.trial_starts_at ? Date.parse(settings.trial_starts_at) : NaN
  const start = Number.isNaN(parsed) ? nowMs : parsed   // missing/bad start → treat as fresh trial
  return Math.floor((nowMs - start) / DAY)
}

export function effectiveTier(settings = {}, nowMs = Date.now()) {
  if (isPaid(settings)) return normalizeTier(settings.subscription_tier)
  const days = daysElapsed(settings, nowMs)
  if (days < TRIAL.proDays) return 'pro'
  if (days < TRIAL.standardEndsDay) return 'standard'
  return 'free'
}

/**
 * Trial status for banners + the account UI:
 *   { tier, paid, onTrial, nextTier, daysUntilDowngrade, daysElapsed }
 * daysUntilDowngrade is how many days until the NEXT step-down (null when paid
 * or already on Free). Used to fire the "you'll lose X in N days" warning.
 */
export function trialInfo(settings = {}, nowMs = Date.now()) {
  const tier = effectiveTier(settings, nowMs)
  if (isPaid(settings)) {
    return { tier, paid: true, onTrial: false, nextTier: null, daysUntilDowngrade: null, daysElapsed: null }
  }
  const days = daysElapsed(settings, nowMs)
  let nextTier = null, downgradeOnDay = null
  if (days < TRIAL.proDays) { nextTier = 'standard'; downgradeOnDay = TRIAL.proDays }
  else if (days < TRIAL.standardEndsDay) { nextTier = 'free'; downgradeOnDay = TRIAL.standardEndsDay }
  return {
    tier,
    paid: false,
    onTrial: nextTier != null,
    nextTier,
    daysUntilDowngrade: downgradeOnDay == null ? null : Math.max(0, downgradeOnDay - days),
    daysElapsed: days,
  }
}
