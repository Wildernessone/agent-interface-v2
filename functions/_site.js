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
h1{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(42px,7vw,76px);line-height:1.02;font-weight:400;letter-spacing:-.01em;margin-bottom:20px}
h1 em{font-style:italic;color:var(--accent)}
.lede{color:var(--dim);font-size:17px;max-width:640px;margin-bottom:8px}
h2{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(26px,3.4vw,34px);font-weight:400;letter-spacing:0;margin:64px 0 16px}
h2 .no{font-family:var(--mono);font-size:12px;font-weight:500;color:var(--faint);letter-spacing:.15em;vertical-align:super;margin-right:10px}
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
.card{position:relative;display:block;background:linear-gradient(180deg,rgba(255,255,255,.028),rgba(255,255,255,0) 55%),var(--panel);border:1px solid var(--border);border-radius:14px;padding:17px 19px;overflow:hidden;color:var(--text);transition:border-color .18s,transform .18s,box-shadow .18s}
.card:hover{border-color:var(--border-2);text-decoration:none;transform:translateY(-2px);box-shadow:0 14px 40px rgba(0,0,0,.35)}
.card::before{content:'';position:absolute;top:0;left:14px;right:14px;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(120deg,var(--claude),var(--gemini) 55%,var(--grok));opacity:.22;transition:opacity .18s}
.card:hover::before{opacity:.75}
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
/* ── the layer diagram: signals travelling human ↔ agent ↔ software ── */
.diagram{margin:34px 0 8px;border:1px solid var(--border);border-radius:16px;background:
  radial-gradient(80% 120% at 50% -20%,rgba(111,161,255,.07),transparent 60%),var(--panel);
  padding:10px 8px 2px;overflow:hidden;position:relative}
.diagram svg{display:block;width:100%;height:auto}
.diagram .cap{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);text-align:center;padding:6px 0 10px}
/* ── the tracker ticker: dual-direction marquee, SideWRK-style ── */
.tickers{margin:44px 0 6px;border-block:1px solid var(--border);padding:13px 0;display:grid;gap:11px;overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.tick{display:flex;gap:0;white-space:nowrap;width:max-content}
.tick a{display:inline-flex;align-items:center;gap:9px;font-family:var(--mono);font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);padding:0 26px;text-decoration:none}
.tick a:hover{color:var(--text)}
.tick .sd{width:6px;height:6px;border-radius:999px;flex:none}
.sd-live{background:#7ddba3}.sd-rising{background:#8ab4ff}.sd-early{background:#d9b877}.sd-watch{background:#62676f}.sd-dead{background:#e08b8b}
.tick-l{animation:tickL 52s linear infinite}
.tick-r{animation:tickR 62s linear infinite}
@keyframes tickL{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes tickR{from{transform:translateX(-50%)}to{transform:translateX(0)}}
/* ── big sourced stats ── */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:30px 0 8px}
.stat{position:relative;background:linear-gradient(180deg,rgba(255,255,255,.028),rgba(255,255,255,0) 55%),var(--panel);border:1px solid var(--border);border-radius:14px;padding:20px 18px 16px;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:14px;right:14px;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(120deg,var(--claude),var(--gemini) 55%,var(--grok));opacity:.28}
.stat .n{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(34px,4.6vw,46px);line-height:1;color:var(--text)}
.stat .n i{font-style:italic;color:var(--accent)}
.stat .l{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-top:9px;line-height:1.6}
.stat .s{display:block;font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:7px;letter-spacing:.03em}
.stat .s a{color:var(--faint)}
/* ── the graveyard band ── */
.grave{position:relative;margin:26px 0 8px;border:1px solid rgba(224,139,139,.22);border-radius:16px;overflow:hidden;padding:26px 24px 20px;background:
  radial-gradient(90% 130% at 50% -30%,rgba(224,139,139,.10),transparent 60%),
  linear-gradient(180deg,#141018,#100d13)}
.grave .gk{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#e08b8b;margin-bottom:10px}
.grave h3{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(24px,3.4vw,32px);font-weight:400;margin:0 0 14px;color:#f3dede}
.grave ul{list-style:none;margin:0;display:grid;gap:8px}
.grave li{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;border-bottom:1px dashed rgba(224,139,139,.16);padding-bottom:8px;color:#cdbfc2;font-size:14.5px}
.grave li:last-child{border-bottom:0}
.grave .who{font-family:var(--mono);font-size:13px;color:#f3dede;font-weight:500}
.grave .span{font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;color:#e08b8b;text-transform:uppercase;white-space:nowrap}
.grave .gcta{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
/* ── the live gate demo: terminal + mode chips ── */
.demo{margin:30px 0 8px;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,0) 40%),#0d1017}
.demo .bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border)}
.demo .bar .ttl{font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);margin-right:auto}
.chip{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);background:transparent;border:1px solid var(--border-2);border-radius:999px;padding:6px 12px;cursor:pointer;transition:all .15s}
.chip:hover{color:var(--text)}
.chip.on{color:#0b0d12;background:var(--accent);border-color:var(--accent);font-weight:700}
.term{font-family:var(--mono);font-size:13px;line-height:1.9;padding:18px 20px 20px;min-height:236px}
.term .ln{display:block;opacity:0;transform:translateY(4px);transition:opacity .3s,transform .3s;white-space:pre-wrap}
.term .ln.on{opacity:1;transform:none}
.term .c-dim{color:var(--faint)}
.term .c-agent{color:#8ab4ff}
.term .c-gate{color:#d9b877}
.term .c-ok{color:#7ddba3}
.term .c-warn{color:#e08b8b}
.term .c-hum{color:#e8eaed}
.term .caret{display:inline-block;width:7px;height:14px;background:var(--accent);vertical-align:-2px;animation:blink 1s steps(1) infinite;margin-left:2px}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.term .ln{opacity:1;transform:none}.term .caret{animation:none}}
/* ── the wandering agent ── */
#wagent{position:fixed;z-index:60;pointer-events:auto;cursor:pointer;will-change:transform;filter:drop-shadow(0 0 10px rgba(111,161,255,.45))}
#wagent .lbl{position:absolute;bottom:120%;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--dim);white-space:nowrap;background:rgba(11,13,18,.85);border:1px solid var(--border);border-radius:6px;padding:3px 8px}
#wagent svg{display:block;animation:wbob 1.1s ease-in-out infinite}
@keyframes wbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
#wagent.crossing{transition:transform linear}
#wagent .thread{position:absolute;bottom:100%;left:50%;width:1px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.35));height:0}
#wagent.descend .thread{height:calc(100vh)}
::selection{background:rgba(111,161,255,.30)}
.card{--mx:50%;--my:50%}
.card::after{content:'';position:absolute;inset:0;border-radius:14px;opacity:0;transition:opacity .25s;pointer-events:none;background:radial-gradient(220px circle at var(--mx) var(--my),rgba(111,161,255,.10),transparent 65%)}
.card:hover::after{opacity:1}
/* ── scroll reveal ── */
.rv{opacity:0;transform:translateY(18px);transition:opacity .7s cubic-bezier(.2,.6,.2,1),transform .7s cubic-bezier(.2,.6,.2,1)}
.rv.in{opacity:1;transform:none}
.rv2{transition-delay:.08s}.rv3{transition-delay:.16s}
@media (prefers-reduced-motion:reduce){
  .tick-l,.tick-r{animation:none}
  .diagram svg *{animation:none!important}
  .pulse{animation:none}
  .rv{opacity:1;transform:none;transition:none}
}
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
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
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
<script>(function(){try{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var o=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');o.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'});document.querySelectorAll('.rv').forEach(function(el){o.observe(el)})}catch(_e){document.querySelectorAll('.rv').forEach(function(el){el.classList.add('in')})}})();</script>
<script>
(function(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try { console.log('%cagent\u00b7interface', 'font-family:monospace;font-size:14px;color:#6fa1ff', 'You opened the developer tools. The agent noticed. Nothing was written to the trail \u2014 this time. Machine-readable everything: /tracker.json'); } catch(_e){}
  // cursor glow on cards
  document.addEventListener('pointermove', function(e){
    var c = e.target && e.target.closest ? e.target.closest('.card') : null;
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  var BOT = '<svg width="34" height="26" viewBox="0 0 34 26"><g><line x1="17" y1="6" x2="17" y2="2" stroke="#6fa1ff" stroke-width="1.5"/><circle cx="17" cy="2" r="1.8" fill="#6fa1ff"/><rect x="5" y="6" width="24" height="15" rx="6" fill="#121620" stroke="rgba(255,255,255,.35)"/><circle cx="13" cy="13.5" r="2" fill="#7ddba3"/><circle cx="21" cy="13.5" r="2" fill="#7ddba3"/><rect x="9" y="21" width="4" height="3" rx="1.5" fill="rgba(255,255,255,.3)"/><rect x="21" y="21" width="4" height="3" rx="1.5" fill="rgba(255,255,255,.3)"/></g></svg>';
  var WALKS = ['agent \u00b7 patrolling the perimeter','signal \u00b7 human \u2192 agent \u00b7 approved','MCP handshake \u00b7 9ms','A2A \u00b7 task accepted from a stranger agent','x402 \u00b7 paid $0.0002 to read this page','agent \u00b7 filing the audit trail','scope check \u00b7 still inside the sandbox','permission mode \u00b7 suggest \u00b7 behaving'];
  var CRAWLS = ['ClaudeBot \u00b7 reading the tracker','GPTBot \u00b7 crawling \u00b7 be cool','PerplexityBot \u00b7 citing us, hopefully','Meta-ExternalAgent \u00b7 requesting /null again'];
  var el = null, busy = false;
  function mk(label){
    el = document.createElement('div');
    el.id = 'wagent';
    el.innerHTML = '<div class="thread"></div><span class="lbl">' + label + '</span>' + BOT;
    document.body.appendChild(el);
    el.addEventListener('click', function(){
      var l = el.querySelector('.lbl');
      if (l) l.textContent = 'interrupted \u00b7 parking serializable state\u2026';
      var tr = el.style.transform;
      el.style.transition = 'transform .9s cubic-bezier(.5,0,1,1), opacity .9s';
      el.style.opacity = '0';
      el.style.transform = tr + ' translateY(-70px)';
      setTimeout(rm, 900);
    }, { once: true });
    return el;
  }
  function rm(){ if (el && el.parentNode) el.parentNode.removeChild(el); el = null; busy = false; }
  function walk(){
    if (busy || document.hidden) return; busy = true;
    var ltr = Math.random() < 0.5;
    var y = Math.round(innerHeight * (0.55 + Math.random() * 0.35));
    var dur = 11000 + Math.random() * 6000;
    var w = mk(WALKS[Math.floor(Math.random() * WALKS.length)]);
    w.style.top = y + 'px';
    var from = ltr ? -140 : innerWidth + 140;
    var to = ltr ? innerWidth + 140 : -140;
    w.style.transform = 'translateX(' + from + 'px)' + (ltr ? '' : ' scaleX(-1)');
    var lbl = w.querySelector('.lbl'); if (lbl && !ltr) lbl.style.transform = 'translateX(-50%) scaleX(-1)';
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      w.classList.add('crossing');
      w.style.transitionDuration = dur + 'ms';
      w.style.transform = 'translateX(' + to + 'px)' + (ltr ? '' : ' scaleX(-1)');
    });});
    setTimeout(rm, dur + 400);
  }
  function crawl(){
    if (busy || document.hidden) return; busy = true;
    var x = Math.round(innerWidth * (0.15 + Math.random() * 0.7));
    var c = mk(CRAWLS[Math.floor(Math.random() * CRAWLS.length)]);
    c.style.top = '-60px';
    c.style.left = x + 'px';
    c.classList.add('descend');
    c.style.transition = 'transform 2.6s cubic-bezier(.3,1.4,.4,1)';
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      c.style.transform = 'translateY(' + Math.round(innerHeight * 0.34) + 'px)';
    });});
    setTimeout(function(){
      if (!el) return;
      el.style.transition = 'transform 1.4s cubic-bezier(.6,-.4,.7,1)';
      el.style.transform = 'translateY(-80px)';
      setTimeout(rm, 1400);
    }, 5200);
  }
  function spawn(){ (Math.random() < 0.3 ? crawl : walk)(); }
  setTimeout(spawn, 4500);
  setInterval(function(){ if (Math.random() < 0.65) spawn(); }, 26000);
  var half = false;
  addEventListener('scroll', function(){
    if (half) return;
    if (scrollY > (document.body.scrollHeight - innerHeight) * 0.5) { half = true; spawn(); }
  }, { passive: true });
})();
</script>
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
