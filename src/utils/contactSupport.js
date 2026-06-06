// IN-APP CONTACT SUPPORT
// ======================
// Writes a support request straight into the HUB Supabase `support_messages`
// table — the same table the support-email Cloudflare Worker writes to, so
// in-app messages and emailed ones land together in Command Center's Support
// tab. Uses the HUB publishable key (public by design; the table's anon policy
// is INSERT-only, SELECT/UPDATE are admin-gated). No email client needed.

const HUB_URL = 'https://jcmkoooivghwrgezxode.supabase.co'
const HUB_KEY = 'sb_publishable_2n0PtcQvGYyndgwlmG0sZQ_ZZSJla_S'

// Returns true on success. Never throws.
export async function sendSupportMessage({ email, message }) {
  const body = (message || '').trim()
  if (!body) return false
  try {
    const res = await fetch(`${HUB_URL}/rest/v1/support_messages`, {
      method: 'POST',
      headers: {
        apikey: HUB_KEY,
        Authorization: `Bearer ${HUB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        from_address: (email || '').trim() || 'unknown',
        subject: 'In-app support request',
        body: body.slice(0, 50000),
        to_address: 'support@agentinterface.app',
        source: 'in_app',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
