/**
 * SUPPORT EMAIL WORKER
 * ====================
 * A Cloudflare Email Worker bound to support@agentinterface.app via Email
 * Routing. Every inbound message is parsed and written to the HUB Supabase
 * `support_messages` table. Command Center reads that table and shows an unread
 * badge — so support mail surfaces in the admin dashboard in real time, no
 * Gmail/scraper/cron.
 *
 * Per the chosen design there is NO inbox forward — the message is consumed
 * here. (To also drop a copy in an inbox later, add `message.forward(addr)`.)
 *
 * Vars (wrangler.toml — both public, no secret needed):
 *   HUB_URL  https://jcmkoooivghwrgezxode.supabase.co
 *   HUB_KEY  HUB publishable/anon key. The table has an INSERT-only anon policy
 *            (support_insert_anon); SELECT/UPDATE stay admin-only, so this key
 *            can write a message but never read or modify them. Same model as
 *            the Timberline portals' brand_recommendations submissions.
 */
import PostalMime from 'postal-mime'

export default {
  async email(message, env) {
    let parsed = {}
    try {
      parsed = await PostalMime.parse(message.raw)
    } catch {
      // Unparseable MIME — still record from/subject from the envelope/headers.
    }

    const row = {
      from_address: message.from || parsed.from?.address || 'unknown',
      from_name: parsed.from?.name || null,
      to_address: message.to || null,
      subject: message.headers.get('subject') || parsed.subject || '(no subject)',
      // Prefer plain text; fall back to stripped HTML. Cap so a huge mail can't
      // bloat the row / dashboard.
      body: (parsed.text || stripHtml(parsed.html) || '').slice(0, 50000),
    }

    const res = await fetch(`${env.HUB_URL}/rest/v1/support_messages`, {
      method: 'POST',
      headers: {
        apikey: env.HUB_KEY,
        Authorization: `Bearer ${env.HUB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })

    // If the DB write fails we'd otherwise silently lose the mail. Reject so the
    // sender's server retries later (and it shows up in Email Routing logs)
    // rather than vanishing.
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      message.setReject(`support intake unavailable (${res.status}) ${detail}`.slice(0, 200))
    }
  },
}

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
