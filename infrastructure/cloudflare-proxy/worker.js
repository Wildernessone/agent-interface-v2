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

const PER_MINUTE_LIMIT = 60

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''

    const cors = corsHeaders(origin, env)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors)
    }

    const path = url.pathname.replace(/^\/+/, '')

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
  const ok = allowed.length === 0 || allowed.includes(origin)
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

const ROUTES = {
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
        model: body.model || 'grok-3',
        messages: body.messages,
        stream: true,
      }),
    })
  },

  dalle: async (req) => {
    const auth = req.headers.get('Authorization')
    if (!auth) return new Response(JSON.stringify({ error: 'missing_provider_key' }), { status: 400 })
    const body = await req.json()
    const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])
    const ALLOWED_QUALITIES = new Set(['high', 'medium', 'low'])
    return fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: body.prompt,
        n: 1,
        size: ALLOWED_SIZES.has(body.size) ? body.size : '1024x1024',
        quality: ALLOWED_QUALITIES.has(body.quality) ? body.quality : 'high',
      }),
    })
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
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: body.text, model_id: 'eleven_turbo_v2_5' }),
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
    // Start the generation. promptImage makes it real image-to-video;
    // omitting it keeps text-only behavior. Caller picks duration (5|10)
    // and ratio (1280:720 widescreen, 768:1280 portrait, 960:960 square).
    const payload = {
      promptText: body.prompt,
      model: 'gen3a_turbo',
      duration: body.duration === 10 ? 10 : 5,
      ratio: ['1280:720', '768:1280', '960:960'].includes(body.ratio) ? body.ratio : '1280:720',
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
