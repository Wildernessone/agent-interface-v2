// Create a Stripe Checkout Session for a Pro/Standard subscription.
// Called from the app with the user's Supabase JWT. Reuses (or creates) the
// user's Stripe customer, then returns a Checkout URL the app redirects to.
//
// Secrets (set with `supabase secrets set`):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_STANDARD
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.
import Stripe from 'npm:stripe@^16'
import { createClient } from 'npm:@supabase/supabase-js@^2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const PRICES: Record<string, string | undefined> = {
  pro: Deno.env.get('STRIPE_PRICE_PRO'),
  standard: Deno.env.get('STRIPE_PRICE_STANDARD'),
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  try {
    const auth = req.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)

    const { tier, returnUrl } = await req.json().catch(() => ({}))
    const price = PRICES[tier]
    if (!price) return json({ error: 'invalid_tier' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: row } = await admin.from('user_settings').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    let customer = row?.stripe_customer_id as string | undefined
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email ?? undefined, metadata: { user_id: user.id } })
      customer = c.id
      await admin.from('user_settings').update({ stripe_customer_id: customer }).eq('user_id', user.id)
    }

    const base = (returnUrl || 'https://agentinterface.app/app').replace(/\?.*$/, '')
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id, tier } },
      allow_promotion_codes: true,
      success_url: `${base}?checkout=success`,
      cancel_url: `${base}?checkout=cancel`,
    })
    return json({ url: session.url })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
