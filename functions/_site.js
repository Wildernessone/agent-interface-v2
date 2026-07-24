// Shared shell for the agentinterface.app reference site (hub / tracker / guides).
// Every page renders through page() so the SEO surface is uniform and complete:
// title <=60, description <=155, canonical, OG + twitter, JSON-LD blocks,
// breadcrumbs, one shared nav/footer. Design system = the landing's tokens
// (dark #0a0b0d, JetBrains Mono display, Inter body, accent #6fa1ff, the four
// agent-color glows) pushed into a server-rendered, zero-framework layer.
// No emojis anywhere — typography only.

export const SITE = 'https://agentinterface.app'

export const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const plain = s => String(s || '').replace(/[#*`_>\[\]]/g, '').replace(/\s+/g, ' ').trim()

// Minimal, safe Markdown -> HTML (escape first, then a small whitelist).
// Same approach as the council SSR; extended with links, tables and hr.
export function mdToHtml(md) {
  const inline = s => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out = []; let i = 0; let list = null
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  while (i < lines.length) {
    const ln = lines[i]; let m
    if (/^\s*$/.test(ln)) { close(); i++; continue }
    if (/^\s*---+\s*$/.test(ln)) { close(); out.push('<hr>'); i++; continue }
    if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { close(); const l = Math.min(m[1].length + 1, 4); out.push(`<h${l}>${inline(m[2])}</h${l}>`); i++; continue }
    if ((m = ln.match(/^[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); list = 'ul'; out.push('<ul>') } out.push(`<li>${inline(m[1])}</li>`); i++; continue }
    if ((m = ln.match(/^\d+\.\s+(.*)$/))) { if (list !== 'ol') { close(); list = 'ol'; out.push('<ol>') } out.push(`<li>${inline(m[1])}</li>`); i++; continue }
    if (/^\|.+\|\s*$/.test(ln)) {
      close(); const rows = []
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++ }
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => inline(c.trim()))
      const head = cells(rows[0])
      const body = rows.slice(rows[1] && /^\|[\s:|-]+\|$/.test(rows[1].replace(/\s/g, '')) ? 2 : 1)
      out.push('<div class="tbl"><table><thead><tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>')
      for (const r of body) out.push('<tr>' + cells(r).map(c => `<td>${c}</td>`).join('') + '</tr>')
      out.push('</tbody></table></div>')
      continue
    }
    if ((m = ln.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); i++; continue }
    close(); const buf = [ln]; i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|[-*]\s|\d+\.\s|\||>)/.test(lines[i])) { buf.push(lines[i]); i++ }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  close(); return out.join('\n')
}

const NAV = [
  ['/', 'Hub'],
  ['/tracker', 'Tracker'],
  ['/guides', 'Guides'],
  ['/library', 'Library'],
]

export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b0d12;--panel:#121620;--panel-2:#171c28;--border:rgba(255,255,255,.07);--border-2:rgba(255,255,255,.14);
  --text:#e8eaed;--dim:#9aa0aa;--faint:#62676f;--accent:#6fa1ff;
  --claude:#d97757;--gpt:#10a37f;--gemini:#5b8def;--grok:#b48af7;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
  --body:'Inter',system-ui,-apple-system,sans-serif;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:var(--body);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background:
  radial-gradient(60vw 50vh at 15% -5%,rgba(217,119,87,.09),transparent 60%),
  radial-gradient(55vw 45vh at 90% 10%,rgba(91,141,239,.09),transparent 60%),
  radial-gradient(60vw 60vh at 50% 110%,rgba(180,138,247,.07),transparent 60%)}
body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.28;background-image:
  url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
.wrap{max-width:880px;margin:0 auto;padding:0 22px;position:relative;z-index:1}
header.site{position:sticky;top:0;z-index:20;background:rgba(11,13,18,.86);backdrop-filter:saturate(140%) blur(10px);border-bottom:1px solid var(--border)}
header.site .wrap{display:flex;align-items:center;gap:22px;height:56px}
.wordmark{font-family:var(--mono);font-weight:700;font-size:14px;letter-spacing:.02em;color:var(--text);text-decoration:none}
.wordmark:hover{text-decoration:none}
.wordmark .dot{color:var(--accent)}
nav.main{display:flex;gap:16px;margin-left:8px}
nav.main a{font-family:var(--mono);font-size:12.5px;letter-spacing:.04em;color:var(--dim);text-transform:uppercase}
nav.main a:hover{color:var(--text);text-decoration:none}
nav.main a.on{color:var(--accent)}
main{padding:56px 0 40px}
.kicker{font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:14px}
.kicker b{color:var(--accent);font-weight:500}
h1{font-family:var(--mono);font-size:clamp(28px,5vw,44px);line-height:1.16;font-weight:700;letter-spacing:-.015em;margin-bottom:16px}
.lede{color:var(--dim);font-size:17px;max-width:640px;margin-bottom:8px}
h2{font-family:var(--mono);font-size:21px;font-weight:700;letter-spacing:-.01em;margin:52px 0 14px}
h3{font-size:16.5px;font-weight:650;margin:28px 0 8px}
p{margin-bottom:14px}
section p,section li{color:#c6cad2}
ul,ol{margin:0 0 14px 22px}
li{margin-bottom:6px}
code{font-family:var(--mono);font-size:.88em;background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:1px 6px}
blockquote{border-left:2px solid var(--accent);padding:2px 0 2px 16px;color:var(--dim);margin-bottom:14px}
hr{border:0;border-top:1px solid var(--border);margin:34px 0}
.answer{position:relative;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px 22px;margin:26px 0;overflow:hidden}
.answer::before{content:'';position:absolute;top:0;left:16px;right:16px;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(120deg,var(--claude),var(--gemini) 55%,var(--grok));opacity:.55}
.answer .lbl{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
.answer p{margin-bottom:0;color:var(--text);font-size:16.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin:18px 0}
.card{position:relative;display:block;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;overflow:hidden;color:var(--text);transition:border-color .15s}
.card:hover{border-color:var(--border-2);text-decoration:none}
.card::before{content:'';position:absolute;top:0;left:14px;right:14px;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(120deg,var(--gemini),var(--grok));opacity:0;transition:opacity .15s}
.card:hover::before{opacity:.6}
.card .t{font-family:var(--mono);font-size:14px;font-weight:700;margin-bottom:5px}
.card .d{color:var(--dim);font-size:13.5px;line-height:1.5}
.card .m{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:9px;letter-spacing:.05em;text-transform:uppercase}
.tbl{overflow-x:auto;margin:16px 0;border:1px solid var(--border);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);text-align:left;padding:11px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
td{padding:11px 14px;border-bottom:1px solid var(--border);color:#c6cad2;vertical-align:top}
tr:last-child td{border-bottom:0}
td a{white-space:nowrap}
.status{font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid var(--border-2);white-space:nowrap}
.s-live{color:#7ddba3;border-color:rgba(125,219,163,.35)}
.s-rising{color:#8ab4ff;border-color:rgba(138,180,255,.35)}
.s-early{color:#d9b877;border-color:rgba(217,184,119,.35)}
.s-watch{color:var(--dim)}
.s-dead{color:#e08b8b;border-color:rgba(224,139,139,.35);text-decoration:line-through;text-decoration-thickness:1px}
.vdate{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:6px;white-space:nowrap}
.meta-line{font-family:var(--mono);font-size:12px;color:var(--faint);margin:2px 0 26px;line-height:1.9}
.meta-line a{color:var(--dim)}
.stamp{font-family:var(--mono);font-size:12px;color:var(--faint);display:flex;align-items:center;gap:8px;margin:6px 0 2px}
.stamp .pulse{width:7px;height:7px;border-radius:999px;background:#7ddba3;box-shadow:0 0 0 0 rgba(125,219,163,.5);animation:pulse 2.4s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(125,219,163,.45)}70%{box-shadow:0 0 0 7px rgba(125,219,163,0)}100%{box-shadow:0 0 0 0 rgba(125,219,163,0)}}
.crumbs{font-family:var(--mono);font-size:12px;color:var(--faint);margin-bottom:26px}
.crumbs a{color:var(--faint)}
.crumbs a:hover{color:var(--dim)}
footer.site{border-top:1px solid var(--border);margin-top:70px;padding:30px 0 46px;position:relative;z-index:1}
footer.site .wrap{display:flex;flex-wrap:wrap;gap:8px 26px;align-items:baseline}
footer.site .about{flex-basis:100%;color:var(--faint);font-size:13px;max-width:620px;margin-bottom:10px}
footer.site a{font-family:var(--mono);font-size:12px;color:var(--dim);letter-spacing:.03em}
.faq details{border:1px solid var(--border);border-radius:10px;background:var(--panel);margin-bottom:10px}
.faq summary{cursor:pointer;padding:14px 18px;font-weight:600;font-size:15px;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-family:var(--mono);color:var(--faint)}
.faq details[open] summary::after{content:'−'}
.faq .a{padding:0 18px 15px;color:#c6cad2;font-size:14.5px}
.byline{font-family:var(--mono);font-size:12px;color:var(--faint);margin:8px 0 24px}
article h2{margin-top:40px}
article img{max-width:100%;border-radius:12px;border:1px solid var(--border)}
@media(max-width:640px){nav.main{gap:11px}nav.main a{font-size:11px}}
`

export function page({ title, desc, path, jsonld = [], crumbs = null, active = '', body, ogImage = `${SITE}/og-image.png`, noindex = false }) {
  const canonical = SITE + path
  const crumbHtml = crumbs
    ? `<nav class="crumbs">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${esc(c[0])}">${esc(c[1])}</a> › ` : esc(c[1]))).join('')}</nav>`
    : ''
  const crumbLd = crumbs
    ? [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[1], item: SITE + c[0] })) }]
    : []
  const ld = [...jsonld, ...crumbLd]
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0d12">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex, follow">' : ''}
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website"><meta property="og:site_name" content="Agent Interface">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(ogImage)}">
<link rel="alternate" type="application/rss+xml" title="Agent Interface guides" href="${SITE}/guides-feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
${ld.map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')}
<style>${CSS}</style>
</head><body>
<header class="site"><div class="wrap">
  <a class="wordmark" href="/">agent<span class="dot">·</span>interface</a>
  <nav class="main">${NAV.map(([href, label]) => `<a href="${href}"${active === href ? ' class="on"' : ''}>${label}</a>`).join('')}</nav>
</div></header>
<main><div class="wrap">
${crumbHtml}
${body}
</div></main>
<footer class="site"><div class="wrap">
  <p class="about">agentinterface.app is the reference site for agent interfaces — the protocols that connect AI agents to software, and the interface patterns that keep humans in command of them. Maintained continuously, every claim sourced; corrections welcome. The Library is an archive of published multi-model verdicts from The AI Council, an earlier experiment on this domain.</p>
  <a href="/">Hub</a><a href="/tracker">Tracker</a><a href="/guides">Guides</a><a href="/library">Library</a><a href="/llms.txt">llms.txt</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a>
</div></footer>
</body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=1800' } })
}

export async function sbRows(path) {
  const SUPABASE_URL = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
  const PUB_KEY = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}` } })
  if (!r.ok) return []
  const rows = await r.json()
  return Array.isArray(rows) ? rows : []
}
