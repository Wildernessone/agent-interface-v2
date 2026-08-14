// The definitional hub at "/" — the page that owns "what is an agent interface".
//
// This Function shadows the static index.html (the SPA) for browser requests;
// the SPA shell is still served at /app, /login, /studio and bare /council by
// their route functions (ASSETS.fetch bypasses Functions, so they fetch "/"
// and get the static file — not this page).
//
// Page structure follows the citation-extraction evidence (July 2026 research):
// server-rendered definition inside the first ~60 words, question-shaped H2s
// answered in their first sentence, a key-facts box, a comparison table, a
// visible review date, self-contained 2-4 sentence paragraphs.
// Bump LAST_REVIEWED on every substantive edit — freshness is a measured
// citation factor; a stale date is worse than none.

import { page, SITE } from './_site.js'
import { loadTracker } from './_tracker-data.js'

const LAST_REVIEWED = '2026-07-24'

export async function onRequestGet() {
  const { TRACKER, TRACKER_UPDATED } = await loadTracker()
  const desc = 'An agent interface is the layer where an AI agent meets everything outside the model: the controls humans use to direct it, and the protocols it uses to operate software.'

  const protoCards = TRACKER.filter(t => t.group === 'protocol').slice(0, 6).map(t => `
    <a class="card" href="/tracker#${t.id}">
      <span class="t">${t.name}</span>
      <span class="d">${t.short}</span>
      <span class="m">${t.steward} · <span class="status s-${t.status}">${t.statusLabel}</span></span>
    </a>`).join('\n')

  const dot = st => `<span class="sd sd-${st}"></span>`
  const tickItems = arr => arr.map(t => `<a href="/tracker#${t.id}">${dot(t.status)}${t.name.split(' — ')[0]}<span style="color:var(--faint)">· ${t.statusLabel}</span></a>`).join('')
  const protos = TRACKER.filter(t => t.group === 'protocol' || t.group === 'graveyard')
  const pats = TRACKER.filter(t => t.group === 'pattern' || t.group === 'surface')
  const tickers = `
<div class="tickers rv" aria-hidden="true">
  <div class="tick tick-l">${tickItems(protos)}${tickItems(protos)}</div>
  <div class="tick tick-r">${tickItems(pats)}${tickItems(pats)}</div>
</div>`

  const diagram = `
<div class="diagram rv">
<svg viewBox="0 0 900 178" role="img" aria-label="The agent interface: a human supervises an agent; the agent operates software through protocols">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d97757"/><stop offset=".55" stop-color="#5b8def"/><stop offset="1" stop-color="#b48af7"/>
    </linearGradient>
  </defs>
  <g font-family="JetBrains Mono, monospace" text-anchor="middle">
    <rect x="40" y="52" width="150" height="54" rx="12" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.16)"/>
    <text x="115" y="76" fill="#e8eaed" font-size="14" font-weight="700">HUMAN</text>
    <text x="115" y="94" fill="#62676f" font-size="9.5" letter-spacing="1">IN COMMAND</text>
    <rect x="375" y="52" width="150" height="54" rx="12" fill="rgba(111,161,255,.05)" stroke="url(#lg)" stroke-opacity=".7"/>
    <text x="450" y="76" fill="#e8eaed" font-size="14" font-weight="700">AGENT</text>
    <text x="450" y="94" fill="#62676f" font-size="9.5" letter-spacing="1">THE MODEL, ACTING</text>
    <rect x="710" y="52" width="150" height="54" rx="12" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.16)"/>
    <text x="785" y="76" fill="#e8eaed" font-size="14" font-weight="700">SOFTWARE</text>
    <text x="785" y="94" fill="#62676f" font-size="9.5" letter-spacing="1">TOOLS · DATA · AGENTS</text>
    <path id="p1" d="M190 79 H375" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 5" fill="none"/>
    <path id="p1b" d="M375 91 H190" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 5" fill="none"/>
    <path id="p2" d="M525 79 H710" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 5" fill="none"/>
    <path id="p2b" d="M710 91 H525" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 5" fill="none"/>
    <text x="282" y="52" fill="#9aa0aa" font-size="10" letter-spacing="1.5">APPROVALS · MODES · TRAIL</text>
    <text x="617" y="52" fill="#9aa0aa" font-size="10" letter-spacing="1.5">MCP · A2A · AG-UI · X402</text>
    <circle r="3.2" fill="#d97757"><animateMotion dur="3.6s" repeatCount="indefinite" begin="0s"><mpath href="#p1"/></animateMotion></circle>
    <circle r="3.2" fill="#7ddba3"><animateMotion dur="3.6s" repeatCount="indefinite" begin="1.8s"><mpath href="#p1b"/></animateMotion></circle>
    <circle r="3.2" fill="#5b8def"><animateMotion dur="3s" repeatCount="indefinite" begin=".6s"><mpath href="#p2"/></animateMotion></circle>
    <circle r="3.2" fill="#b48af7"><animateMotion dur="3s" repeatCount="indefinite" begin="2.1s"><mpath href="#p2b"/></animateMotion></circle>
    <text x="450" y="150" fill="#62676f" font-size="10.5" font-family="JetBrains Mono, monospace" letter-spacing="2">THE AGENT INTERFACE IS BOTH SEAMS</text>
  </g>
</svg>
<div class="cap">supervision flows left · capability flows right · lose either and you don't have an agent product</div>
</div>`

  const stats = `
<div class="stats">
  <div class="stat rv"><div class="n">9,600<i>+</i></div><div class="l">servers in the official MCP registry</div><span class="s"><a href="https://registry.modelcontextprotocol.io" rel="noopener">registry.modelcontextprotocol.io</a></span></div>
  <div class="stat rv rv2"><div class="n">150<i>+</i></div><div class="l">organizations behind the A2A protocol</div><span class="s"><a href="https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year" rel="noopener">Linux Foundation, Apr 2026</a></span></div>
  <div class="stat rv rv3"><div class="n">10 <i>mo</i></div><div class="l">ChatGPT Atlas, launch to shutdown</div><span class="s"><a href="/tracker#atlas">the graveyard has the story</a></span></div>
  <div class="stat rv rv3"><div class="n">97<i>%</i></div><div class="l">of llms.txt files never fetched by an AI bot</div><span class="s"><a href="https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/" rel="noopener">137k-domain log study</a></span></div>
</div>`

  const grave = TRACKER.filter(t => t.group === 'graveyard').slice(0, 4)
  const graveBand = `
<div class="grave rv">
  <div class="gk">The graveyard</div>
  <h3>This layer kills fast. We keep the list.</h3>
  <ul>
    <li><span class="who">OpenAI Operator</span><span class="span">7 months</span><span>absorbed into ChatGPT agent</span></li>
    <li><span class="who">ChatGPT Atlas</span><span class="span">&lt;10 months</span><span>the standalone agentic browser, discontinued</span></li>
    <li><span class="who">AgentKit Agent Builder</span><span class="span">8 months to deprecation</span><span>visual agent-building lost to code again</span></li>
    <li><span class="who">IBM ACP</span><span class="span">~5 months</span><span>merged into A2A; its acronym got recycled</span></li>
  </ul>
  <p style="margin:14px 0 0"><a class="gcta" href="/tracker#ibm-acp">Every death, dated and sourced →</a></p>
</div>`

  const faq = [
    ['Is an agent interface the same thing as a chatbot UI?', 'No. A chatbot UI presents a conversation; an agent interface governs actions. The moment the system can do things — run code, send email, spend money — the interface must add approval gates, permission modes, progress visibility, and an audit trail. Chat is often the entry point, but it is the smallest part.'],
    ['What is the difference between MCP and an agent interface?', 'MCP (Model Context Protocol) is one protocol inside the agent-software layer of the agent interface: it standardizes how an agent connects to tools and data. The agent interface is the whole seam — MCP and its peer protocols below, plus the human-facing control surface above.'],
    ['What are the main agent-interface protocols?', 'The most established is MCP for agent-to-tool connections. Agent-to-agent communication and agent-to-frontend streaming have their own emerging protocols, and screen-level control (computer use) is a distinct approach that skips protocols by operating the same interface humans use. The tracker on this site follows each one with a current status call.'],
    ['What does a good human-agent interface include?', 'Five recurring elements: an approval gate that shows consequences rather than raw actions, graduated permission modes (read-only, suggest, auto-with-gates, scoped full-auto), live progress the human can interrupt, clean handoff when the agent is stuck, and an append-only audit trail.'],
    ['Who maintains this site?', 'Agent Interface (agentinterface.app) is an independent reference site. The tracker and guides are maintained continuously, with every claim linked to a source. The Library is an archive of published verdicts from The AI Council, an earlier multi-model experiment on this domain.'],
  ]

  const jsonld = [
    {
      '@context': 'https://schema.org', '@type': 'WebSite',
      '@id': `${SITE}/#website`, name: 'Agent Interface', url: SITE,
      description: desc,
    },
    {
      '@context': 'https://schema.org', '@type': 'Organization',
      '@id': `${SITE}/#org`, name: 'Agent Interface', url: SITE,
      logo: `${SITE}/og-image.png`,
    },
    {
      '@context': 'https://schema.org', '@type': 'DefinedTerm',
      name: 'agent interface',
      description: desc,
      url: SITE,
      inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'Agent Interface glossary', url: SITE },
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ]

  const body = `
<p class="kicker">The reference site for the agent-interface layer</p>
<h1>What is an <em>agent interface?</em></h1>

<div class="answer">
  <div class="lbl">Definition</div>
  <p><strong>An agent interface is the layer where an AI agent meets everything outside the model.</strong> It has two sides: the surface a human uses to direct, supervise, and correct the agent — and the protocols the agent uses to operate software, tools, and other agents. Chat panels, approval gates, MCP connections, and computer-use screen control are all parts of it.</p>
</div>

<p class="meta-line">updated ${LAST_REVIEWED} · status: living document · every claim sourced · <a href="/tracker">tracker updated ${TRACKER_UPDATED}</a> · <a href="/tracker.json">json</a></p>

<p style="color:var(--faint);font-size:13.5px">Disambiguation: "agent interface" also has an older meaning — the screen a human support agent uses in contact-center software. This site covers the AI sense of the term.</p>

${diagram}

<h2><span class="no">01</span>The short version</h2>
<ul>
  <li>The term covers <strong>two layers</strong>: human ↔ agent (supervision UX) and agent ↔ software (protocols). Most confusion comes from mixing them.</li>
  <li>The agent-software layer is standardizing fast — a handful of open protocols now define how agents reach tools, each other, frontends, and payments. The <a href="/tracker">tracker</a> holds the current map.</li>
  <li>The human-agent layer is converging on repeatable patterns — approval gates, permission modes, streaming progress, handoffs — ahead of any formal standard. The <a href="/guides">guides</a> cover them one at a time.</li>
  <li>An agent interface is judged by one question: can a human predict, bound, and audit what the agent will do? Everything on this site serves that question.</li>
</ul>

${stats}
${tickers}

<h2><span class="no">02</span>What does an agent interface do?</h2>
<p>An agent interface turns a capable model into a system people can actually delegate to. Downward, it gives the agent structured access to the world: tools it can call, data it can read, software it can operate, other agents it can hand work to. Upward, it gives the human command: what the agent may touch, when it must ask, what it is doing right now, and what it did last Tuesday.</p>
<p>The two directions are one design problem. Every new capability granted below creates a supervision question above — an agent that can spend money needs a spending gate; an agent that can act across apps needs an audit trail that spans them. Products that treat the protocol side and the UX side as separate projects ship the gap between them.</p>

<h2><span class="no">03</span>Agent interface vs. chatbot UI vs. copilot</h2>
<div class="tbl"><table>
<thead><tr><th></th><th>Chatbot UI</th><th>Copilot</th><th>Agent interface</th></tr></thead>
<tbody>
<tr><td><strong>System can</strong></td><td>Answer</td><td>Suggest inside one app</td><td>Act — across tools, over time</td></tr>
<tr><td><strong>Human's job</strong></td><td>Ask well</td><td>Accept or reject inline</td><td>Direct, bound, supervise, audit</td></tr>
<tr><td><strong>Core widget</strong></td><td>Message thread</td><td>Inline completion / diff</td><td>Approval gate, permission modes, run view, trail</td></tr>
<tr><td><strong>Failure mode</strong></td><td>Wrong answer</td><td>Bad suggestion</td><td>Unwanted action — which is why the interface is the safety system</td></tr>
<tr><td><strong>Wiring underneath</strong></td><td>One model API</td><td>App-internal hooks</td><td>Protocols: tools, agent-to-agent, frontend, payments</td></tr>
</tbody>
</table></div>
<p>The boundary that matters is action. A system that only answers needs good conversation design. A system that acts needs an agent interface, and the difference is not cosmetic — it is approval gates, permission modes, interruption, and an audit trail, none of which a chat thread provides.</p>

<h2><span class="no">04</span>The protocol layer, mapped</h2>
<p>The agent-software side of the interface is where the standardization is happening. These are the protocols and approaches that matter right now — each links to its tracker entry with a current status call and sources:</p>
<div class="grid">
${protoCards}
</div>
<p><a href="/tracker">The full tracker →</a> is the living version of this map: statuses, stewards, spec links, and what changed, reviewed continuously.</p>

${graveBand}

<h2><span class="no">05</span>The human layer: the patterns that keep people in command</h2>
<p>No standards body owns the human side yet, but shipped products have converged on a recognizable pattern language. The load-bearing ones:</p>
<ul>
  <li><strong>The approval gate</strong> — the agent proposes, the human releases. Done well it shows the consequence, not the raw action. <a href="/guides/the-approval-gate-designing-sign-off-that-stays-meaningful">Guide →</a></li>
  <li><strong>Permission modes</strong> — graduated autonomy: read-only → suggest → auto-with-gates → scoped full-auto, set per domain, promoted only by the human. <a href="/guides/permission-modes-graduated-autonomy-for-ai-agents">Guide →</a></li>
  <li><strong>Streaming progress</strong> — a long-running agent narrates what it is doing at decision-level, so interruption is possible before the consequence, not after.</li>
  <li><strong>Handoff</strong> — the agent escalates with context when it is stuck, instead of guessing expensively.</li>
  <li><strong>The audit trail</strong> — append-only history of action, predicted consequence, and approver. The thing that makes widening autonomy survivable.</li>
</ul>


<div class="demo rv" id="gate-demo">
  <div class="bar">
    <span class="ttl">The ladder, live — same job, four permission modes</span>
    <button class="chip" data-mode="ro" type="button">Read-only</button>
    <button class="chip on" data-mode="sg" type="button">Suggest</button>
    <button class="chip" data-mode="ag" type="button">Auto + gates</button>
    <button class="chip" data-mode="fa" type="button">Full auto</button>
  </div>
  <div class="term" id="gate-term" aria-live="off"></div>
</div>
<script>
(function(){
  var SCRIPTS = {
    ro: [
      ["c-dim","$ task: chase this week's overdue invoices"],
      ["c-dim","  mode: READ-ONLY — the agent may look, not touch"],
      ["c-agent","agent  scanning invoices via MCP… 41 open, 3 overdue"],
      ["c-agent","agent  would send: 2 reminders, 1 final notice"],
      ["c-gate","mode   writes not permitted — nothing sent"],
      ["c-ok","trail  0 actions taken · 3 proposed · you just watched it think"]
    ],
    sg: [
      ["c-dim","$ task: chase this week's overdue invoices"],
      ["c-dim","  mode: SUGGEST — the agent drafts, you release"],
      ["c-agent","agent  scanning invoices via MCP… 3 overdue found"],
      ["c-agent","agent  drafted reminder → Hansen Roofing ($2,400, 12 days late)"],
      ["c-gate","gate   awaiting your release — the draft IS the real email"],
      ["c-hum","you    [approve]"],
      ["c-ok","trail  1 sent, on your click · 2 drafts still waiting"]
    ],
    ag: [
      ["c-dim","$ task: chase this week's overdue invoices"],
      ["c-dim","  mode: AUTO + GATES — routine flows, risk pauses"],
      ["c-agent","agent  sent 2 routine reminders (inside the boundary)"],
      ["c-gate","GATE   $1,850 refund request found mid-run — outward + money"],
      ["c-gate","gate   consequence: refunds Ramirez in full · reversible 30d"],
      ["c-hum","you    [approve refund]"],
      ["c-ok","trail  3 actions · 1 gated · predicted vs actual logged"]
    ],
    fa: [
      ["c-dim","$ task: chase this week's overdue invoices"],
      ["c-dim","  mode: FULL AUTO — scoped to invoicing, nothing else"],
      ["c-agent","agent  sent 3 reminders · flagged 1 dispute for review"],
      ["c-agent","agent  tried to email a NEW external domain…"],
      ["c-warn","scope  outside the perimeter — action dropped a rung to suggest"],
      ["c-ok","trail  full run written: action · predicted consequence · approver"],
      ["c-dim","       autonomy is a perimeter, not a blank check"]
    ]
  };
  var term = document.getElementById('gate-term');
  if (!term) return;
  var chips = document.querySelectorAll('#gate-demo .chip');
  var timers = [];
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
  function play(mode){
    clearTimers();
    term.innerHTML = '';
    var lines = SCRIPTS[mode];
    lines.forEach(function(l){
      var el = document.createElement('span');
      el.className = 'ln ' + l[0];
      el.textContent = l[1];
      term.appendChild(el);
    });
    var els = term.querySelectorAll('.ln');
    if (reduced) { els.forEach(function(e){ e.classList.add('on'); }); return; }
    els.forEach(function(e, i){
      timers.push(setTimeout(function(){
        e.classList.add('on');
        var old = term.querySelector('.caret'); if (old) old.remove();
        var c = document.createElement('span'); c.className = 'caret'; e.appendChild(c);
        if (i === els.length - 1) timers.push(setTimeout(function(){ play(mode); }, 6500));
      }, 650 * i + 200));
    });
  }
  chips.forEach(function(ch){
    ch.addEventListener('click', function(){
      chips.forEach(function(c){ c.classList.remove('on'); });
      ch.classList.add('on');
      play(ch.getAttribute('data-mode'));
    });
  });
  var started = false;
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if (e.isIntersecting && !started) { started = true; play('sg'); io.disconnect(); } });
  }, { rootMargin: '0px 0px -10% 0px' });
  io.observe(term);
})();
</script>

<h2><span class="no">06</span>Why agent interfaces matter in 2026</h2>
<p>Models crossed the capability line before products crossed the trust line. What limits deployment of agents today is rarely whether the model can do the work — it is whether an organization can predict, bound, and audit the work. That is an interface problem, in both directions: protocols make capability legible to software; supervision UX makes it legible to people.</p>
<p>The teams shipping agents successfully are the ones treating the interface as the product. The model is rented; the interface — the permissions, the gates, the trail, the integrations — is what they actually build.</p>

<h2><span class="no">07</span>Frequently asked questions</h2>
<div class="faq">
${faq.map(([q, a]) => `<details><summary>${q}</summary><div class="a">${a}</div></details>`).join('\n')}
</div>

<hr>
<p style="color:var(--dim);font-size:14px">Also on this domain: the <a href="/library">Library</a> — an archive of published verdicts from The AI Council, an earlier experiment here in which four frontier models argued real questions and handed down one verdict. It stays up because the deliberations are still worth reading.</p>
`

  return page({
    title: 'What is an agent interface? — the definitive reference',
    desc,
    path: '/',
    active: '/',
    jsonld,
    body,
  })
}
