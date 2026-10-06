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
//
// ⭐ <lastmod> IS A CONTENT DATE, NEVER A BUILD DATE (2026-10-06). It used to stamp "/", /tracker
// and /guides with `new Date()` — the day a crawler happened to ask — so the sitemap told Google
// all three changed on 2026-10-05 while the tracker had not moved since 2026-09-13 and no guide
// had been touched since 2026-08-14. Each date is now DERIVED from the thing it describes:
//   /tracker    the tracker's own updated date (the newest published changeset's `checked`,
//               exactly what /tracker and /tracker.json print as "updated")
//   /           the later of that and HUB_CONTENT_CHANGED in functions/index.js, because the hub
//               renders tracker rows as well as its own copy
//   /guides/<s> the article row's updated_at, else published_at. There is NO trigger on
//               public.articles: updated_at is written only by the auto-publish cron (set to the
//               publish time) or by whoever edits a row and sets it. So it can lag a quiet edit,
//               and never runs ahead of one — the safe direction.
//   /guides     the newest of those, because the index lists every published guide
// A date that cannot be derived is OMITTED, never filled with today.
import { sbRows, SITE } from './_site.js'
import { loadTracker } from './_tracker-data.js'
import { HUB_CONTENT_CHANGED } from './index.js'

const day = v => {
  const d = String(v || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}
const latest = (...ds) => ds.map(day).filter(Boolean).sort().pop() || null

// Pure: everything it needs is passed in, so tests/sitemap-lastmod.test.mjs can run it with no
// network and no clock.
export function buildSitemap({ trackerUpdated, hubChanged, guides = [] }) {
  const guideRows = guides
    .map(a => ({ slug: a && a.slug, lastmod: day((a && (a.updated_at || a.published_at)) || '') }))
    .filter(a => a.slug)
  const newestGuide = latest(...guideRows.map(a => a.lastmod))
  const core = [
    ['/', '1.0', 'weekly', latest(hubChanged, trackerUpdated)],
    ['/tracker', '0.9', 'weekly', day(trackerUpdated)],
    ['/guides', '0.8', 'weekly', newestGuide],
    // Canonical paths, not the .html forms — those 308 to these, and a sitemap should never
    // list a URL that redirects. It spends crawl budget to be told to go somewhere else, and on
    // a domain with no authority to spare that is the whole cost for none of the benefit.
    ['/terms', '0.2', 'monthly', null],
    ['/privacy', '0.2', 'monthly', null],
  ]
  const lm = d => (d ? `<lastmod>${d}</lastmod>` : '')
  const urls = [
    ...core.map(([p, pr, cf, d]) =>
      `<url><loc>${SITE}${p}</loc>${lm(d)}<changefreq>${cf}</changefreq><priority>${pr}</priority></url>`),
    ...guideRows.map(a =>
      `<url><loc>${SITE}/guides/${a.slug}</loc>${lm(a.lastmod)}<changefreq>monthly</changefreq><priority>0.6</priority></url>`),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
}

export async function onRequest() {
  const [guides, tracker] = await Promise.all([
    sbRows('articles?status=eq.published&select=slug,published_at,updated_at&order=published_at.desc&limit=500'),
    loadTracker(),
  ])
  const xml = buildSitemap({ trackerUpdated: tracker.TRACKER_UPDATED, hubChanged: HUB_CONTENT_CHANGED, guides })
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
