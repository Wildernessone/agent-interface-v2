// Dynamic sitemap: core reference pages + every published guide.
// Replaces the old static public/sitemap.xml (which is deleted) so a newly
// auto-published article is in the sitemap the moment it flips live —
// no deploy required.
//
// The 26 /council/<slug> verdict pages were DELETED 2026-09-09 and must never be added back. They
// were unattributed model-generated YMYL advice and read as scaled content abuse.
//
// ⛔ /library IS NO LONGER LISTED (2026-09-12), and the reason it USED to be is now dead. It was
// kept as the crawl path that let Google reach each verdict and see its noindex — but the verdicts
// are gone: /library serves ZERO /council links, every /council/<slug> is 404, and the page's own
// title is "Council Library — retired". There is nothing behind it to crawl, and listing a
// noindex,follow tombstone only asks Google to spend budget being told not to index it.
// ⭐ The page STAYS noindex and STAYS live — this removes the sitemap entry, nothing else. Lifting
// the noindex on a hold/authority site is a separate strategy decision, not sitemap hygiene.
import { sbRows, SITE } from './_site.js'

export async function onRequest() {
  const rows = await sbRows('articles?status=eq.published&select=slug,published_at,updated_at&order=published_at.desc&limit=500')
  const today = new Date().toISOString().slice(0, 10)
  const core = [
    ['/', '1.0', 'weekly', today],
    ['/tracker', '0.9', 'daily', today],
    ['/guides', '0.8', 'daily', today],
    // Canonical paths, not the .html forms — those 308 to these, and a sitemap should never
    // list a URL that redirects. It spends crawl budget to be told to go somewhere else, and on
    // a domain with no authority to spare that is the whole cost for none of the benefit.
    ['/terms', '0.2', 'monthly', null],
    ['/privacy', '0.2', 'monthly', null],
  ]
  const urls = [
    ...core.map(([p, pr, cf, lm]) =>
      `<url><loc>${SITE}${p}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`),
    ...rows.map(a =>
      `<url><loc>${SITE}/guides/${a.slug}</loc><lastmod>${(a.updated_at || a.published_at || '').slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
