/**
 * Agent Interface — Cloudflare Worker proxy (hardened)
 *
 * Paste this into your `claude-proxy` worker in the Cloudflare dashboard
 * (or `wrangler deploy` from this directory).
 *
 * Required environment variables (Worker → Settings → Variables & Secrets):
 *   SUPABASE_URL              — your project URL (e.g. https://abc.supabase.co)
 *   SUPABASE_ANON_KEY         — used to verify user JWTs (set as Secret)
 *   ALLOWED_ORIGINS           — comma-separated list of allowed app origins
 *                               (e.g. https://app.example.com,https://example.com)
 *
 * Optional:
 *   RATE_LIMIT_KV             — KV namespace binding for per-user rate limits
 *                               (recommended). If absent, rate limiting is skipped.
 *
 * What it does:
 *   - Verifies a Supabase JWT from the Authorization header on every request
 *   - Enforces per-user rate limits (60 req/min, configurable)
 *   - Restricts CORS to allowed origins
 *   - Forwards requests to Anthropic / OpenAI / Google / xAI / DALL-E
 *   - Streams responses back unmodified
 *
 * Client-side: the user's per-provider API key is sent in the existing
 * x-api-key / Authorization header (the client already does this). The
 * worker forwards it; we never store provider keys here.
 */

import { DurableObject } from 'cloudflare:workers'

const PER_MINUTE_LIMIT = 60

// OpenAI image generation — DURABLE across OpenAI's model churn.
//
// OpenAI keeps changing this surface: dall-e-3 was retired ("The model
// 'dall-e-3' does not exist"), gpt-image-1 is current but requires a VERIFIED
// org (403 otherwise), and `response_format` is no longer accepted at all
// ("Unknown parameter"). To keep "a ChatGPT user can make an image" working no
// matter what, the /dalle route tries a LIST of models in order and uses the
// first that succeeds:
//   gpt-image-1  — best/current; works for verified orgs, returns b64
//   dall-e-2     — legacy, needs NO verification, so every OpenAI key can use it
// A caller may pin one via body.model. When OpenAI changes things again, this
// degrades gracefully (a retired/forbidden model just falls through) and the
// only maintenance is editing this list.
//
// We never send `response_format` (rejected). Models that return a hosted URL
// instead of b64 are converted to b64 in the route, since the build pipeline
// (ad_render's in-browser ffmpeg) needs a durable inline data: image.
export function imageModelsToTry(body = {}) {
  if (body.model) return [body.model]
  // gpt-image-1 is the only live OpenAI image model — dall-e-2 and dall-e-3
  // were both retired (verified live 2026-06; dall-e-2 now 400s "does not
  // exist"). App-level generateImageWithFallback covers other providers
  // (Stability/Flux/Ideogram/Recraft) if gpt-image-1 fails.
  return ['gpt-image-1']
}

export function buildImageRequest(model, body = {}) {
  const prompt = body.prompt
  if (model === 'gpt-image-1') {
    const SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])
    const QUALITIES = new Set(['high', 'medium', 'low'])
    return {
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: SIZES.has(body.size) ? body.size : '1024x1024',
      quality: QUALITIES.has(body.quality) ? body.quality : 'high',
    }
  }
  if (model === 'dall-e-2') {
    // dall-e-2: square sizes only (256/512/1024), no quality/style.
    const SIZES = new Set(['256x256', '512x512', '1024x1024'])
    return { model: 'dall-e-2', prompt, n: 1, size: SIZES.has(body.size) ? body.size : '1024x1024' }
  }
  // dall-e-3 (legacy/explicit). Map gpt-image-1-style sizes to dall-e-3's.
  const SIZE_MAP = {
    '1024x1024': '1024x1024',
    '1792x1024': '1792x1024',
    '1024x1792': '1024x1792',
    '1536x1024': '1792x1024',
    '1024x1536': '1024x1792',
  }
  return {
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: SIZE_MAP[body.size] || '1024x1024',
    quality: body.quality === 'high' || body.quality === 'hd' ? 'hd' : 'standard',
  }
}

// ── Server-side builds, PHASE 2: Durable Object build runner ───────────────
// Runs the agentic build loop ON THE SERVER so a closed tab can't kill it. One DO
// instance per build job (keyed by jobId). The client kicks it off and then polls
// the build_jobs row (written here via Supabase REST) for status/deliverables.
//
// SCOPE (2a): only the string-output finals — build_webapp (games/apps/charts),
// write_markdown, htmlgen — which need NO heavy npm libs, so they run in this
// single-file worker with no bundler. The pptxgen/docx/pdf/xlsx + ffmpeg media
// tools stay client-side until a bundling pipeline exists (2b).
//
// SECURITY: the user's Anthropic key is held in MEMORY for the single run only —
// never written to DO storage. Progress is persisted to the build_jobs row (RLS
// owner-scoped) using the user's own JWT, so the DO needs no service-role key.
const SERVER_BUILD_TOOLS = [
  { name: 'build_webapp', description: 'FINAL — emit ONE self-contained .html (game / interactive app / chart / dashboard / tool). Inline ALL html/css/js, write the COMPLETE working code yourself, no external deps, no placeholders. Keep it tight so it fits in one response and ends with </html>.',
    input_schema: { type: 'object', properties: { html: { type: 'string' }, title: { type: 'string' } }, required: ['html'] } },
  { name: 'write_markdown', description: 'FINAL — a markdown post/article. Provide the full markdown text.',
    input_schema: { type: 'object', properties: { markdown: { type: 'string' }, title: { type: 'string' } }, required: ['markdown'] } },
  { name: 'build_deck', description: 'FINAL — a slide deck (.pptx). Write COMPLETE slide content yourself: each slide { title, bullets[], notes }.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } } } }, required: ['slides'] } },
  { name: 'write_document', description: 'FINAL — a Word document (.docx). { title, sections:[{ heading, paragraphs[] }] }, real prose.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } } } } }, required: ['sections'] } },
  { name: 'build_pdf', description: 'FINAL — a PDF (.pdf). { title, sections:[{ heading, paragraphs[] }] }, real prose.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } } } } }, required: ['sections'] } },
  { name: 'build_spreadsheet', description: 'FINAL — a spreadsheet (.xlsx). { sheets:[{ name, rows:[[cell,...]] }] }, row 0 = header, REAL numbers.',
    input_schema: { type: 'object', properties: { sheets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rows: { type: 'array', items: { type: 'array' } } } } } }, required: ['sheets'] } },
]
const SERVER_FINAL = new Set(SERVER_BUILD_TOOLS.map(t => t.name))

// Minimal SSE reader for Anthropic's streaming Messages API (mirrors the client's
// readClaudeStream): reassembles content blocks + tool_use inputs, flags truncation.
async function readAnthropicStream(res) {
  const reader = res.body.getReader(); const dec = new TextDecoder()
  let buf = '', stop_reason = null, error = null; const blocks = []
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      buf += dec.decode(value, { stream: true }); let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const p = line.slice(5).trim(); if (!p || p === '[DONE]') continue
        let ev; try { ev = JSON.parse(p) } catch { continue }
        if (ev.type === 'content_block_start') {
          const cb = ev.content_block || {}
          blocks[ev.index] = cb.type === 'tool_use' ? { type: 'tool_use', id: cb.id, name: cb.name, json: '' } : { type: 'text', text: '' }
        } else if (ev.type === 'content_block_delta') {
          const b = blocks[ev.index]; if (!b) continue
          if (ev.delta?.type === 'text_delta') b.text = (b.text || '') + (ev.delta.text || '')
          else if (ev.delta?.type === 'input_json_delta') b.json = (b.json || '') + (ev.delta.partial_json || '')
        } else if (ev.type === 'message_delta') { if (ev.delta?.stop_reason) stop_reason = ev.delta.stop_reason }
        else if (ev.type === 'error') { error = ev.error?.type || ev.error?.message || 'stream_error' }
      }
    }
  } catch (e) { error = error || e?.message || 'stream_read_failed' }
  const truncated = []
  const content = blocks.filter(Boolean).map(b => {
    if (b.type === 'tool_use') { let input = {}; if (b.json) { try { input = JSON.parse(b.json) } catch { input = {}; truncated.push(b.id) } } return { type: 'tool_use', id: b.id, name: b.name, input } }
    return { type: 'text', text: b.text || '' }
  })
  return { content, stop_reason, error, truncated }
}

export class BuildRunner extends DurableObject {
  // ctx (DurableObjectState) + env are set by the DurableObject base. Kicked off
  // via RPC from the /build/run route. Runs the whole build in this single
  // invocation (waitUntil keeps it alive after the ack returns) so the Anthropic
  // key never has to be persisted. Returns immediately; work continues in bg.
  async start(payload) {
    // Don't await — let it run in the background; the client polls build_jobs.
    this.ctx.waitUntil(this.run(payload).catch(e => this.fail(payload, e?.message || 'build_failed')))
    return { ok: true }
  }

  async sb(method, path, body, jwt) {
    return fetch(`${this.env.SUPABASE_URL}${path}`, {
      method,
      headers: {
        apikey: this.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        ...(method === 'PATCH' ? { Prefer: 'return=minimal' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patchJob(payload, patch) {
    try { await this.sb('PATCH', `/rest/v1/build_jobs?id=eq.${payload.jobId}`, { ...patch, updated_at: new Date().toISOString() }, payload.jwt) } catch {}
  }

  async fail(payload, message) {
    await this.patchJob(payload, { status: 'failed', errors: [{ stepId: '_agent', error: String(message).slice(0, 300) }] })
  }

  async run(payload) {
    const { jobId, request, context, brandContext, model, anthropicKey, jwt, userId } = payload
    const system = `You are the Builder inside Agent Interface — produce a REAL finished file, not a description. ${'' + (context ? `CONVERSATION SO FAR:\n${String(context).slice(0, 3000)}\n\n` : '')}Build exactly what the user asked by calling the matching FINAL tool with the COMPLETE working content. Do not ask questions; do not stop until the file is emitted.${brandContext ? `\n\nBRAND CONTEXT (ground everything in this):\n${String(brandContext).slice(0, 1500)}` : ''}`
    const messages = [{ role: 'user', content: request || 'Build what the user asked for.' }]
    const files = []
    let nudged = false
    for (let turn = 0; turn < 10; turn++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 24000, stream: true, system, messages, tools: SERVER_BUILD_TOOLS }),
      })
      if (!res.ok) { if ([429, 503, 529].includes(res.status) && turn < 7) { await new Promise(r => setTimeout(r, 1500 * (turn + 1))); continue } return this.fail(payload, `claude_${res.status}`) }
      const data = await readAnthropicStream(res)
      if (data.error) { if (turn < 7 && /overload|rate|api_error|stream/i.test(data.error)) { await new Promise(r => setTimeout(r, 1500 * (turn + 1))); continue } return this.fail(payload, data.error) }
      messages.push({ role: 'assistant', content: data.content })
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      if (!toolUses.length) { if (!files.length && !nudged) { nudged = true; messages.push({ role: 'user', content: 'You produced no file. Call the FINAL tool now with the COMPLETE content — only the tool call.' }); continue } break }
      const results = []
      const truncatedIds = new Set(data.truncated || [])
      for (const tu of toolUses) {
        if (truncatedIds.has(tu.id)) { results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `${tu.name} was cut off — regenerate it MORE CONCISELY so it fits in one response.` }); continue }
        const made = await this.emit(payload, tu.name, tu.input || {})
        if (made) files.push(made)
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: made ? 'saved' : 'error: tool produced no file' })
      }
      messages.push({ role: 'user', content: results })
    }
    if (!files.length) return this.fail(payload, 'no_deliverable_produced')
    await this.patchJob(payload, { status: 'done', files })
  }

  // Generate the file bytes (string or Uint8Array) and upload to Storage at
  // <userId>/<jobId>/<file>. Heavy doc libs are dynamic-imported so they only load
  // when a doc build actually runs. Returns null (→ retry) if the content is empty.
  async emit(payload, name, input) {
    if (!SERVER_FINAL.has(name)) return null
    const nm = (base) => (String(input.title || payload.deliverable || base).replace(/[^a-z0-9-_ ]/gi, '').trim() || base)
    let body, filename, type = 'document', contentType
    try {
      if (name === 'build_webapp') {
        const html = String(input.html || ''); if (!/<\/?[a-z]/i.test(html)) return null
        body = html; type = 'webapp'; contentType = 'text/html'; filename = `${nm('app')}.html`
      } else if (name === 'write_markdown') {
        const md = String(input.markdown || ''); if (!md.trim()) return null
        body = md; contentType = 'text/markdown'; filename = `${nm('post')}.md`
      } else if (name === 'build_deck') {
        const slides = Array.isArray(input.slides) ? input.slides : []
        if (!slides.some(s => s && (s.title || (s.bullets || []).length))) return null
        const M = await import('pptxgenjs'); const Pptx = M.default || M
        const p = new Pptx()
        for (const s of slides) {
          const sl = p.addSlide()
          if (s.title) sl.addText(String(s.title), { x: 0.5, y: 0.3, w: 9, fontSize: 28, bold: true })
          const bl = (s.bullets || []).filter(Boolean).map(b => ({ text: String(b), options: { bullet: true, fontSize: 16, breakLine: true } }))
          if (bl.length) sl.addText(bl, { x: 0.5, y: 1.4, w: 9, h: 4 })
          if (s.notes) sl.addNotes(String(s.notes))
        }
        body = new Uint8Array(await p.write({ outputType: 'arraybuffer' }))
        contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; filename = `${nm('deck')}.pptx`
      } else if (name === 'write_document') {
        const sections = Array.isArray(input.sections) ? input.sections : []
        if (!sections.some(s => s && (s.heading || (s.paragraphs || []).length))) return null
        const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')
        const children = []
        if (input.title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(String(input.title))] }))
        for (const sec of sections) {
          if (sec.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(String(sec.heading))] }))
          for (const para of (sec.paragraphs || [])) children.push(new Paragraph({ children: [new TextRun(String(para))] }))
        }
        const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
        body = new Uint8Array(await blob.arrayBuffer())
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; filename = `${nm('document')}.docx`
      } else if (name === 'build_pdf') {
        const sections = Array.isArray(input.sections) ? input.sections : []
        if (!sections.some(s => s && (s.heading || (s.paragraphs || []).length))) return null
        const { jsPDF } = await import('jspdf')
        const doc = new jsPDF({ unit: 'pt', format: 'letter' })
        const margin = 56, pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight()
        let y = margin
        const write = (text, size, bold, gap) => { doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); for (const ln of doc.splitTextToSize(String(text), pw - margin * 2)) { if (y > ph - margin) { doc.addPage(); y = margin } doc.text(ln, margin, y); y += gap } }
        if (input.title) { write(input.title, 22, true, 28); y += 8 }
        for (const sec of sections) { if (sec.heading) write(sec.heading, 14, true, 18); for (const para of (sec.paragraphs || [])) { write(para, 11, false, 14); y += 6 } y += 8 }
        body = new Uint8Array(doc.output('arraybuffer'))
        contentType = 'application/pdf'; filename = `${nm('document')}.pdf`
      } else if (name === 'build_spreadsheet') {
        const sheets = Array.isArray(input.sheets) ? input.sheets : (Array.isArray(input.rows) ? [{ name: 'Sheet1', rows: input.rows }] : [])
        if (!sheets.some(s => Array.isArray(s.rows) && s.rows.some(r => Array.isArray(r) && r.some(c => c !== '' && c != null)))) return null
        const X = await import('xlsx'); const XLSX = X.default || X
        const wb = XLSX.utils.book_new()
        sheets.forEach((s, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows || []), String(s.name || `Sheet${i + 1}`).slice(0, 31)))
        body = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; filename = `${nm('spreadsheet')}.xlsx`
      } else return null
    } catch (e) { console.log('[BuildRunner] emit failed', name, e?.message); return null }
    const path = `${payload.userId}/${payload.jobId}/${filename.replace(/[^a-z0-9._-]/gi, '_')}`
    const up = await fetch(`${this.env.SUPABASE_URL}/storage/v1/object/build-deliverables/${path}`, {
      method: 'POST',
      headers: { apikey: this.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${payload.jwt}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body,
    })
    if (!up.ok) return null
    return { label: filename, type, filename, storagePath: path, savedLink: null, component: false }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    const cors = corsHeaders(origin, env)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const path = url.pathname.replace(/^\/+/, '')

    // Self-hosted ffmpeg.wasm core (GET, no auth). The browser-side ad_render
    // composer loads this; fetching it from a public CDN directly was flaky and
    // broke every video ("failed to import ffmpeg-core.js"), and the 30 MiB wasm
    // is too big to host on Cloudflare Pages (>25 MiB limit). So we serve it from
    // here: fetched from jsDelivr SERVER-SIDE (reliable) and edge-cached, returned
    // from a stable first-party endpoint with long browser cache + CORS.
    // ESM core (dist/esm), NOT umd — @ffmpeg/ffmpeg 0.12's module worker loads the
    // core via import().default, which only the ESM build provides. Serving umd
    // caused "failed to import ffmpeg-core.js" on every render.
    const FFMPEG_CORE = {
      'ffmpeg-core.js': ['https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js', 'text/javascript'],
      'ffmpeg-core.wasm': ['https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm', 'application/wasm'],
    }
    if (request.method === 'GET' && FFMPEG_CORE[path]) {
      const [src, mime] = FFMPEG_CORE[path]
      const up = await fetch(src, { cf: { cacheEverything: true, cacheTtl: 604800 } })
      if (!up.ok) return json({ error: 'ffmpeg_core_unavailable', status: up.status }, 502, cors)
      return new Response(up.body, {
        status: 200,
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=604800, immutable', ...cors },
      })
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors)
    }

    // Token-refresh routes are authorized by the caller's own refresh_token plus
    // the server-held client_secret, and the client calls them WITHOUT a Supabase
    // session (see driveStorage.refreshDriveAccessToken — a raw fetch with no
    // x-supabase-auth). They skip the JWT gate; everything else requires a
    // signed-in user. A garbage/absent token still gets nothing useful from
    // Google, so this exposes no new capability.
    const AUTH_EXEMPT = new Set(['refresh_google'])

    if (!AUTH_EXEMPT.has(path)) {
      // 1. Verify Supabase JWT
      const auth = request.headers.get('x-supabase-auth') || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!token) return json({ error: 'missing_auth' }, 401, cors)

      const user = await verifySupabaseToken(token, env)
      if (!user) return json({ error: 'invalid_auth' }, 401, cors)

      // 2. Rate limit
      if (env.RATE_LIMIT_KV) {
        const allowed = await checkRateLimit(env.RATE_LIMIT_KV, user.sub)
        if (!allowed) return json({ error: 'rate_limited' }, 429, cors)
      }
    } else if (env.RATE_LIMIT_KV) {
      // Auth-exempt routes (refresh_google) still get a per-IP rate limit so the
      // server-held Google client_secret can't be used as an unauthenticated
      // token-exchange/validation oracle at scale.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      const allowed = await checkRateLimit(env.RATE_LIMIT_KV, `ip:${ip}`)
      if (!allowed) return json({ error: 'rate_limited' }, 429, cors)
    }

    // 3. Route
    const route = ROUTES[path]
    if (!route) return json({ error: 'unknown_route' }, 404, cors)

    try {
      const upstream = await route(request, env)
      const headers = new Headers(upstream.headers)
      Object.entries(cors).forEach(([k, v]) => headers.set(k, v))
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (e) {
      return json({ error: 'upstream_error', message: e.message }, 502, cors)
    }
  },
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  // Fail CLOSED: an empty/unset ALLOWED_ORIGINS previously allowed EVERY origin
  // (allowed.length === 0 || …). If the env var ever goes missing in a deploy,
  // deny rather than turn the proxy into an any-origin relay. wrangler.toml sets
  // it, so this only bites on misconfiguration — which is exactly when we want it.
  const ok = allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization, x-supabase-auth, x-stability-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

// Base64-encode an ArrayBuffer in chunks. Spreading a large Uint8Array into
// String.fromCharCode(...) overflows the argument limit for multi-second audio.
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Get the audio bytes for a transcription route from either path: a multipart
// upload (the file-attachment feature) or a JSON { audio_url } (build-plan use,
// where the worker fetches the URL). Returns a Blob or null.
async function getAudioBlob(req) {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData()
    const f = form.get('file')
    return f && typeof f !== 'string' ? f : null
  }
  const body = await req.json().catch(() => ({}))
  if (!body.audio_url) return null
  if (!isSafeUrl(body.audio_url)) return null
  const r = await fetch(body.audio_url)
  if (!r.ok) return null
  return new Blob([await r.arrayBuffer()], { type: r.headers.get('Content-Type') || 'audio/mpeg' })
}

async function verifySupabaseToken(token, env) {
  // Calls Supabase /auth/v1/user with the token. If it returns 200, the JWT is valid.
  // (Cheap; can be replaced with local JWT verification using the project JWT secret.)
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function checkRateLimit(kv, userId) {
  const now = Math.floor(Date.now() / 1000)
  const window = Math.floor(now / 60)
  const key = `rl:${userId}:${window}`
  const current = parseInt((await kv.get(key)) || '0', 10)
  if (current >= PER_MINUTE_LIMIT) return false
  await kv.put(key, String(current + 1), { expirationTtl: 120 })
  return true
}

// SSRF guard for user-supplied URLs the worker fetches server-side. Hostname-
// based (Workers can't resolve DNS), so it blocks the DIRECT cases — loopback,
// private/link-local/metadata IPs, non-http(s) schemes, internal TLDs. Not a
// defense against DNS rebinding, but it closes the easy holes that let a
// signed-in user point the proxy at internal endpoints.
function isSafeUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = +v4[1], b = +v4[2]
    if (a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a >= 224) return false
  }
  if (h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return false
  return true
}

const ROUTES = {
  // Server-side build kickoff. The JWT is already verified by the fetch gate; we
  // decode its sub for the storage path, hand the job to a per-jobId Durable
  // Object, and return immediately (the DO runs the build + writes build_jobs).
  'build/run': async (req, env) => {
    if (!env.BUILD_RUNNER) return new Response(JSON.stringify({ error: 'server_builds_unavailable' }), { status: 501 })
    const jwt = (req.headers.get('x-supabase-auth') || '').replace(/^Bearer /, '')
    const anthropicKey = req.headers.get('x-api-key') || ''
    if (!jwt || !anthropicKey) return new Response(JSON.stringify({ error: 'missing_auth_or_key' }), { status: 400 })
    let userId = null
    try { userId = JSON.parse(atob(jwt.split('.')[1])).sub } catch {}
    if (!userId) return new Response(JSON.stringify({ error: 'invalid_auth' }), { status: 401 })
    const b = await req.json().catch(() => ({}))
    if (!b.jobId) return new Response(JSON.stringify({ error: 'missing_jobId' }), { status: 400 })
    const stub = env.BUILD_RUNNER.getByName(b.jobId)
    const ack = await stub.start({
      jobId: b.jobId, request: b.request || '', context: b.context || '', brandContext: b.brandContext || '',
      model: b.model || 'claude-sonnet-4-6', deliverable: b.deliverable || 'Build', anthropicKey, jwt, userId,
    })
    return new Response(JSON.stringify(ack), { status: 200, headers: { 'Content-Type': 'application/json' } })
  },

  claude: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-6',
        max_tokens: body.max_tokens || 1024,
        messages: body.messages,
        // Pass through native tool-use fields when present (the agentic builder
        // drives a real tool-call loop instead of a static plan script).
        ...(body.system ? { system: body.system } : {}),
        ...(body.tools ? { tools: body.tools } : {}),
        ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
        // Stream long generations (e.g. a full game via build_webapp). Without
        // this, Cloudflare times out (524) waiting on a 60-120s non-streamed
        // response — the worker forwards upstream.body, so the SSE streams through.
        ...(body.stream ? { stream: true } : {}),
      }),
    })
  },

  gpt: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        model: body.model || 'gpt-4o',
        messages: body.messages,
        stream: true,
      }),
    })
  },

  gemini: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const model = body.model || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: body.contents }),
    })
  },

  grok: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    return fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        model: body.model || 'grok-4.3',   // x.ai retired grok-3/grok-2 (2026-05-15); match src/config/models.js
        messages: body.messages,
        stream: true,
      }),
    })
  },

  dalle: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    let last = null
    for (const model of imageModelsToTry(body)) {
      const oai = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(buildImageRequest(model, body)),
      })
      if (oai.ok) {
        const data = await oai.json()
        // Convert a hosted (expiring) URL to b64 so the build pipeline gets a
        // durable inline data: image (ad_render's ffmpeg can't fetch URLs).
        const item = data?.data?.[0]
        if (item && !item.b64_json && item.url) {
          try { const img = await fetch(item.url); if (img.ok) item.b64_json = bufToBase64(await img.arrayBuffer()) } catch { /* keep url */ }
        }
        return json(data, 200)
      }
      last = { status: oai.status, body: await oai.text().catch(() => '') }
      // Model-availability / verification errors (400/403/404) → try the next
      // model. Anything else (401 bad key, 429 quota, 5xx) → stop and report.
      if (![400, 403, 404].includes(oai.status)) break
    }
    return new Response(last?.body || JSON.stringify({ error: 'image_generation_failed' }),
      { status: last?.status || 502, headers: { 'Content-Type': 'application/json' } })
  },

  stability: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const form = new FormData()
    form.append('prompt', body.prompt)
    form.append('output_format', 'png')
    const r = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json' },
      body: form,
    })
    if (!r.ok) {
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    }
    return r
  },

  ideogram: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    return fetch('https://api.ideogram.ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': apiKey },
      body: JSON.stringify({ image_request: { prompt: body.prompt, aspect_ratio: 'ASPECT_1_1', model: 'V_2' } }),
    })
  },

  elevenlabs: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const voiceId = body.voice_id || '21m00Tcm4TlvDq8ikWAM'
    // HIGH-QUALITY narration model, not the low-latency Turbo one (Turbo sounds
    // flat/robotic — it's built for realtime, not voiceovers). eleven_multilingual_v2
    // is ElevenLabs' most natural non-realtime model. Tuned voice_settings give
    // expressive-but-stable narration. Client may override model_id/voice_settings.
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: body.text,
        model_id: body.model_id || 'eleven_multilingual_v2',
        voice_settings: body.voice_settings || { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    })
    if (!r.ok) {
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    }
    const buf = await r.arrayBuffer()
    return new Response(JSON.stringify({ audio: bufToBase64(buf) }), { headers: { 'Content-Type': 'application/json' } })
  },

  // OpenAI TTS — text-to-speech fallback for when ElevenLabs is blocked.
  // Mirrors the elevenlabs route: returns { audio: <base64 mp3> }.
  openai_tts: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        model: body.model === 'tts-1-hd' ? 'tts-1-hd' : 'tts-1',
        input: String(body.text || '').slice(0, 4000),
        voice: VOICES.has(body.voice) ? body.voice : 'nova',
        response_format: 'mp3',
      }),
    })
    if (!r.ok) {
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    }
    const buf = await r.arrayBuffer()
    return new Response(JSON.stringify({ audio: bufToBase64(buf) }), { headers: { 'Content-Type': 'application/json' } })
  },

  runway: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    // Start the generation. promptImage makes it real image-to-video.
    // Caller picks duration (5|10) and ratio. Runway's current ratio enum is
    // 1280:768 (landscape) / 768:1280 (portrait) / 16:9 / 9:16 — the old
    // 1280:720 and 960:960 were retired and now 400 (verified live 2026-06).
    const payload = {
      promptText: body.prompt,
      model: 'gen3a_turbo',
      duration: body.duration === 10 ? 10 : 5,
      ratio: ['1280:768', '768:1280', '16:9', '9:16'].includes(body.ratio) ? body.ratio : '1280:768',
    }
    if (body.image_url) payload.promptImage = body.image_url
    const start = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth, 'X-Runway-Version': '2024-11-06' },
      body: JSON.stringify(payload),
    })
    if (!start.ok) return start
    const job = await start.json()
    // Poll for completion (max 90s)
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const status = await fetch(`https://api.dev.runwayml.com/v1/tasks/${job.id}`, {
        headers: { Authorization: auth, 'X-Runway-Version': '2024-11-06' },
      })
      const data = await status.json()
      if (data.status === 'SUCCEEDED') {
        return new Response(JSON.stringify({ url: data.output?.[0], duration: 5 }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (data.status === 'FAILED') {
        return new Response(JSON.stringify({ error: data.failure || 'runway_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  twilio: async (req) => {
    // Twilio uses Basic auth with sid:token. The client sends them as
    // a single concatenated string via x-twilio-creds because the tool
    // stores both in one setting slot.
    const creds = req.headers.get('x-twilio-creds')
    if (!creds || !creds.includes(':')) return new Response(JSON.stringify({ error: 'bad_creds' }), { status: 400 })
    const [sid] = creds.split(':')
    const body = await req.json()
    if (!body.to || !body.from || !body.body) {
      return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    }
    const form = new URLSearchParams()
    form.set('To', body.to)
    form.set('From', body.from)
    form.set('Body', body.body.slice(0, 1600))
    return fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(creds)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
  },

  // remove.bg accepts an image URL directly and returns a PNG with the
  // background stripped. Forward the binary response straight through.
  removebg: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.image_url) return new Response(JSON.stringify({ error: 'missing_image_url' }), { status: 400 })
    const form = new URLSearchParams()
    form.set('image_url', body.image_url)
    form.set('size', body.size || 'auto')
    return fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
  },

  // Clipdrop has no URL input — it wants the image as multipart image_file —
  // so fetch the source first, then upload. Defaults to background removal
  // (its other ops need an explicit operation + per-op params; add later via
  // a body.op switch). NOTE: Clipdrop is migrating under Jasper; this endpoint
  // may change or be retired.
  clipdrop: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.source_url) return new Response(JSON.stringify({ error: 'missing_source_url' }), { status: 400 })
    if (!isSafeUrl(body.source_url)) return new Response(JSON.stringify({ error: 'blocked_url' }), { status: 400 })
    const img = await fetch(body.source_url)
    if (!img.ok) return new Response(JSON.stringify({ error: 'source_fetch_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    const imgBuf = await img.arrayBuffer()
    const form = new FormData()
    form.append('image_file', new Blob([imgBuf], { type: img.headers.get('Content-Type') || 'image/png' }), 'image.png')
    return fetch('https://clipdrop-api.co/remove-background/v1', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
    })
  },

  // Mastodon: post a status to the caller's instance. The instance base URL
  // comes in the body (it's per-user); the bearer token is in Authorization.
  mastodon: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.instance || !body.status) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    let base
    try { base = new URL(body.instance).origin } catch { return new Response(JSON.stringify({ error: 'bad_instance' }), { status: 400 }) }
    if (!isSafeUrl(base)) return new Response(JSON.stringify({ error: 'blocked_instance' }), { status: 400 })
    return fetch(`${base}/api/v1/statuses`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: String(body.status).slice(0, 500) }),
    })
  },

  suno: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    // Using sunoapi.org-compatible endpoint (Suno's own API is not public)
    const start = await fetch('https://api.sunoapi.org/api/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ prompt: body.prompt, make_instrumental: false, wait_audio: false }),
    })
    if (!start.ok) return start
    const job = await start.json()
    const id = job?.data?.[0]?.id || job.id
    if (!id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    // Poll
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 4000))
      const status = await fetch(`https://api.sunoapi.org/api/v1/feed/${id}`, {
        headers: { Authorization: auth },
      })
      const data = await status.json()
      const track = Array.isArray(data) ? data[0] : data?.data?.[0]
      if (track?.audio_url) {
        // duration may be float seconds, sometimes ms — normalize to seconds
        const rawDuration = track.duration ?? track.duration_seconds ?? null
        const duration = typeof rawDuration === 'number'
          ? (rawDuration > 600 ? Math.round(rawDuration / 1000) : Math.round(rawDuration))
          : null
        return new Response(JSON.stringify({
          url: track.audio_url,
          title: track.title,
          duration,
          tags: track.tags || null,
          lyrics: track.lyric || track.lyrics || null,
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      if (track?.status === 'error') {
        return new Response(JSON.stringify({ error: 'suno_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Stable Audio 2.0 — official Stability music API. multipart/form-data in,
  // raw audio bytes out; we base64-wrap them like the elevenlabs route.
  stable_audio: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const duration = Math.max(1, Math.min(190, Number(body.duration) || 30))
    const form = new FormData()
    form.append('prompt', String(body.prompt || '').slice(0, 1000))
    form.append('output_format', 'mp3')
    form.append('duration', String(duration))
    const r = await fetch('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'audio/*' },
      body: form,
    })
    if (!r.ok) {
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    }
    const buf = await r.arrayBuffer()
    return new Response(JSON.stringify({ audio: bufToBase64(buf) }), { headers: { 'Content-Type': 'application/json' } })
  },

  // ElevenLabs Music — official music API (can include vocals). JSON in, raw
  // audio bytes out; base64-wrapped like the other audio routes.
  elevenlabs_music: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const lengthMs = Math.max(3000, Math.min(60000, Number(body.music_length_ms) || 15000))
    // output_format is a query param (default varies); pin it to mp3 so the
    // tool's data:audio/mpeg wrapper is always correct. Verified against
    // elevenlabs.io/docs/api-reference/music/compose (POST /v1/music, xi-api-key,
    // { prompt, music_length_ms }, returns audio bytes).
    const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({ prompt: String(body.prompt || '').slice(0, 1000), music_length_ms: lengthMs }),
    })
    if (!r.ok) {
      const text = await r.text()
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    }
    const buf = await r.arrayBuffer()
    return new Response(JSON.stringify({ audio: bufToBase64(buf) }), { headers: { 'Content-Type': 'application/json' } })
  },

  // Luma Dream Machine (Ray 2) — text-to-video. Async: create returns an id,
  // poll until completed. Verified: POST api.lumalabs.ai/dream-machine/v1/
  // generations, Bearer, { prompt, model, resolution, duration } -> { id };
  // GET .../generations/{id} -> { state, assets:{ video } }.
  luma: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const start = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth, accept: 'application/json' },
      body: JSON.stringify({
        prompt: String(body.prompt || '').slice(0, 1000),
        model: 'ray-2',
        resolution: ['540p', '720p', '1080p'].includes(body.resolution) ? body.resolution : '720p',
        duration: body.duration === 10 ? '10s' : '5s',
      }),
    })
    if (!start.ok) return start
    const job = await start.json()
    if (!job.id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const s = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${job.id}`, { headers: { Authorization: auth, accept: 'application/json' } })
      const d = await s.json()
      if (d.state === 'completed' && d.assets?.video) return new Response(JSON.stringify({ url: d.assets.video }), { headers: { 'Content-Type': 'application/json' } })
      if (d.state === 'failed') return new Response(JSON.stringify({ error: d.failure_reason || 'luma_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Meshy — text-to-3D. Async preview task. Verified: POST api.meshy.ai/openapi/
  // v2/text-to-3d, Bearer, { mode:'preview', prompt } -> { result: <id> };
  // GET .../text-to-3d/{id} -> { status, model_urls:{ glb }, thumbnail_url }.
  meshy: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const start = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ mode: 'preview', prompt: String(body.prompt || '').slice(0, 600), art_style: body.art_style || 'realistic' }),
    })
    if (!start.ok) return start
    const job = await start.json()
    const id = job.result || job.id
    if (!id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const s = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${id}`, { headers: { Authorization: auth } })
      const d = await s.json()
      if (d.status === 'SUCCEEDED' && d.model_urls?.glb) return new Response(JSON.stringify({ url: d.model_urls.glb, thumbnail: d.thumbnail_url || null }), { headers: { 'Content-Type': 'application/json' } })
      if (d.status === 'FAILED') return new Response(JSON.stringify({ error: 'meshy_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Topaz — image upscale/enhance. Async + multipart: fetch the source image,
  // POST it, poll status, then download. Verified: POST api.topazlabs.com/image/
  // v1/enhance/async (X-API-Key, multipart image+model) -> { process_id };
  // GET /image/v1/status/{id} -> { status }; GET /image/v1/download/{id} -> { url }.
  topaz: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.image_url) return new Response(JSON.stringify({ error: 'missing_image_url' }), { status: 400 })
    if (!isSafeUrl(body.image_url)) return new Response(JSON.stringify({ error: 'blocked_url' }), { status: 400 })
    const img = await fetch(body.image_url)
    if (!img.ok) return new Response(JSON.stringify({ error: 'source_fetch_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    const form = new FormData()
    form.append('image', new Blob([await img.arrayBuffer()], { type: img.headers.get('Content-Type') || 'image/png' }), 'image.png')
    form.append('model', body.model || 'Standard V2')
    form.append('output_format', 'jpeg')
    if (body.output_height) form.append('output_height', String(body.output_height))
    const start = await fetch('https://api.topazlabs.com/image/v1/enhance/async', { method: 'POST', headers: { 'X-API-Key': apiKey }, body: form })
    if (!start.ok) return start
    const job = await start.json()
    if (!job.process_id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const s = await fetch(`https://api.topazlabs.com/image/v1/status/${job.process_id}`, { headers: { 'X-API-Key': apiKey } })
      const d = await s.json()
      if (d.status === 'Completed') {
        const dl = await fetch(`https://api.topazlabs.com/image/v1/download/${job.process_id}`, { headers: { 'X-API-Key': apiKey } })
        const dd = await dl.json()
        if (dd.url) return new Response(JSON.stringify({ url: dd.url }), { headers: { 'Content-Type': 'application/json' } })
        return new Response(JSON.stringify({ error: 'no_url' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
      if (d.status === 'Failed' || d.status === 'Cancelled') return new Response(JSON.stringify({ error: 'topaz_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Pika 2.2 text-to-video, hosted on fal.ai (no direct Pika API). Sync call.
  // Verified: POST fal.run/fal-ai/pika/v2.2/text-to-video, Authorization: Key
  // <falkey>, { prompt, duration, aspect_ratio, resolution } -> { video:{ url } }.
  pika: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const r = await fetch('https://fal.run/fal-ai/pika/v2.2/text-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        prompt: String(body.prompt || '').slice(0, 1000),
        duration: body.duration === 10 ? 10 : 5,
        aspect_ratio: ['16:9', '9:16', '1:1', '4:5', '5:4', '3:2', '2:3'].includes(body.aspect_ratio) ? body.aspect_ratio : '16:9',
        resolution: body.resolution === '1080p' ? '1080p' : '720p',
      }),
    })
    if (!r.ok) { const t = await r.text(); return new Response(t, { status: r.status, headers: { 'Content-Type': 'application/json' } }) }
    const d = await r.json()
    if (!d.video?.url) return new Response(JSON.stringify({ error: 'no_url' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ url: d.video.url }), { headers: { 'Content-Type': 'application/json' } })
  },

  // HeyGen — talking-avatar video from a script. Async. Needs caller-supplied
  // avatar_id + voice_id. Verified: POST api.heygen.com/v2/video/generate
  // (X-Api-Key) -> { data:{ video_id } }; GET v1/video_status.get?video_id=
  // -> { data:{ status, video_url } }.
  heygen: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.avatar_id || !body.voice_id) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    const start = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        video_inputs: [{
          character: { type: 'avatar', avatar_id: body.avatar_id, avatar_style: 'normal' },
          voice: { type: 'text', input_text: String(body.input_text || '').slice(0, 1500), voice_id: body.voice_id },
        }],
        dimension: { width: 1280, height: 720 },
      }),
    })
    if (!start.ok) return start
    const job = await start.json()
    const vid = job.data?.video_id
    if (!vid) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const s = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${vid}`, { headers: { 'X-Api-Key': apiKey } })
      const d = await s.json()
      const st = d.data?.status
      if (st === 'completed' && d.data?.video_url) return new Response(JSON.stringify({ url: d.data.video_url }), { headers: { 'Content-Type': 'application/json' } })
      if (st === 'failed') return new Response(JSON.stringify({ error: d.data?.error || 'heygen_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Shotstack — render a JSON timeline into a finished MP4 (the stitcher).
  // Async: submit then poll. Verified: POST api.shotstack.io/edit/v1/render
  // (x-api-key, { timeline, output }) -> { response:{ id } }; GET .../render/{id}
  // -> { response:{ status, url } }.
  shotstack: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const start = await fetch('https://api.shotstack.io/edit/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ timeline: body.timeline, output: body.output }),
    })
    if (!start.ok) { const t = await start.text(); return new Response(t, { status: start.status, headers: { 'Content-Type': 'application/json' } }) }
    const job = await start.json()
    const id = job.response?.id
    if (!id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 4000))
      const s = await fetch(`https://api.shotstack.io/edit/v1/render/${id}`, { headers: { 'x-api-key': apiKey } })
      const d = await s.json()
      const st = d.response?.status
      if (st === 'done' && d.response?.url) return new Response(JSON.stringify({ url: d.response.url }), { headers: { 'Content-Type': 'application/json' } })
      if (st === 'failed') return new Response(JSON.stringify({ error: d.response?.error || 'shotstack_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Whisper — OpenAI speech-to-text. Uses the OpenAI key. Routed through the
  // worker because api.openai.com sends no browser CORS (the old browser-direct
  // call in fileIngestion silently failed). Accepts a multipart file upload or
  // a JSON { audio_url }. Verified: POST api.openai.com/v1/audio/transcriptions,
  // Bearer, multipart { file, model } -> { text }.
  whisper: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const blob = await getAudioBlob(req)
    if (!blob) return new Response(JSON.stringify({ error: 'no_audio' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const form = new FormData()
    form.append('file', blob, 'audio.mp3')
    form.append('model', 'whisper-1')
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: auth }, body: form })
    if (!r.ok) { const t = await r.text(); return new Response(t, { status: r.status, headers: { 'Content-Type': 'application/json' } }) }
    const d = await r.json()
    return new Response(JSON.stringify({ text: d.text || '' }), { headers: { 'Content-Type': 'application/json' } })
  },

  // AssemblyAI — speech-to-text with speaker labels. Three-step: upload bytes,
  // create transcript, poll. Auth header is the raw key (no "Bearer"). Verified:
  // POST /v2/upload (octet-stream) -> { upload_url }; POST /v2/transcript
  // { audio_url, speaker_labels } -> { id }; GET /v2/transcript/{id} ->
  // { status, text, utterances }.
  assemblyai: async (req) => {
    const key = req.headers.get('Authorization')
    if (!key) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const blob = await getAudioBlob(req)
    if (!blob) return new Response(JSON.stringify({ error: 'no_audio' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const up = await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/octet-stream' }, body: await blob.arrayBuffer() })
    if (!up.ok) { const t = await up.text(); return new Response(t, { status: up.status, headers: { 'Content-Type': 'application/json' } }) }
    const { upload_url } = await up.json()
    if (!upload_url) return new Response(JSON.stringify({ error: 'upload_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    const cr = await fetch('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_url: upload_url, speaker_labels: true }) })
    if (!cr.ok) { const t = await cr.text(); return new Response(t, { status: cr.status, headers: { 'Content-Type': 'application/json' } }) }
    const job = await cr.json()
    if (!job.id) return new Response(JSON.stringify({ error: 'no_job_id' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const s = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, { headers: { Authorization: key } })
      const d = await s.json()
      if (d.status === 'completed') return new Response(JSON.stringify({ text: d.text || '', speakers: (d.utterances || []).map(u => ({ speaker: u.speaker, text: u.text })) }), { headers: { 'Content-Type': 'application/json' } })
      if (d.status === 'error') return new Response(JSON.stringify({ error: d.error || 'assemblyai_failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } })
  },

  // Exa — semantic web search for agents. Verified: POST api.exa.ai/search,
  // x-api-key, { query, numResults, contents:{text} } → { results:[{title,url,text}] }.
  exa: async (req) => {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    return fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query: String(body.query || '').slice(0, 1000),
        numResults: Math.max(1, Math.min(25, Number(body.numResults) || 5)),
        contents: { text: true },
      }),
    })
  },

  // Firecrawl — turn a URL into clean markdown. Verified: POST
  // api.firecrawl.dev/v2/scrape (v2, not v1), Bearer, { url, formats } →
  // { success, data:{ markdown, metadata } }.
  firecrawl: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.url) return new Response(JSON.stringify({ error: 'missing_url' }), { status: 400 })
    return fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ url: body.url, formats: ['markdown'] }),
    })
  },

  // Google OAuth token refresh — exchanges a stored refresh_token for a fresh
  // access_token so Drive saves don't fail when the hourly token expires. The
  // client_secret lives here (env), never in the browser. Auth-exempt (see the
  // AUTH_EXEMPT set above); the refresh_token is the credential. Forwards
  // Google's native { access_token, expires_in, ... } response straight through.
  refresh_google: async (req, env) => {
    const body = await req.json().catch(() => ({}))
    if (!body.refresh_token) {
      return new Response(JSON.stringify({ error: 'missing_refresh_token' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const form = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: body.refresh_token,
      grant_type: 'refresh_token',
    })
    return fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
  },

  // ── Reddit (OAuth2 PKCE, installed app — no client secret) ────────
  // These three exist because Reddit's endpoints don't allow browser CORS.
  // The worker only forwards; client_id is public and arrives in the body.
  reddit_token: async (req) => {
    const body = await req.json()
    if (!body.client_id || !body.code || !body.code_verifier || !body.redirect_uri) {
      return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    }
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: body.code,
      redirect_uri: body.redirect_uri,
      code_verifier: body.code_verifier,
    })
    return fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(body.client_id + ':')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'agent-interface/1.0',
      },
      body: form.toString(),
    })
  },

  reddit_refresh: async (req) => {
    const body = await req.json()
    if (!body.client_id || !body.refresh_token) {
      return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    }
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: body.refresh_token })
    return fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(body.client_id + ':')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'agent-interface/1.0',
      },
      body: form.toString(),
    })
  },

  reddit_submit: async (req) => {
    const auth = req.headers.get('Authorization') // Bearer <reddit access token>
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    if (!body.sr || !body.title) return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
    const form = new URLSearchParams({
      sr: body.sr,
      title: String(body.title).slice(0, 300),
      api_type: 'json',
      kind: body.url ? 'link' : 'self',
    })
    if (body.url) form.set('url', body.url)
    else form.set('text', String(body.text || '').slice(0, 40000))
    return fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'agent-interface/1.0',
      },
      body: form.toString(),
    })
  },
}
