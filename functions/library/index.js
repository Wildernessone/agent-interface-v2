/* /library — the Council Library, retired 2026-09-09.
 *
 * This route existed for one job: to index the published council verdicts at /council/<slug>. Those
 * pages are gone (James's call, this date), so there is nothing left to list.
 *
 * ⛔ IT STILL ANSWERS 200 ON PURPOSE. /library is in the site chrome, in sitemap.xml and linked from
 *    404.html; a hard 404 here would break a nav link and a bookmark to explain a deletion. What it
 *    must NOT do is keep pretending: the old page carried CollectionPage JSON-LD calling itself "The
 *    AI Council — Library" and an empty state reading "The first verdicts are being deliberated.
 *    Check back soon." With the verdicts deleted, both of those became false — the first to every
 *    model that reads the markup, the second to every person who read the page.
 *
 * ⛔ No Supabase call. Leaving the fetch in would re-list the rows the moment one was republished,
 *    which is exactly the "soft noindex forever" shape this deletion exists to end.
 * ⛔ noindex: a retirement notice is not a page anybody should find in search.
 */
const SITE = 'https://agentinterface.app'

export async function onRequest() {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Council Library — retired | The AI Council</title>
<meta name="robots" content="noindex,follow">
<meta name="description" content="The Council Library has been retired.">
<link rel="canonical" href="${SITE}/library">
<style>
:root{--bg:#0c0e14;--card:#141824;--bd:#262c3d;--tx:#e7e9ee;--sub:#a3aabb;--ac:#8ab4ff;--go:#ffb454}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:56px 20px 80px}a{color:var(--ac);text-decoration:none}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 10px}
p{color:var(--sub);margin:0 0 16px}
.cta{margin-top:30px}.cta a{display:inline-block;background:var(--go);color:#1a1205;font-weight:700;padding:12px 18px;border-radius:10px}
</style></head><body><div class="wrap">
<nav style="font-size:13px;color:var(--sub);margin-bottom:18px"><a href="${SITE}/">The AI Council</a> › Library</nav>
<h1>The Council Library has been retired</h1>
<p>It collected verdicts written by a panel of models on questions well outside what this site is for — retirement accounts, mortgages, insurance. They carried no named author, and they are gone rather than hidden.</p>
<p>What this site is actually about is agent interfaces: what they are, which ones exist, and which ones stopped existing.</p>
<div class="cta"><a href="${SITE}/">Go to the agent-interface reference →</a></div>
</div></body></html>`

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
