// /guides — index of published articles (SSR from Supabase `articles`).
import { page, esc, sbRows, SITE } from '../_site.js'

export async function onRequestGet() {
  const rows = await sbRows('articles?status=eq.published&select=slug,title,dek,tags,published_at&order=published_at.desc&limit=200')
  const items = rows.map(a => `
    <a class="card" href="/guides/${esc(a.slug)}">
      <span class="t">${esc(a.title)}</span>
      <span class="d">${esc(a.dek || '')}</span>
      <span class="m">${esc((a.published_at || '').slice(0, 10))}</span>
    </a>`).join('\n')
  const desc = 'Working guides to agent interfaces: the protocols that wire agents into software, and the UX patterns that keep humans in command.'
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'Agent Interface — Guides', url: `${SITE}/guides`, description: desc,
  }]
  return page({
    title: 'Agent interface guides — protocols & agent UX',
    desc,
    path: '/guides',
    active: '/guides',
    jsonld,
    crumbs: [['/', 'Agent Interface'], ['/guides', 'Guides']],
    body: `
<p class="kicker">Guides</p>
<h1>Field notes on agent interfaces</h1>
<p class="lede">${esc(desc)}</p>
<div class="grid" style="grid-template-columns:1fr;max-width:720px">
${items || '<p style="color:var(--dim)">The first guides are in the works. The <a href="/tracker">tracker</a> and the <a href="/">hub</a> are live now.</p>'}
</div>`,
  })
}
