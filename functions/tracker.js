// /tracker — the living index of the agent-interface layer.
// Data lives in _tracker-data.js (versioned in git; every substantive edit
// bumps TRACKER_UPDATED). caniuse-style promise: statuses are dated editorial
// calls with sources, not a directory dump.
import { page, esc, SITE } from './_site.js'
import { TRACKER, TRACKER_UPDATED } from './_tracker-data.js'

const GROUPS = [
  ['protocol', 'Protocols — the agent ↔ software layer', 'Open specs wiring agents to tools, each other, frontends, and money.'],
  ['graveyard', 'The graveyard — what died, merged, or went dormant', 'Churn here is brutal: three major agent surfaces died within a year of launch. Knowing what is dead is half the value of a tracker, and nobody else keeps this list.'],
  ['pattern', 'Patterns — the human ↔ agent layer', 'No unified standard owns the human side; shipped products converged on these anyway.'],
  ['surface', 'Surfaces — where agents meet users', 'The product categories the interface work is happening in.'],
]

const STATUS_KEY = {
  live: 'Established — safe to build on',
  rising: 'Rising — real adoption, still moving',
  early: 'Early — promising, expect breaking changes',
  watch: 'Watch — too soon to call',
  dead: 'Dead — merged, deprecated, or dormant',
}

export async function onRequestGet() {
  const desc = 'A living, dated index of agent-interface protocols, patterns, and surfaces — status calls with sources, reviewed continuously.'

  const sections = GROUPS.map(([g, heading, sub]) => {
    const rows = TRACKER.filter(t => t.group === g).map(t => `
<tr id="${esc(t.id)}">
  <td><strong>${esc(t.name)}</strong><br><span style="color:var(--faint);font-size:12.5px">${esc(t.steward)}</span></td>
  <td>${esc(t.short)}${t.call ? `<br><span style="color:var(--dim);font-size:13px"><em>The call:</em> ${esc(t.call)}</span>` : ''}</td>
  <td><span class="status s-${esc(t.status)}">${esc(t.statusLabel)}</span><div class="vdate">checked ${esc(t.checked || TRACKER_UPDATED)}</div></td>
  <td>${(t.links || []).map(([label, href]) => `<a href="${esc(href)}" rel="noopener">${esc(label)}</a>`).join('<br>')}</td>
</tr>`).join('\n')
    return `
<h2>${esc(heading)}</h2>
<p style="color:var(--dim)">${esc(sub)}</p>
<div class="tbl"><table>
<thead><tr><th>Name</th><th>What it is</th><th>Status</th><th>Links</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>`
  }).join('\n')

  const jsonld = [{
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'The agent-interface tracker', url: `${SITE}/tracker`,
    description: desc, dateModified: TRACKER_UPDATED,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: TRACKER.map((t, i) => ({
        '@type': 'ListItem', position: i + 1, name: t.name, url: `${SITE}/tracker#${t.id}`,
      })),
    },
  }]

  const body = `
<p class="kicker">Tracker</p>
<h1>The agent-interface tracker</h1>
<p class="lede">${esc(desc)}</p>
<p class="meta-line">updated ${esc(TRACKER_UPDATED)} · status: living document · re-checked against source repos and announcements · <a href="/tracker.json">machine-readable twin</a></p>
<p class="stamp"><span class="pulse"></span> Statuses are editorial calls, dated and sourced — corrections welcome</p>
<div class="tbl" style="margin-top:22px"><table>
<thead><tr><th>Status key</th><th>Meaning</th></tr></thead>
<tbody>${Object.entries(STATUS_KEY).map(([k, v]) => `<tr><td><span class="status s-${k}">${esc(k)}</span></td><td>${esc(v)}</td></tr>`).join('')}</tbody>
</table></div>
${sections}
<hr>
<p style="color:var(--dim);font-size:14px">New here? Start at <a href="/">what is an agent interface</a>. Deeper dives ship as <a href="/guides">guides</a>.</p>`

  return page({
    title: 'The agent-interface tracker — protocols & patterns',
    desc,
    path: '/tracker',
    active: '/tracker',
    jsonld,
    crumbs: [['/', 'Agent Interface'], ['/tracker', 'Tracker']],
    body,
  })
}
