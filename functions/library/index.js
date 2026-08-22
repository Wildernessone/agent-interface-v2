// SSR the public Council Library index at /library — lists every published
// council verdict (council_pages, status='published'). The hub that links the
// SEO flywheel pages together. Public read (publishable key, RLS-gated).

const SUPABASE_URL = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const PUB_KEY = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'
const SITE = 'https://agentinterface.app'

const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const plain = s => String(s || '').replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim()

export async function onRequest() {
  let rows = []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/council_pages?status=eq.published&select=slug,question,verdict,topic,published_at&order=published_at.desc&limit=500`, {
      headers: { apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}` },
    })
    if (r.ok) rows = await r.json()
  } catch { /* render empty state */ }

  const items = (rows || []).map(a => `
    <a class="row" href="${SITE}/council/${esc(a.slug)}">
      <span class="q">${esc(plain(a.question))}</span>
      <span class="v">${esc(plain(a.verdict).slice(0, 120))}…</span>
    </a>`).join('\n')

  const desc = 'Real decisions, settled by five frontier AIs. Each answers independently, ranks the others blind, and a chairman hands down one verdict — read it or hear it.'
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'The AI Council — Library', url: `${SITE}/library`, description: desc,
  }

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Council Library — five AIs settle real decisions | The AI Council</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/library">
<meta property="og:title" content="The AI Council — Library"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}/library"><meta property="og:image" content="${SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
:root{--bg:#0c0e14;--card:#141824;--bd:#262c3d;--tx:#e7e9ee;--sub:#a3aabb;--ac:#8ab4ff;--go:#ffb454}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:36px 20px 80px}a{color:var(--ac);text-decoration:none}
h1{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}.lede{color:var(--sub);margin:0 0 26px}
.row{display:block;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.row:hover{border-color:var(--ac)}.row .q{display:block;font-weight:650;color:var(--tx);margin-bottom:4px}
.row .v{display:block;color:var(--sub);font-size:14px}
.empty{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:28px;text-align:center;color:var(--sub)}
.cta{text-align:center;margin-top:34px}.cta a{display:inline-block;background:var(--go);color:#1a1205;font-weight:700;padding:11px 22px;border-radius:8px}
</style><script src="/clarity.js" defer></script></head><body><div class="wrap">
<nav style="font-size:13px;color:var(--sub);margin-bottom:18px"><a href="${SITE}/">The AI Council</a> › Library</nav>
<h1>Council Library</h1>
<p class="lede">${esc(desc)}</p>
${items || `<div class="empty">The first verdicts are being deliberated. Check back soon.</div>`}
<div class="cta"><a href="${SITE}/">Explore the agent-interface reference →</a></div>
</div></body></html>`

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=1800' } })
}
