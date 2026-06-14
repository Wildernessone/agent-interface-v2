// Stripe webhook → keep user_settings in sync with the subscription.
// The app's entitlements treat a user as PAID when
//   subscription_status === 'active' && subscription_tier in (pro, standard).
// So on every relevant subscription event we set those two fields (plus the
// stripe ids and period end). Verifies the Stripe signature.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
//          STRIPE_PRICE_STANDARD.  SUPABASE_* injected.
import Stripe from 'npm:stripe@^16'
import { createClient } from 'npm:@supabase/supabase-js@^2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const WHSEC = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const PRICE_TIER: Record<string, string> = {
  [Deno.env.get('STRIPE_PRICE_PRO') || '__pro']: 'pro',
  [Deno.env.get('STRIPE_PRICE_STANDARD') || '__standard']: 'standard',
}

async function applySub(sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id
  const customer = sub.customer as string
  const priceId = sub.items?.data?.[0]?.price?.id || ''
  const live = sub.status === 'active' || sub.status === 'trialing'
  const tier = live ? (PRICE_TIER[priceId] || 'free') : 'free'
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
  const patch = {
    subscription_tier: tier,
    subscription_status: live ? 'active' : (sub.status || 'inactive'),
    stripe_subscription_id: sub.id,
    stripe_customer_id: customer,
    subscription_period_end: periodEnd,
    updated_at: new Date().toISOString(),
  }
  // Upsert (not update) keyed on user_id: a user who upgrades before ever saving a setting has no
  // user_settings row yet, and a plain update would silently no-op → paid-but-still-free. Only
  // user_id is NOT NULL; every other column defaults. Without a user_id (legacy/manual subs) fall
  // back to matching the existing row by customer.
  const { error } = userId
    ? await admin.from('user_settings').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    : await admin.from('user_settings').update(patch).eq('stripe_customer_id', customer)
  if (error) throw error
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature') || ''
  const body = await req.text()
  let evt: Stripe.Event
  try {
    evt = await stripe.webhooks.constructEventAsync(body, sig, WHSEC)
  } catch (e) {
    return new Response(`bad signature: ${(e as Error)?.message}`, { status: 400 })
  }
  try {
    if (evt.type === 'customer.subscription.created' ||
        evt.type === 'customer.subscription.updated' ||
        evt.type === 'customer.subscription.deleted') {
      await applySub(evt.data.object as Stripe.Subscription)
    } else if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object as Stripe.Checkout.Session
      if (s.subscription) await applySub(await stripe.subscriptions.retrieve(s.subscription as string))
    }
  } catch (e) {
    return new Response(`handler error: ${(e as Error)?.message}`, { status: 500 })
  }
  return new Response('ok')
})
