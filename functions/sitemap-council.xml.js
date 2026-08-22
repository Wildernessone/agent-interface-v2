// ⛔ THIS SITEMAP NO LONGER LISTS THE COUNCIL VERDICTS. Changed 2026-08-22.
//
// It used to enumerate every published /council/<slug> — 26 pages written end-to-end
// by language models, unattributed, undisclosed, advising on YMYL subjects (Roth IRAs,
// whole life insurance, mortgages, heat pumps). Submitting those to Google is the
// "scaled content abuse" shape: "using generative AI tools or other similar tools to
// generate many pages without adding value for users." They returned ~114 impressions
// and ZERO clicks in 28 days, on the one domain in the portfolio whose asset IS its
// authority. So the pages now serve <meta name="robots" content="noindex, follow">
// (see functions/council/[slug].js) and they are no longer submitted here.
//
// The pages are still LIVE and still reachable — from /library and directly. (/feed.xml
// used to list them too; it was cleaned up on 2026-08-22 as well and no longer does.)
// This is deliberately NOT a deletion: Google names "removing a lot of older
// content primarily because you believe it will help your search rankings" as a warning
// sign. /library is linked from the site chrome and sits in the main sitemap.xml, so
// Google keeps a crawl path to each verdict and will see the noindex.
//
// The route is kept alive, rather than deleted, so that a copy of this sitemap already
// submitted in Search Console keeps fetching 200 instead of erroring. It emits only
// /library. The `Sitemap:` line for it was removed from robots.txt in the same change,
// because /library is already listed in sitemap.xml and nothing unique remains here.
//
// If you re-add the verdict URLs you must also strip the noindex meta — and you should
// not do either.

const SITE = 'https://agentinterface.app'

export async function onRequest() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}/library</loc><changefreq>daily</changefreq></url>
</urlset>`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
