// Cross-provider matrix (D2) — UNIT proof, all network mocked. Covers the two
// real bugs found auditing the matrix:
//   1. agent_synth returned res.text() of a STREAMING SSE response for
//      gpt/gemini → the JSON extractor parsed the SSE envelope, not the model
//      output. Every non-Claude build produced malformed JSON. Fixed: assemble
//      the stream first (sseToText).
//   2. Grok was excluded from orchestration/agent_synth (a Grok-only user could
//      chat but not orchestrate or build). Fixed: grok is now a full
//      orchestration provider (OpenAI-wire-compatible, /grok route).
// The LIVE matrix (real provider calls through the deployed worker) is
// scripts/smoke-cross-provider-live.mjs — needs real keys + a Supabase JWT.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const enc = new TextEncoder()
// A fake streaming body: yields each frame as a chunk, then done.
function sseBody(frames) {
  const chunks = frames.map(f => enc.encode(f))
  let i = 0
  return { getReader: () => ({ read: () => i < chunks.length ? Promise.resolve({ done: false, value: chunks[i++] }) : Promise.resolve({ done: true }) }) }
}
// OpenAI/xAI delta frames that spell out a JSON object across chunk boundaries.
const openaiFrames = (text) => text.match(/.{1,7}/gs).map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n`).concat(['data: [DONE]\n'])
const geminiFrames = (text) => text.match(/.{1,7}/gs).map(p => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] })}\n`)

// The deliverable the "model" emits — note it's wrapped so a BROKEN (un-
// assembled) path would instead trip over the SSE envelope's leading `{`.
const DOC = '{"title":"Deck","sections":[{"heading":"H","paragraphs":["p"]}]}'
const DECISION = '{"mode":"discuss","spend_mode":"balanced","agents_to_respond":["grok"],"rounds":1,"response_mode":"concise","reasoning":"ok"}'

let lastUrl = ''
globalThis.fetch = async (url, opts = {}) => {
  lastUrl = String(url)
  const u = String(url)
  // Provider chat/synth routes:
  if (u.endsWith('/claude')) return { ok: true, status: 200, json: async () => ({ content: [{ text: DOC }] }) }
  if (u.endsWith('/gpt') || u.endsWith('/grok')) {
    // Orchestrate's system prompt says "You are OpenClaw"; agent_synth's never
    // does — that's the clean discriminator (both mention "JSON").
    const wantsDecision = String(opts.body || '').includes('OpenClaw')
    return { ok: true, status: 200, body: sseBody(openaiFrames(wantsDecision ? DECISION : DOC)) }
  }
  if (u.endsWith('/gemini')) return { ok: true, status: 200, body: sseBody(geminiFrames(DOC)) }
  // supabase REST/auth incidental calls:
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { selectOrchestrationModel, orchestrate } = await server.ssrLoadModule('/src/utils/openClaw.js')
  const { selectCheapModel } = await server.ssrLoadModule('/src/utils/cheapModel.js')
  const { TOOLS_BY_ID } = await server.ssrLoadModule('/src/tools/registry.js')
  const synth = TOOLS_BY_ID.agent_synth

  // ── selectOrchestrationModel: priority + grok fallback ──────────────
  check('claude wins when multiple keys', selectOrchestrationModel({ agents: { claude: { key: 'c' }, grok: { key: 'g' } } })?.provider === 'claude')
  check('grok chosen when it is the only key', selectOrchestrationModel({ agents: { grok: { key: 'g' } } })?.provider === 'grok')
  check('no keys → null', selectOrchestrationModel({ agents: {} }) === null)
  check('cheap model also reaches grok-only', selectCheapModel({ agents: { grok: { key: 'g' } } })?.provider === 'grok')

  // ── agent_synth: assembles the stream for EVERY provider ────────────
  // If assembly were broken, the extractor would parse the SSE envelope
  // ({"choices":…} / {"candidates":…}) instead of the deck — title would be
  // undefined. Asserting title==='Deck' proves the fix per provider.
  const claudeOut = await synth.run({ prompt: 'make a deck', outputSchema: 'document', settings: { agents: { claude: { key: 'c' } } } })
  check('claude synth → parsed doc', claudeOut?.title === 'Deck', JSON.stringify(claudeOut).slice(0, 60))

  const gptOut = await synth.run({ prompt: 'make a deck', outputSchema: 'document', settings: { agents: { gpt: { key: 'g' } } } })
  check('gpt synth → assembled stream, NOT raw SSE frames', gptOut?.title === 'Deck', JSON.stringify(gptOut).slice(0, 60))
  check('gpt synth hit /gpt route', lastUrl.endsWith('/gpt'), lastUrl)

  const gemOut = await synth.run({ prompt: 'make a deck', outputSchema: 'document', settings: { agents: { gemini: { key: 'g' } } } })
  check('gemini synth → assembled stream', gemOut?.title === 'Deck', JSON.stringify(gemOut).slice(0, 60))
  check('gemini synth hit /gemini route', lastUrl.endsWith('/gemini'), lastUrl)

  const grokOut = await synth.run({ prompt: 'make a deck', outputSchema: 'document', settings: { agents: { grok: { key: 'g' } } } })
  check('grok synth → assembled stream (build works)', grokOut?.title === 'Deck', JSON.stringify(grokOut).slice(0, 60))
  check('grok synth hit /grok route', lastUrl.endsWith('/grok'), lastUrl)

  // ── orchestrate: a Grok-only user gets real orchestration ───────────
  const dec = await orchestrate({ userMessage: 'hi', enabledAgents: ['grok'], settings: { agents: { grok: { key: 'g' } } } })
  check('grok-only orchestrate returns a decision', !!dec && typeof dec.mode === 'string', dec?.mode)
  check('grok-only orchestrate routed to /grok', lastUrl.endsWith('/grok'), lastUrl)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all cross-provider checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
