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
import { TRACKER, TRACKER_UPDATED } from './_tracker-data.js'

const LAST_REVIEWED = '2026-07-24'

export async function onRequestGet() {
  const desc = 'An agent interface is the layer where an AI agent meets everything outside the model: the controls humans use to direct it, and the protocols it uses to operate software.'

  const protoCards = TRACKER.filter(t => t.group === 'protocol').slice(0, 6).map(t => `
    <a class="card" href="/tracker#${t.id}">
      <span class="t">${t.name}</span>
      <span class="d">${t.short}</span>
      <span class="m">${t.steward} · <span class="status s-${t.status}">${t.statusLabel}</span></span>
    </a>`).join('\n')

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
<h1>What is an agent interface?</h1>

<div class="answer">
  <div class="lbl">Definition</div>
  <p><strong>An agent interface is the layer where an AI agent meets everything outside the model.</strong> It has two sides: the surface a human uses to direct, supervise, and correct the agent — and the protocols the agent uses to operate software, tools, and other agents. Chat panels, approval gates, MCP connections, and computer-use screen control are all parts of it.</p>
</div>

<p class="meta-line">updated ${LAST_REVIEWED} · status: living document · every claim sourced · <a href="/tracker">tracker updated ${TRACKER_UPDATED}</a> · <a href="/tracker.json">json</a></p>

<p style="color:var(--faint);font-size:13.5px">Disambiguation: "agent interface" also has an older meaning — the screen a human support agent uses in contact-center software. This site covers the AI sense of the term.</p>

<h2>The short version</h2>
<ul>
  <li>The term covers <strong>two layers</strong>: human ↔ agent (supervision UX) and agent ↔ software (protocols). Most confusion comes from mixing them.</li>
  <li>The agent-software layer is standardizing fast — a handful of open protocols now define how agents reach tools, each other, frontends, and payments. The <a href="/tracker">tracker</a> holds the current map.</li>
  <li>The human-agent layer is converging on repeatable patterns — approval gates, permission modes, streaming progress, handoffs — ahead of any formal standard. The <a href="/guides">guides</a> cover them one at a time.</li>
  <li>An agent interface is judged by one question: can a human predict, bound, and audit what the agent will do? Everything on this site serves that question.</li>
</ul>

<h2>What does an agent interface do?</h2>
<p>An agent interface turns a capable model into a system people can actually delegate to. Downward, it gives the agent structured access to the world: tools it can call, data it can read, software it can operate, other agents it can hand work to. Upward, it gives the human command: what the agent may touch, when it must ask, what it is doing right now, and what it did last Tuesday.</p>
<p>The two directions are one design problem. Every new capability granted below creates a supervision question above — an agent that can spend money needs a spending gate; an agent that can act across apps needs an audit trail that spans them. Products that treat the protocol side and the UX side as separate projects ship the gap between them.</p>

<h2>Agent interface vs. chatbot UI vs. copilot</h2>
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

<h2>The protocol layer, mapped</h2>
<p>The agent-software side of the interface is where the standardization is happening. These are the protocols and approaches that matter right now — each links to its tracker entry with a current status call and sources:</p>
<div class="grid">
${protoCards}
</div>
<p><a href="/tracker">The full tracker →</a> is the living version of this map: statuses, stewards, spec links, and what changed, reviewed continuously.</p>

<h2>The human layer: the patterns that keep people in command</h2>
<p>No standards body owns the human side yet, but shipped products have converged on a recognizable pattern language. The load-bearing ones:</p>
<ul>
  <li><strong>The approval gate</strong> — the agent proposes, the human releases. Done well it shows the consequence, not the raw action. <a href="/guides/the-approval-gate-designing-sign-off-that-stays-meaningful">Guide →</a></li>
  <li><strong>Permission modes</strong> — graduated autonomy: read-only → suggest → auto-with-gates → scoped full-auto, set per domain, promoted only by the human. <a href="/guides/permission-modes-graduated-autonomy-for-ai-agents">Guide →</a></li>
  <li><strong>Streaming progress</strong> — a long-running agent narrates what it is doing at decision-level, so interruption is possible before the consequence, not after.</li>
  <li><strong>Handoff</strong> — the agent escalates with context when it is stuck, instead of guessing expensively.</li>
  <li><strong>The audit trail</strong> — append-only history of action, predicted consequence, and approver. The thing that makes widening autonomy survivable.</li>
</ul>

<h2>Why agent interfaces matter in 2026</h2>
<p>Models crossed the capability line before products crossed the trust line. What limits deployment of agents today is rarely whether the model can do the work — it is whether an organization can predict, bound, and audit the work. That is an interface problem, in both directions: protocols make capability legible to software; supervision UX makes it legible to people.</p>
<p>The teams shipping agents successfully are the ones treating the interface as the product. The model is rented; the interface — the permissions, the gates, the trail, the integrations — is what they actually build.</p>

<h2>Frequently asked questions</h2>
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
