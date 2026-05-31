// LIVE contract smoke — calls the REAL external APIs end-to-end through the
// deployed Cloudflare worker, exactly as the browser does (tool.run() with a
// proxy that hits ${PROXY}/<route> carrying a Supabase JWT). This is the only
// thing that proves our doc-verified contracts match the live APIs.
//
// Costs real money and is slow (video/3D/avatar gen poll for 1-3 min), so it is
// MANUAL-ONLY (workflow_dispatch) and per-tool key-gated: a tool runs only if
// its key is in the env, otherwise it's SKIPPED (logged, not failed).
//
// Required to reach the worker: a Supabase user JWT — either SMOKE_SUPABASE_JWT
// directly, or SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD (+ the anon key) to mint
// one. Without it, every worker-routed test is skipped with guidance.
//
// Run: npm run smoke:live
import { createServer } from 'vite'

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email, password }),
    })
    if (r.ok) { const d = await r.json(); return d.access_token || null }
    line('⚠️', 'JWT mint failed', `status ${r.status}`)
  }
  return null
}

const JWT = await getJwt()

// Real proxy → deployed worker, mirroring the browser's proxyFetch.
const proxy = async (path, body, headers = {}) => fetch(`${PROXY}/${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(JWT ? { 'x-supabase-auth': `Bearer ${JWT}` } : {}), ...headers },
  body: JSON.stringify(body),
})

// Each test: tool id, the env var holding its key, an input, and a success
// assertion on the real returned output. `needsEnv` lists extra required vars.
const SAMPLE_AUDIO = process.env.SMOKE_AUDIO_URL || ''
const SAMPLE_IMAGE = process.env.SMOKE_IMAGE_URL || ''
const TESTS = [
  { id: 'exa', key: 'EXA_API_KEY', input: { query: 'latest AI research' }, ok: o => o?.type === 'search' && o.text?.length > 0 },
  { id: 'firecrawl', key: 'FIRECRAWL_API_KEY', input: { url: 'https://example.com' }, ok: o => o?.type === 'search' && o.text?.length > 0 },
  { id: 'stable_audio', key: 'STABILITY_API_KEY', input: { prompt: 'calm ambient pad', duration: 5 }, ok: o => o?.type === 'audio' && o.url?.startsWith('data:audio') },
  { id: 'elevenlabs_music', key: 'ELEVENLABS_API_KEY', input: { prompt: 'short upbeat jingle', length_ms: 5000 }, ok: o => o?.type === 'audio' && o.url?.startsWith('data:audio') },
  { id: 'luma', key: 'LUMA_API_KEY', input: { prompt: 'a paper boat on calm water, cinematic', duration: 5 }, ok: o => o?.type === 'video' && /^https?:/.test(o.url || '') },
  { id: 'pika', key: 'FAL_API_KEY', input: { prompt: 'gentle ocean waves at sunset', duration: 5 }, ok: o => o?.type === 'video' && /^https?:/.test(o.url || '') },
  { id: 'meshy', key: 'MESHY_API_KEY', input: { prompt: 'a small red apple' }, ok: o => o?.type === 'document' && /^https?:/.test(o.url || '') },
  { id: 'video_render', key: 'SHOTSTACK_API_KEY', input: { clips: [{ url: SAMPLE_IMAGE, type: 'image', length: 3 }], soundtrack: SAMPLE_AUDIO || undefined }, needsEnv: ['SMOKE_IMAGE_URL'], ok: o => o?.type === 'video' && /^https?:/.test(o.url || '') },
  { id: 'topaz', key: 'TOPAZ_API_KEY', input: { image_url: SAMPLE_IMAGE }, needsEnv: ['SMOKE_IMAGE_URL'], ok: o => o?.type === 'image' && /^https?:/.test(o.url || '') },
  { id: 'heygen', key: 'HEYGEN_API_KEY', input: { avatar_id: process.env.SMOKE_AVATAR_ID, voice_id: process.env.SMOKE_VOICE_ID, input_text: 'Hello from the live smoke test.' }, needsEnv: ['SMOKE_AVATAR_ID', 'SMOKE_VOICE_ID'], ok: o => o?.type === 'video' && /^https?:/.test(o.url || '') },
  { id: 'whisper', key: 'OPENAI_API_KEY', input: { audio_url: SAMPLE_AUDIO }, needsEnv: ['SMOKE_AUDIO_URL'], ok: o => o?.type === 'transcript' && typeof o.text === 'string' },
  { id: 'assemblyai', key: 'ASSEMBLYAI_API_KEY', input: { audio_url: SAMPLE_AUDIO }, needsEnv: ['SMOKE_AUDIO_URL'], ok: o => o?.type === 'transcript' && typeof o.text === 'string' },
]

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { TOOLS_BY_ID } = await server.ssrLoadModule('/src/tools/registry.js')

  for (const t of TESTS) {
    const keyVal = process.env[t.key]
    if (!keyVal) { skip++; line('⏭️ ', `${t.id}`, `skipped (set ${t.key})`); continue }
    const missingEnv = (t.needsEnv || []).filter(e => !process.env[e])
    if (missingEnv.length) { skip++; line('⏭️ ', `${t.id}`, `skipped (set ${missingEnv.join(', ')})`); continue }
    if (!JWT) { skip++; line('⏭️ ', `${t.id}`, 'skipped (no Supabase JWT — set SMOKE_SUPABASE_JWT or SMOKE_TEST_EMAIL/PASSWORD)'); continue }

    const tool = TOOLS_BY_ID[t.id]
    try {
      const out = await tool.run({ prompt: t.input.query || t.input.url || t.input.audio_url || t.input.prompt || '', structuredInput: t.input, key: keyVal, proxy, settings: {} })
      if (t.ok(out)) { pass++; line('✅', `${t.id}`, `live OK (${out.type})`) }
      else { fail++; line('❌', `${t.id}`, `unexpected output: ${JSON.stringify(out).slice(0, 160)}`) }
    } catch (e) {
      fail++; line('❌', `${t.id}`, `threw: ${e.message}`)
    }
  }
} finally {
  await server.close()
}

console.log(`\nLIVE: ${pass} passed, ${fail} failed, ${skip} skipped`)
process.exit(fail ? 1 : 0)
