// SSR a single published council verdict at /council/<slug>, from council_pages
// (status='published' only, RLS-gated). Full standalone HTML (NOT the SPA shell)
// in the AI Council dark theme. It was built as an SEO flywheel — every verdict a page
// targeting the exact question people search. ⛔ That is NO LONGER what this route is
// for: as of 2026-08-22 it serves noindex (see the block below). Values below are
// PUBLIC (publishable key, read-only).
//
// NOTE: /council (exact) is still the authed SPA app route; this Function only
// matches /council/<slug>, so they don't collide.

// ⛔ NOINDEX — DO NOT REVERSE THIS WITHOUT READING WHY. Set 2026-08-22.
// These 26 verdict pages are leftovers from the retired Council feature. They were
// written end-to-end by language models, carry no named author, carry no disclosure
// that they were generated, and hand out advice on YMYL subjects — Roth IRAs, whole
// life insurance, mortgages, heat pumps — with no claimed expertise behind it. That
// is the shape Google's spam policy names as scaled content abuse: "using generative
// AI tools or other similar tools to generate many pages without adding value for
// users." In 28 days they earned ~114 impressions and ZERO clicks, while this domain's
// hub ranks at position ~20 and is the only property in the portfolio with real
// authority — authority IS the asset here, so 26 unattributed generated pages are a
// liability priced far above the traffic they return.
//
// The pages stay LIVE and reachable on purpose. Deleting them is the WORSE move:
// Google explicitly names "removing a lot of older content primarily because you
// believe it will help your search rankings" as a warning sign, and a sibling property
// already churned 103 URLs days before an update. So: noindex, keep serving.
//
// "follow", not "nofollow" — their outbound links should still pass equity.
//
// THREE submission surfaces were withdrawn on the same date — all three have to stay
// withdrawn together, or the noindex is arguing with something else we publish:
//   1. functions/sitemap-council.xml.js — the verdict URLs were dropped
//   2. public/robots.txt              — the Sitemap: line for that sitemap was removed
//   3. functions/feed.xml.js          — the RSS feed was still emitting all 26 URLs AND
//                                       all 26 full verdict bodies; it now emits none.
//      (Google accepts an RSS/Atom feed as a sitemap format, so a feed is a submission
//      surface, not just a convenience — and a feed carries the whole text, which a
//      noindex on our URL cannot follow into a syndicated copy elsewhere.)
// Also on the same date: /library was dropped from llms.txt's recommended pages, and
// the daily council-author GitHub Actions cron was commented out so no 27th page gets
// generated. If you re-index these, you must undo all of that — and you should not.

const SUPABASE_URL = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const PUB_KEY = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'
const SITE = 'https://agentinterface.app'

const LABELS = { claude: 'Claude', gpt: 'ChatGPT', chatgpt: 'ChatGPT', openai: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', deepseek: 'DeepSeek' }
const label = a => LABELS[String(a || '').toLowerCase()] || (a ? String(a) : 'AI')

const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Minimal, safe Markdown -> HTML (escape first, then a small whitelist).
function mdToHtml(md) {
  const inline = s => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out = []; let i = 0, list = null
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  while (i < lines.length) {
    const ln = lines[i]; let m
    if (/^\s*$/.test(ln)) { close(); i++; continue }
    if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { close(); const l = Math.min(m[1].length + 1, 4); out.push(`<h${l}>${inline(m[2])}</h${l}>`); i++; continue }
    if ((m = ln.match(/^[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); list = 'ul'; out.push('<ul>') } out.push(`<li>${inline(m[1])}</li>`); i++; continue }
    if ((m = ln.match(/^\d+\.\s+(.*)$/))) { if (list !== 'ol') { close(); list = 'ol'; out.push('<ol>') } out.push(`<li>${inline(m[1])}</li>`); i++; continue }
    close(); const buf = [ln]; i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|[-*]\s|\d+\.\s)/.test(lines[i])) { buf.push(lines[i]); i++ }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  close(); return out.join('\n')
}

const plain = s => String(s || '').replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim()

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}` },
  })
  if (!r.ok) return null
  const rows = await r.json()
  return Array.isArray(rows) ? rows[0] : null
}

function notFound() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not found — The AI Council</title><body style="background:#0c0e14;color:#e7e9ee;font-family:system-ui;text-align:center;padding:80px 20px"><h1>This verdict isn't here.</h1><p><a href="${SITE}/library" style="color:#8ab4ff">Browse the Council Library</a></p>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function onRequest(context) {
  const slug = context.params.slug
  if (!slug || Array.isArray(slug)) return notFound()

  const a = await sbGet(`council_pages?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`)
  if (!a) return notFound()

  const members = Array.isArray(a.members) ? a.members : []
  const answers = Array.isArray(a.answers) ? a.answers : []
  const ranking = Array.isArray(a.ranking) ? a.ranking : []
  const n = members.length || answers.length || 5
  const url = `${SITE}/council/${esc(slug)}`
  const title = `We asked ${n} AIs: ${plain(a.question)}`
  const desc = plain(a.verdict).slice(0, 155)
  const ogimg = a.og_image || `${SITE}/og-image.png`

  const answersHtml = answers.map(x => {
    const who = label(x.agent || x.speaker || x.name)
    const text = x.text || x.answer || x.body || ''
    return `<section class="ans"><h3>${esc(who)}</h3>${mdToHtml(text)}</section>`
  }).join('\n')

  const rankHtml = ranking.length
    ? `<div class="rank"><h2>How they ranked (blind)</h2><ol>${ranking
        .slice().sort((p, q) => (p.meanRank ?? p.rank ?? 99) - (q.meanRank ?? q.rank ?? 99))
        .map(r => `<li><b>${esc(label(r.agent || r.label))}</b>${r.meanRank != null ? ` <span class="mr">avg rank ${esc(Number(r.meanRank).toFixed(2))}</span>` : ''}</li>`).join('')}</ol>
        <p class="note">Each AI ranked all answers with the names hidden — so they couldn't just vote for themselves.</p></div>`
    : ''

  // QAPage rich-result schema: the question + the council's verdict as accepted answer.
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question', name: plain(a.question), text: plain(a.question),
      answerCount: answers.length || 1,
      acceptedAnswer: { '@type': 'Answer', text: plain(a.verdict), url, author: { '@type': 'Organization', name: 'The AI Council' } },
      suggestedAnswer: answers.map(x => ({ '@type': 'Answer', text: plain(x.text || x.answer || ''), author: { '@type': 'Organization', name: label(x.agent || x.speaker) } })).filter(s => s.text),
    },
  }
  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'The AI Council', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Council Library', item: `${SITE}/library` },
      { '@type': 'ListItem', position: 3, name: plain(a.question).slice(0, 80), item: url },
    ],
  }

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — The AI Council</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="noindex, follow">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(ogimg)}"><meta property="og:site_name" content="The AI Council">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
<style>
:root{--bg:#0c0e14;--card:#141824;--bd:#262c3d;--tx:#e7e9ee;--sub:#a3aabb;--ac:#8ab4ff;--go:#ffb454}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 80px}
a{color:var(--ac)}.crumb{font-size:13px;color:var(--sub);margin-bottom:18px}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:var(--sub);font-size:13px;margin-bottom:24px}
.verdict{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:22px 24px;margin:0 0 28px}
.verdict h2{margin:0 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--go)}
.verdict .chair{color:var(--sub);font-size:13px;margin:0 0 12px}
.rank{margin:0 0 28px}.rank h2,.ans-wrap h2{font-size:18px;margin:0 0 10px}
.rank ol{margin:0;padding-left:20px}.rank .mr{color:var(--sub);font-size:13px}.note{color:var(--sub);font-size:13px}
.ans{border-top:1px solid var(--bd);padding:16px 0}.ans h3{margin:0 0 6px;font-size:15px;color:var(--ac)}
.ans p{color:#d4d8e2}
.cta{background:linear-gradient(135deg,#1b2236,#141824);border:1px solid var(--bd);border-radius:14px;padding:24px;text-align:center;margin-top:36px}
.cta a{display:inline-block;background:var(--go);color:#1a1205;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:8px;margin-top:10px}
code{background:#1b2030;padding:1px 5px;border-radius:4px}
</style><script src="/clarity.js" defer></script></head><body><div class="wrap">
<nav class="crumb"><a href="${SITE}/">The AI Council</a> › <a href="${SITE}/library">Library</a></nav>
<h1>${esc(title)}</h1>
<p class="meta">${esc(String(n))} frontier AIs answered independently, ranked each other blind, and a chairman gave one verdict.</p>
<div class="verdict"><h2>The verdict</h2>${a.chairman ? `<p class="chair">Chaired by ${esc(label(a.chairman))}</p>` : ''}${mdToHtml(a.verdict)}</div>
${rankHtml}
${answersHtml ? `<div class="ans-wrap"><h2>Each AI's take</h2>${answersHtml}</div>` : ''}
<div class="cta"><div>This verdict is part of the Library — an archive of multi-model deliberations on this domain.</div><a href="${SITE}/">Explore the agent-interface reference →</a></div>
</div></body></html>`

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600' },
  })
}
