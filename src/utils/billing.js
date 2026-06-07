// Client helpers for Stripe billing. They call the Supabase Edge Functions
// (create-checkout-session / create-portal-session) with the signed-in user's
// JWT and redirect the browser to the returned Stripe-hosted URL.
import { supabase } from './supabase'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callFn(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in first.')
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnUrl: `${window.location.origin}/app` }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || `Billing is not available right now (${res.status}).`)
  return data.url
}

/** Start a subscription checkout for 'pro' | 'standard' — redirects to Stripe. */
export async function startCheckout(tier) {
  window.location.href = await callFn('create-checkout-session', { tier })
}

/** Open the Stripe Customer Portal (update card / cancel) — redirects to Stripe. */
export async function openBillingPortal() {
  window.location.href = await callFn('create-portal-session', {})
}
