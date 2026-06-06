// LIVE cross-provider matrix (D2) — calls the REAL chat routes through the
// deployed Cloudflare worker, exactly as the browser does, to prove every
// provider's current model + the worker routing + the BYOK key all work.
// Costs a few cents total (one tiny completion per provider). MANUAL-only.
//
// Reach the worker: a Supabase JWT — SMOKE_SUPABASE_JWT, or
// SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD (+ VITE_SUPABASE_ANON_KEY) to mint one.
// Provider keys (each provider runs only if its key is present, else SKIP):
//   CLAUDE/ANTHROPIC_API_KEY · OPENAI_API_KEY · GEMINI/GOOGLE_API_KEY · XAI/GROK_API_KEY
//
// Run: npm run smoke:xprovider:live
import { MODELS } from '../src/config/models.js'

const PROXY = process.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY || ''

let pass = 0, fail = 0, skip = 0
const line = (icon, name, detail = '') => console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`)

async function getJwt() {
  if (process.env.SMOKE_SUPABASE_JWT) return process.env.SMOKE_SUPABASE_JWT
  const email = process.env.SMOKE_TEST_EMAIL, password = process.env.SMOKE_TEST_PASSWORD
  if (email && password && ANON) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email, password }),
    })
    if (r.ok) return (await r.json()).access_token || null
    line('⚠️', 'JWT mint failed', `status ${r.status}`)
  }
  return null
}

// Assemble an OpenAI/xAI or Gemini SSE stream into text.
async function sseToText(res, kind) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      if (!l.startsWith('data: ') || l.includes('[DONE]')) continue
      try {
        const d = JSON.parse(l.slice(6))
        if (kind === 'gemini') { const t = d.candidates?.[0]?.content?.parts?.[0]?.text; if (t) full += t }
        else { const c = d.choices?.[0]?.delta?.content; if (c) full += c }
      } catch { /* partial frame */ }
    }
  }
  return full
}

const PROMPT = 'Reply with exactly one word: pong'

const PROVIDERS = [
  { id: 'claude', key: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
    auth: k => ({ 'x-api-key': k }), body: m => ({ model: m, messages: [{ role: 'user', content: PROMPT }], max_tokens: 16 }),
    read: async res => (await res.json()).content?.[0]?.text || '' },
  { id: 'gpt', key: process.env.OPENAI_API_KEY,
    auth: k => ({ Authorization: `Bearer ${k}` }), body: m => ({ model: m, messages: [{ role: 'user', content: PROMPT }] }),
    read: res => sseToText(res, 'gpt') },
  { id: 'gemini', key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    auth: k => ({ 'x-api-key': k }), body: m => ({ model: m, contents: [{ role: 'user', parts: [{ text: PROMPT }] }] }),
    read: res => sseToText(res, 'gemini') },
  { id: 'grok', key: process.env.XAI_API_KEY || process.env.GROK_API_KEY,
    auth: k => ({ Authorization: `Bearer ${k}` }), body: m => ({ model: m, messages: [{ role: 'user', content: PROMPT }] }),
    read: res => sseToText(res, 'grok') },
]

const JWT = await getJwt()
if (!JWT) {
  line('⚠️', 'No Supabase JWT', 'set SMOKE_SUPABASE_JWT or SMOKE_TEST_EMAIL/PASSWORD (+ANON) — every provider will be skipped')
}

console.log(`\n  CROSS-PROVIDER LIVE MATRIX  →  ${PROXY}\n`)
for (const p of PROVIDERS) {
  if (!p.key) { line('⏭️ ', `${p.id.padEnd(7)} SKIP`, 'no key in env'); skip++; continue }
  if (!JWT) { line('⏭️ ', `${p.id.padEnd(7)} SKIP`, 'no JWT'); skip++; continue }
  const model = MODELS[p.id]?.primary
  try {
    const res = await fetch(`${PROXY}/${p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-supabase-auth': `Bearer ${JWT}`, ...p.auth(p.key) },
      body: JSON.stringify(p.body(model)),
    })
    if (!res.ok) { const t = await res.text().catch(() => ''); line('❌', `${p.id.padEnd(7)} FAIL`, `${model} → ${res.status} ${t.slice(0, 120)}`); fail++; continue }
    const text = (await p.read(res)).trim()
    if (text) { line('✅', `${p.id.padEnd(7)} OK  `, `${model} → "${text.slice(0, 40)}"`); pass++ }
    else { line('❌', `${p.id.padEnd(7)} FAIL`, `${model} → empty response`); fail++ }
  } catch (e) {
    line('❌', `${p.id.padEnd(7)} FAIL`, `${model} → ${e.message}`); fail++
  }
}

console.log(`\n  ${pass} ok · ${fail} fail · ${skip} skipped`)
process.exit(fail ? 1 : 0)
