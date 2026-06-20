// Dynamic sitemap of the Council Library: /library + every published verdict.
// Served at /sitemap-council.xml (referenced from robots.txt). Lets Google
// discover new SEO pages the moment they're approved — no redeploy.

const SUPABASE_URL = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const PUB_KEY = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'
const SITE = 'https://agentinterface.app'

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

export async function onRequest() {
  let rows = []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/council_pages?status=eq.published&select=slug,published_at,updated_at&order=published_at.desc&limit=5000`, {
      headers: { apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}` },
    })
    if (r.ok) rows = await r.json()
  } catch { /* still emit the library URL */ }

  const urls = [`<url><loc>${SITE}/library</loc><changefreq>daily</changefreq></url>`]
  for (const a of rows || []) {
    const lastmod = (a.updated_at || a.published_at || '').slice(0, 10)
    urls.push(`<url><loc>${SITE}/council/${esc(a.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>monthly</changefreq></url>`)
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
