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

const FREE_DAILY_MESSAGES = 20

export async function checkTierLimits() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: true, tier: 'free', remaining: FREE_DAILY_MESSAGES }

  const [{ data: settings }, { data: usage }] = await Promise.all([
    supabase.from('user_settings').select('subscription_tier').eq('user_id', user.id).single(),
    supabase.from('user_usage_today').select('messages_today').eq('user_id', user.id).single(),
  ])

  const tier = settings?.subscription_tier || 'free'
  if (tier === 'pro') return { allowed: true, tier, remaining: Infinity }

  const used = usage?.messages_today || 0
  const remaining = Math.max(0, FREE_DAILY_MESSAGES - used)
  return { allowed: remaining > 0, tier, remaining, dailyLimit: FREE_DAILY_MESSAGES }
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
