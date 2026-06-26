// Editorial RSS feed of published AI Council verdicts at /feed.xml. Connect this in
// MSN Partner Hub so the council content engine flows into Microsoft Start / the
// Windows widgets feed. Full content + ~30 freshest items. Public values only
// (publishable key, RLS-gated to status='published').

const SUPABASE_URL = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const PUB_KEY = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'
const SITE = 'https://agentinterface.app'

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
const cdata = (s) => `<![CDATA[${String(s || '').replace(/]]>/g, ']]&gt;')}]]>`

// Compact, safe Markdown -> HTML for the feed body (headings, lists, bold/italic, links).
function mdToHtml(md) {
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, h) => /^https?:\/\//.test(h) ? `<a href="${h}">${t}</a>` : t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out = []; let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }
  for (const raw of lines) {
    const ln = raw.trim()
    if (!ln) { closeList(); continue }
    let m
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { closeList(); const lvl = Math.min(m[1].length + 1, 6); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); continue }
    if ((m = ln.match(/^[-*]\s+(.*)$/))) { if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inline(m[1])}</li>`); continue }
    closeList(); out.push(`<p>${inline(ln)}</p>`)
  }
  closeList()
  return out.join('\n')
}

export async function onRequest() {
  let rows = []
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/council_pages?status=eq.published&select=slug,question,verdict,topic,published_at,updated_at&order=published_at.desc&limit=30`,
      { headers: { apikey: PUB_KEY, Authorization: 'Bearer ' + PUB_KEY } })
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) rows = d }
  } catch (_e) { /* emit an empty-but-valid feed */ }

  const items = rows.map((a) => {
    const link = `${SITE}/council/${a.slug}`
    const pub = a.published_at ? new Date(a.published_at).toUTCString() : ''
    return `  <item>
    <title>${esc(a.question)}</title>
    <link>${esc(link)}</link>
    <guid isPermaLink="true">${esc(link)}</guid>
    ${pub ? `<pubDate>${pub}</pubDate>` : ''}
    <dc:creator>The AI Council</dc:creator>
    ${a.topic ? `<category>${esc(a.topic)}</category>` : ''}
    <content:encoded>${cdata(mdToHtml(a.verdict))}</content:encoded>
  </item>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Agent Interface — The AI Council</title>
  <link>${SITE}/library</link>
  <description>Multiple AIs debate a question; the chairman delivers a cited verdict.</description>
  <language>en-us</language>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>`

  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
