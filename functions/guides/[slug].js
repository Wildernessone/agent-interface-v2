// /guides/<slug> — one published article, SSR with Article JSON-LD.
import { page, esc, plain, mdToHtml, sbRows, SITE } from '../_site.js'

export async function onRequestGet(context) {
  const slug = String(context.params.slug || '').toLowerCase()
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return miss()
  const rows = await sbRows(`articles?status=eq.published&slug=eq.${encodeURIComponent(slug)}&select=slug,title,dek,body_md,hero_image,tags,published_at,updated_at&limit=1`)
  const a = rows[0]
  if (!a) return miss()
  const published = (a.published_at || '').slice(0, 10)
  const updated = (a.updated_at || a.published_at || '').slice(0, 10)
  const desc = plain(a.dek || a.body_md).slice(0, 155)
  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'Article',
    headline: a.title, description: desc,
    url: `${SITE}/guides/${a.slug}`,
    datePublished: a.published_at || undefined,
    dateModified: a.updated_at || a.published_at || undefined,
    image: a.hero_image || undefined,
    author: { '@type': 'Organization', name: 'Agent Interface', url: SITE },
    publisher: { '@type': 'Organization', name: 'Agent Interface', url: SITE },
    mainEntityOfPage: `${SITE}/guides/${a.slug}`,
  }]
  return page({
    title: a.title,
    desc,
    path: `/guides/${a.slug}`,
    active: '/guides',
    jsonld,
    ogImage: a.hero_image || undefined,
    crumbs: [['/', 'Agent Interface'], ['/guides', 'Guides'], [`/guides/${a.slug}`, a.title]],
    body: `
<article>
<h1>${esc(a.title)}</h1>
<p class="byline">Published ${esc(published)}${updated && updated !== published ? ` · Updated ${esc(updated)}` : ''} · Agent Interface</p>
${a.hero_image ? `<p><img src="${esc(a.hero_image)}" alt="${esc(a.title)}"></p>` : ''}
<section>${mdToHtml(a.body_md)}</section>
</article>
<hr>
<p style="color:var(--dim);font-size:14px">Tracking this space daily on the <a href="/tracker">agent-interface tracker</a>. Start at the <a href="/">hub</a> if you're new to the term.</p>`,
  })
}

function miss() {
  return new Response('', { status: 302, headers: { Location: '/guides' } })
}
