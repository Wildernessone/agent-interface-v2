// mcp.js — the Agent Interface tracker, exposed as a remote MCP server.
//
// WHY THIS SITE FIRST. agentinterface.app is the reference site for the "agent interface"
// category and keeps a living tracker of agent protocols — MCP among them. Documenting the
// connector standard while not speaking it is a hole in the thesis, and closing it gives the
// weekly refresh something ORIGINAL to write about, which is the thing its E-E-A-T is
// starved of.
//
// ⚠ WebMCP (the in-page browser API) is a Chrome origin trial behind a flag. A REMOTE MCP
// server is the half that works TODAY: Claude, ChatGPT, Perplexity, Grok and Mistral all
// accept a custom connector as an HTTPS URL. So the tools are defined once here and can be
// surfaced twice — over this endpoint now, and in-page via WebMCP when that ships.
//
// TRANSPORT. Streamable HTTP, JSON-RPC 2.0 over a single POST endpoint. The 2026-07-28 spec
// revision dropped protocol-level sessions for a stateless core — which is exactly what a
// Pages Function is, so there is no session store here and none is needed. (That fact is the
// site's own tracked claim, sourced on /tracker.)
//
// ⛔ READ-ONLY, NO AUTH, NO PII. Everything served is already public on /tracker and
// /tracker.json under CC BY. Nothing here writes, and nothing here can reach a user record —
// this site has none. Any future tool that writes belongs behind a separate decision.
import { TRACKER, TRACKER_UPDATED } from './_tracker-data.js'

const SITE = 'https://agentinterface.app'
// Echo back the client's protocol version when we know it; otherwise answer with ours.
const SUPPORTED = ['2026-07-28', '2025-06-18', '2025-03-26']
const LATEST = SUPPORTED[0]

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors },
  })

// JSON-RPC helpers. Error shape is consistent on purpose: code, message, and data for
// anything the caller could act on.
const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const err = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } })

// ── the tools ────────────────────────────────────────────────────────────────
// Names are lowercase snake_case; every description opens with a verb and says what the
// caller gets, because a description is the only thing an agent has to choose by.
const TOOLS = [
  {
    name: 'list_agent_protocols',
    description:
      'List every agent protocol, standard and framework tracked by agentinterface.app, with its current status. Use this to find out what exists in the agent-interoperability space and which of it is alive, dead or merged. Returns the whole tracked set unless filtered.',
    inputSchema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          description: "Restrict to one group, e.g. 'protocol' for agent-to-tool standards. Omit for all groups.",
        },
        status: {
          type: 'string',
          description:
            "Restrict to one status, e.g. 'dead' for the graveyard of retired protocols, or 'active'. Omit for all statuses.",
        },
      },
    },
  },
  {
    name: 'get_agent_protocol',
    description:
      'Retrieve the full tracked record for one agent protocol by its id or name — who stewards it, what it does, its current status, our dated editorial call on it, and the source links every claim traces to.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: "The protocol's tracker id or name, e.g. 'mcp', 'a2a', 'Model Context Protocol'. Case-insensitive.",
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_agent_protocols',
    description:
      'Search the tracked agent protocols by free text across their names, summaries and editorial calls. Use this when you know what a protocol does but not what it is called.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "agent to agent" or "browser".' },
      },
      required: ['query'],
    },
  },
]

// Keep responses small enough to be useful in a context window: the list view is a summary,
// and the full record (with every source link) comes from get_agent_protocol.
const summarize = (e) => ({
  id: e.id, name: e.name, group: e.group, status: e.status || 'active',
  steward: e.steward || null, summary: e.short || null,
  url: `${SITE}/tracker#${e.id}`,
})
const detail = (e) => ({
  ...summarize(e),
  editorial_call: e.call || null,
  // ⚠ links are ['label', 'url'] PAIRS in the changesets, not objects — verified against
  // the real data rather than assumed. A source list an agent cannot read is worse than none,
  // because the whole claim of this tracker is that every fact traces somewhere.
  sources: (e.links || []).map((l) => (Array.isArray(l)
    ? { label: l[0] || null, url: l[1] || null }
    : typeof l === 'string' ? { label: null, url: l }
    : { label: l.label || null, url: l.url || null })),
})

const norm = (s) => String(s || '').toLowerCase().trim()

function runTool(name, args) {
  const a = args || {}
  if (name === 'list_agent_protocols') {
    let rows = TRACKER
    if (a.group) rows = rows.filter((e) => norm(e.group) === norm(a.group))
    if (a.status) rows = rows.filter((e) => norm(e.status || 'active') === norm(a.status))
    return {
      updated: TRACKER_UPDATED, count: rows.length,
      source: `${SITE}/tracker`,
      license: 'CC BY 4.0 — attribute to agentinterface.app',
      protocols: rows.map(summarize),
    }
  }
  if (name === 'get_agent_protocol') {
    const q = norm(a.id)
    if (!q) throw new Error('id is required')
    const hit = TRACKER.find((e) => norm(e.id) === q) || TRACKER.find((e) => norm(e.name).includes(q))
    if (!hit) {
      return {
        found: false,
        message: `Nothing tracked under "${a.id}".`,
        // A dead end is more useful with the alternatives attached than without.
        did_you_mean: TRACKER.slice(0, 12).map((e) => e.id),
      }
    }
    return { found: true, updated: TRACKER_UPDATED, source: `${SITE}/tracker`, protocol: detail(hit) }
  }
  if (name === 'search_agent_protocols') {
    const q = norm(a.query)
    if (!q) throw new Error('query is required')
    const rows = TRACKER.filter((e) => norm([e.id, e.name, e.short, e.call, e.steward].join(' ')).includes(q))
    return { updated: TRACKER_UPDATED, query: a.query, count: rows.length, source: `${SITE}/tracker`, protocols: rows.map(summarize) }
  }
  throw new Error(`Unknown tool: ${name}`)
}

async function handle(msg) {
  const { id = null, method, params } = msg || {}

  if (method === 'initialize') {
    const asked = params && params.protocolVersion
    return ok(id, {
      protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'agent-interface-tracker', version: '1.0.0' },
      instructions:
        'A living, sourced tracker of agent protocols, standards and frameworks — including the graveyard of ones that died, which nothing else tracks. Every factual claim carries a source link. Facts are facts; the editorial calls are CC BY 4.0 with attribution to agentinterface.app.',
    })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: TOOLS })
  if (method === 'tools/call') {
    const name = params && params.name
    try {
      const result = runTool(name, params && params.arguments)
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false })
    } catch (e) {
      // Tool failures are reported INSIDE the result, not as a protocol error — the agent
      // should be able to read what went wrong and try again.
      return ok(id, { content: [{ type: 'text', text: `Error: ${String(e.message || e)}` }], isError: true })
    }
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return null   // notifications take no reply
  return err(id, -32601, `Method not found: ${method}`)
}

export async function onRequest(context) {
  const { request } = context
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  // A GET here is usually a human or a probe. Say what this is rather than 405-ing blankly.
  if (request.method === 'GET') {
    return json({
      name: 'agent-interface-tracker',
      transport: 'Streamable HTTP (JSON-RPC 2.0 over POST to this URL)',
      connect: `Add ${SITE}/mcp as a custom connector in Claude, ChatGPT, Perplexity, Grok or Mistral.`,
      tools: TOOLS.map((t) => t.name),
      updated: TRACKER_UPDATED,
      docs: `${SITE}/tracker`,
    })
  }
  if (request.method !== 'POST') return json({ error: 'Use POST for JSON-RPC, or GET for a description.' }, 405)

  let body
  try { body = await request.json() } catch { return json(err(null, -32700, 'Parse error: body is not JSON'), 400) }

  // A batch is an array; a single call is an object. Both are valid JSON-RPC.
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: cors })
  }
  const res = await handle(body)
  return res ? json(res) : new Response(null, { status: 202, headers: cors })
}
