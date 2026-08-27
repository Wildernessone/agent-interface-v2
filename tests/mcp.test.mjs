// The remote MCP server, driven as a client would drive it.
//
// Exercises functions/mcp.js against the REAL tracker data — not a fixture — because the
// bug this caught on the first run was a shape assumption: links are ['label','url'] pairs,
// and a mapper written for objects produced a source list with every url null. A tracker
// whose whole claim is "every fact traces somewhere" cannot ship that.
import { onRequest } from '../functions/mcp.js'

let bad = 0
const check = (n, c, hint = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + hint}`); if (!c) bad++ }

const rpc = async (method, params, id = 1) => {
  const res = await onRequest({
    request: new Request('https://agentinterface.app/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
  })
  return { status: res.status, body: res.status === 202 ? null : await res.json() }
}
const call = async (name, args) => {
  const { body } = await rpc('tools/call', { name, arguments: args })
  const txt = body?.result?.content?.[0]?.text
  return { isError: body?.result?.isError, data: txt && txt.startsWith('{') ? JSON.parse(txt) : txt }
}

// ── handshake ──
{
  const { body } = await rpc('initialize', { protocolVersion: '2026-07-28', capabilities: {} })
  check('initialize returns a result', !!body.result)
  check('echoes back a supported protocol version', body.result.protocolVersion === '2026-07-28')
  check('declares the tools capability', !!body.result.capabilities?.tools)
  check('names itself', body.result.serverInfo?.name === 'agent-interface-tracker')
  check('carries instructions an agent can act on', (body.result.instructions || '').length > 60)
}
{
  const { body } = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} })
  check('falls back to our version when the client asks for one we lack', body.result.protocolVersion === '2026-07-28')
}
{
  const { status } = await rpc('notifications/initialized', {})
  check('a notification gets no reply body (202)', status === 202)
}

// ── the manifest, against the skill's checklist ──
{
  const { body } = await rpc('tools/list')
  const tools = body.result.tools
  check('lists three tools', tools.length === 3)
  check('names are unique', new Set(tools.map(t => t.name)).size === tools.length)
  check('names are lowercase snake_case', tools.every(t => /^[a-z0-9_]{3,64}$/.test(t.name)))
  check('every inputSchema is an object type', tools.every(t => t.inputSchema.type === 'object'))
  check('every required field exists in properties',
    tools.every(t => (t.inputSchema.required || []).every(r => r in (t.inputSchema.properties || {}))))
  check('descriptions are actionable and verb-led',
    tools.every(t => t.description.length >= 10 && /^(List|Retrieve|Search|Create|Get|Find)/.test(t.description)))
  check('every parameter explains its expected VALUES, not just its type',
    tools.every(t => Object.values(t.inputSchema.properties || {}).every(p => (p.description || '').length > 20)))
}

// ── the tools, against real data ──
{
  const { data, isError } = await call('list_agent_protocols', {})
  check('list returns the whole tracked set', !isError && data.count === 28, `count=${data?.count}`)
  check('list carries its provenance and licence', !!data.source && /CC BY/.test(data.license || ''))
  check('list is a summary, not the full record', !('editorial_call' in (data.protocols[0] || {})))
}
{
  const { data } = await call('list_agent_protocols', { group: 'protocol' })
  check('list filters by group', data.count > 0 && data.count < 28, `got ${data.count}`)
}
{
  const { data } = await call('get_agent_protocol', { id: 'mcp' })
  check('get finds MCP by id', data.found === true && data.protocol.id === 'mcp')
  check('get returns the editorial call', (data.protocol.editorial_call || '').length > 40)
  check('⭐ every source has a REAL url (the shape bug)',
    data.protocol.sources.length > 0 && data.protocol.sources.every(s => typeof s.url === 'string' && s.url.startsWith('http')),
    JSON.stringify(data.protocol.sources?.[0]))
}
{
  const { data } = await call('get_agent_protocol', { id: 'Model Context Protocol' })
  check('get also matches on name', data.found === true && data.protocol.id === 'mcp')
}
{
  const { data } = await call('get_agent_protocol', { id: 'no-such-thing' })
  check('a miss is a helpful answer, not an error', data.found === false && Array.isArray(data.did_you_mean))
}
{
  const { data } = await call('search_agent_protocols', { query: 'agent' })
  check('search finds by free text', data.count > 0)
}
{
  const { isError, data } = await call('get_agent_protocol', {})
  check('a missing required arg is reported IN the result, not as a protocol error',
    isError === true && /required/i.test(String(data)))
}
{
  const { isError } = await call('no_such_tool', {})
  check('an unknown tool is reported in-result too', isError === true)
}

// ── protocol edges ──
{
  const { body } = await rpc('does/not/exist')
  check('an unknown METHOD is a JSON-RPC error', body.error?.code === -32601)
}
{
  const res = await onRequest({ request: new Request('https://agentinterface.app/mcp', { method: 'GET' }) })
  const b = await res.json()
  check('GET explains what this endpoint is', res.status === 200 && Array.isArray(b.tools) && !!b.connect)
}
{
  const res = await onRequest({ request: new Request('https://agentinterface.app/mcp', { method: 'OPTIONS' }) })
  check('CORS preflight is answered', res.status === 204 && res.headers.get('access-control-allow-origin') === '*')
}
{
  const res = await onRequest({
    request: new Request('https://agentinterface.app/mcp', { method: 'POST', body: 'not json' }),
  })
  check('malformed JSON is a parse error, not a crash', res.status === 400)
}

console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)
