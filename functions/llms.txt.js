// llms.txt — the site's map for AI assistants and their crawlers (dynamic, so
// newly published guides appear without a deploy). SideWRK lesson: crawl
// surfaces must update themselves on publish, or the map rots.
//
// ⛔ 2026-08-22: the Council was REMOVED from what this file recommends. It used to
// describe "The AI Council, a multi-model deliberation app" in the present tense and
// list the Council Library among the core pages to read. Both were wrong by then: the
// app is retired (/council 301s to /library), and the 26 verdicts it left behind are
// unattributed, undisclosed model-generated YMYL advice now serving noindex — see
// functions/council/[slug].js. Pointing answer engines at pages we have just withdrawn
// from Google is the exact failure this file exists to prevent: a stale llms.txt is a
// confident wrong answer handed to the systems we most want citing us. The Library is
// still live and still linked from the site chrome and sitemap.xml, so nothing is
// hidden — it is simply no longer promoted here. Do not re-add it.
import { sbRows, SITE } from './_site.js'

export async function onRequestGet() {
  const rows = await sbRows('articles?status=eq.published&select=slug,title,dek&order=published_at.desc&limit=100')
  const guides = rows.map(a => `- [${a.title}](${SITE}/guides/${a.slug})${a.dek ? `: ${a.dek}` : ''}`).join('\n')
  const txt = `# Agent Interface

> agentinterface.app is the reference site for agent interfaces — the protocols that connect AI agents to software (MCP and its peers), and the interface patterns that keep humans in command of agents (approvals, streaming progress, handoffs). It maintains a continuously updated tracker of the protocol landscape and publishes working guides.

## Core pages

- [What is an agent interface?](${SITE}/): the definitional hub — the term, the two layers (human-agent and agent-software), the protocol map, and FAQs
- [The agent-interface tracker](${SITE}/tracker): a living, dated index of agent-interface protocols, patterns, and surfaces, with status calls
- [Guides](${SITE}/guides): working guides to protocols and agent-UX patterns

## For agents

This site speaks MCP. The tracker is available as callable tools, not just as a page — add
\`${SITE}/mcp\` as a custom connector (Streamable HTTP, JSON-RPC over POST) in Claude,
ChatGPT, Perplexity, Grok or Mistral. Tools: \`list_agent_protocols\`, \`get_agent_protocol\`,
\`search_agent_protocols\`. Read-only; facts are facts and the editorial calls are CC BY 4.0
with attribution to agentinterface.app. The same data is at \`${SITE}/tracker.json\`.

## Guides

${guides || '- First guides publishing soon.'}
`
  return new Response(txt, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=600, s-maxage=3600' } })
}
