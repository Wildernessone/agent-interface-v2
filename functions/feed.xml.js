// ⛔ THIS FEED NO LONGER SYNDICATES THE COUNCIL VERDICTS. Changed 2026-08-22.
//
// It used to emit every published /council/<slug> — all 26 of them — as RSS items
// carrying the FULL verdict body in <content:encoded>. That made it the widest of the
// three submission surfaces for those pages, and it was missed when the other two were
// cleaned up the same day:
//   1. sitemap-council.xml   — verdict URLs dropped
//   2. robots.txt            — the Sitemap: line for it removed
//   3. THIS FILE             — was still shipping all 26 URLs and all 26 bodies
//
// Why a feed counts as a submission surface, not just a convenience: Google accepts an
// RSS/Atom feed as a sitemap format and discovers URLs from feeds, so leaving the items
// here re-submitted exactly the URLs that had just been withdrawn everywhere else. And
// unlike a sitemap, a feed carries the whole text — the header of this file used to say
// "connect this in MSN Partner Hub so the council content engine flows into Microsoft
// Start", which is a plan to republish that text on third-party surfaces. A noindex on
// our own URL does nothing about a syndicated copy living somewhere else.
//
// What the pages are: leftovers from the retired Council feature, written end-to-end by
// language models, no named author, no disclosure that they were generated, advising on
// YMYL subjects (Roth IRAs, whole life insurance, mortgages, heat pumps). That is the
// shape Google's spam policy names as scaled content abuse. ~114 impressions and ZERO
// clicks in 28 days, on the one domain in this portfolio whose asset IS its authority.
//
// The pages themselves are still LIVE and still reachable — from /library, and directly.
// This is deliberately NOT a deletion: Google names "removing a lot of older content
// primarily because you believe it will help your search rankings" as a warning sign.
// They serve <meta name="robots" content="noindex, follow"> instead — see
// functions/council/[slug].js, which carries the full reasoning.
//
// The route is kept alive, rather than deleted, for the same reason sitemap-council.xml
// was: any consumer already subscribed keeps fetching a valid 200 instead of erroring.
// It emits a well-formed, item-less channel pointing at /library.
//
// ⛔ Do not re-add the items. If you ever do, you must also strip the noindex meta and
// re-add the sitemap — and you should not do any of the three.
//
// The guides feed at /guides-feed.xml is a separate, unaffected route and is the one
// linked from every page's <head>. Real editorial content belongs there, not here.

const SITE = 'https://agentinterface.app'

export async function onRequest() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Agent Interface — The AI Council</title>
  <link>${SITE}/library</link>
  <description>The AI Council is retired. Its published verdicts remain readable in the Library; they are no longer syndicated.</description>
  <language>en-us</language>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
</channel>
</rss>`

  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
