// RSS feed of published guides (linked from every page's <head>).
import { esc, plain, sbRows, SITE } from './_site.js'

export async function onRequestGet() {
  const rows = await sbRows('articles?status=eq.published&select=slug,title,dek,body_md,published_at&order=published_at.desc&limit=50')
  const items = rows.map(a => `
  <item>
    <title>${esc(a.title)}</title>
    <link>${SITE}/guides/${esc(a.slug)}</link>
    <guid>${SITE}/guides/${esc(a.slug)}</guid>
    ${a.published_at ? `<pubDate>${new Date(a.published_at).toUTCString()}</pubDate>` : ''}
    <description>${esc(plain(a.dek || a.body_md).slice(0, 300))}</description>
  </item>`).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Agent Interface — Guides</title>
  <link>${SITE}/guides</link>
  <description>Working guides to agent interfaces: protocols and human-agent UX patterns.</description>
${items}
</channel></rss>`
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
