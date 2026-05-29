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

    // 3. Route
    const path = url.pathname.replace(/^\/+/, '')
    const route = ROUTES[path]
    if (!route) return json({ error: 'unknown_route' }, 404, cors)

    try {
      const upstream = await route(request)
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
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    return new Response(JSON.stringify({ audio: b64 }), { headers: { 'Content-Type': 'application/json' } })
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
}
