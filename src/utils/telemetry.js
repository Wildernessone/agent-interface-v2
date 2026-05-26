import * as Sentry from '@sentry/react'
import { supabase } from './supabase'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
let sentryReady = false

export function initTelemetry() {
  if (!SENTRY_DSN || sentryReady) return
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
  })
  sentryReady = true
}

export function identifyUser(user) {
  if (!sentryReady || !user) return
  Sentry.setUser({ id: user.id, email: user.email })
}

export function logError(scope, error, context = {}) {
  if (sentryReady) {
    Sentry.withScope(s => {
      s.setTag('scope', scope)
      Object.entries(context).forEach(([k, v]) => s.setExtra(k, v))
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
    })
  }
  if (import.meta.env.DEV) console.error(`[${scope}]`, error, context)
}

// Paywall / tier limits are disabled until pricing ships.
// When ready, re-enable by setting FREE_DAILY_MESSAGES to a positive number
// and gating on tier === 'free'.
const FREE_DAILY_MESSAGES = Infinity

export async function checkTierLimits() {
  // Paywall disabled — always allow. Tier info still surfaced for UI hints.
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { allowed: true, tier: 'free', remaining: Infinity }
    const { data: settings } = await supabase.from('user_settings')
      .select('subscription_tier').eq('user_id', user.id).maybeSingle()
    return { allowed: true, tier: settings?.subscription_tier || 'free', remaining: Infinity }
  } catch {
    return { allowed: true, tier: 'free', remaining: Infinity }
  }
}

export async function logUsage({ kind, provider, model, tokensIn = 0, tokensOut = 0, costCents = 0, success = true, errorType = null }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: true }
  const { error } = await supabase.from('usage_events').insert({
    user_id: user.id,
    kind,
    provider,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: costCents,
    success,
    error_type: errorType,
    created_at: new Date().toISOString(),
  })
  if (error) {
    if (error.message?.includes('free_tier_daily_limit_reached')) {
      return { ok: false, reason: 'free_tier_limit' }
    }
    if (sentryReady) Sentry.captureException(error)
  }
  return { ok: !error }
}
