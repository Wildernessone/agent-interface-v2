// Open the Stripe Customer Portal so a subscriber can update their card, view
// invoices, or cancel. Called with the user's Supabase JWT; returns a portal URL.
// Secrets: STRIPE_SECRET_KEY. SUPABASE_* injected.
import Stripe from 'npm:stripe@^16'
import { createClient } from 'npm:@supabase/supabase-js@^2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
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

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: row } = await admin.from('user_settings').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    const customer = row?.stripe_customer_id as string | undefined
    if (!customer) return json({ error: 'no_subscription' }, 400)

    const { returnUrl } = await req.json().catch(() => ({}))
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: (returnUrl || 'https://agentinterface.app/app').replace(/\?.*$/, ''),
    })
    return json({ url: session.url })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
