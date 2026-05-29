/**
 * TOOL REGISTRY
 * =============
 * Single source of truth for every tool the studio can call. Every tool
 * exports the same shape, so:
 *   - Settings UI iterates and renders (no per-tool special cases)
 *   - runTool() does one registry lookup + .run()
 *   - OpenClaw's dispatcher prompt auto-builds the capability list
 *   - Adding a new provider is ONE new entry in this file
 *
 * Tool shape:
 *   {
 *     id:         'flux',                    // referenced by OpenClaw plan
 *     name:       'Flux',                    // shown in UI
 *     category:   'image',                   // 'image'|'image_edit'|'video'|'audio_tts'|'audio_music'|'search'|'action'
 *     capability: 'photorealistic images',   // injected into system prompts
 *     desc:       'Black Forest Labs',       // UI subtitle
 *     keySource:  'tool_keys.flux',          // where the user's key lives
 *     keyPrefix:  'fal-',                    // optional, for help text
 *     docsUrl:    'https://fal.ai',          // "where to get a key" link
 *     setupHint:  null,                      // optional inline help
 *     status:     'live',                    // 'live'|'beta'|'needs_proxy_route'|'coming_soon'
 *     run:        async ({prompt, key, settings, proxy}) => output
 *   }
 *
 * Output envelope (all runners return one of):
 *   {type:'image', url, prompt, tool}
 *   {type:'audio', url, title?, prompt, tool}
 *   {type:'video', url, prompt, tool, duration?}
 *   {type:'search', text, citations?, tool}
 *   {type:'action', summary, link?, tool}
 *
 * Errors: throw a ToolError(toolId, errorType, message). The caller
 * surfaces it via addToolErrorTurn.
 */

export class ToolError extends Error {
  constructor(toolId, errorType, message) {
    super(message || `${toolId} failed`)
    this.toolId = toolId
    this.errorType = errorType
  }
}

// ── Key lookup helper ─────────────────────────────────────────────
// Every tool key lives in settings.toolKeys.<id> (backed by the
// tool_keys jsonb column). DALL-E is the exception — it reuses the
// user's GPT key from settings.agents.gpt.key. That's it. One path
// per source, no fallbacks, no legacy.
export function readKey(settings, keySource) {
  if (!keySource) return null
  if (keySource.startsWith('tool_keys.')) {
    const k = keySource.split('.')[1]
    return settings?.toolKeys?.[k] || null
  }
  if (keySource.startsWith('agent.')) {
    const k = keySource.split('.')[1]
    return settings?.agents?.[k]?.key || null
  }
  return null
}

// ── Image generation ──────────────────────────────────────────────

const dalle = {
  id: 'dalle',
  name: 'DALL-E 3',
  category: 'image',
  capability: 'generate images from text prompts',
  desc: 'OpenAI image generation (uses your OpenAI key)',
  keySource: 'agent.gpt',
  docsUrl: 'https://platform.openai.com/api-keys',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('dalle', 'missing_key', 'DALL-E uses your OpenAI key — add it in Settings → Agents → ChatGPT.')
    const res = await proxy('dalle', { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('dalle', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (data.error) throw new ToolError('dalle', 'bad_response', data.error?.message || 'DALL-E error')
    const b64 = data.data?.[0]?.b64_json
    const url = data.data?.[0]?.url
    if (b64) return { type: 'image', url: `data:image/png;base64,${b64}`, prompt, tool: 'dalle' }
    if (url) return { type: 'image', url, prompt, tool: 'dalle' }
    throw new ToolError('dalle', 'bad_response', 'DALL-E returned no image.')
  },
}

const stability = {
  id: 'stability',
  name: 'Stable Diffusion 3',
  category: 'image',
  capability: 'generate images, open-source flexibility',
  desc: 'Stability AI — versatile, strong on artistic styles',
  keySource: 'tool_keys.stability',
  keyPrefix: 'sk-',
  docsUrl: 'https://platform.stability.ai/account/keys',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('stability', 'missing_key', 'Stable Diffusion needs an API key.')
    const res = await proxy('stability', { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('stability', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.image) throw new ToolError('stability', 'bad_response', 'Stability returned no image.')
    return { type: 'image', url: `data:image/png;base64,${data.image}`, prompt, tool: 'stability' }
  },
}

const ideogram = {
  id: 'ideogram',
  name: 'Ideogram',
  category: 'image',
  capability: 'generate images with legible text (logos, posters, signs)',
  desc: 'Best when the image needs words baked in',
  keySource: 'tool_keys.ideogram',
  keyPrefix: 'ideo-',
  docsUrl: 'https://ideogram.ai/manage-api',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('ideogram', 'missing_key', 'Ideogram needs an API key.')
    const res = await proxy('ideogram', { prompt: prompt.slice(0, 900) }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('ideogram', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const url = data.data?.[0]?.url
    if (!url) throw new ToolError('ideogram', 'bad_response', 'Ideogram returned no image.')
    return { type: 'image', url, prompt, tool: 'ideogram' }
  },
}

// Flux via fal.ai — works browser-direct, no proxy needed
const flux = {
  id: 'flux',
  name: 'Flux (Pro)',
  category: 'image',
  capability: 'photorealistic image generation (top-tier quality)',
  desc: 'Black Forest Labs Flux 1.1 Pro via fal.ai — current photorealism leader',
  keySource: 'tool_keys.flux',
  docsUrl: 'https://fal.ai/dashboard/keys',
  setupHint: 'Sign up at fal.ai and paste your "key" (starts with "fal-"). $5 free credit on signup.',
  status: 'live',
  async run({ prompt, key }) {
    if (!key) throw new ToolError('flux', 'missing_key', 'Flux needs a fal.ai API key.')
    const res = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
      body: JSON.stringify({ prompt: prompt.slice(0, 1500), image_size: 'landscape_16_9', num_images: 1 }),
    })
    if (!res.ok) throw new ToolError('flux', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const url = data.images?.[0]?.url
    if (!url) throw new ToolError('flux', 'bad_response', 'Flux returned no image.')
    return { type: 'image', url, prompt, tool: 'flux' }
  },
}

const recraft = {
  id: 'recraft',
  name: 'Recraft',
  category: 'image',
  capability: 'logos, icons, vector graphics, brand assets',
  desc: 'Where DALL-E falls apart — clean vectors and brand work',
  keySource: 'tool_keys.recraft',
  docsUrl: 'https://www.recraft.ai/profile/api',
  setupHint: 'Sign up at recraft.ai, go to Profile → API to generate a key.',
  status: 'live',
  async run({ prompt, key }) {
    if (!key) throw new ToolError('recraft', 'missing_key', 'Recraft needs an API key.')
    const res = await fetch('https://external.api.recraft.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: prompt.slice(0, 1500), style: 'digital_illustration', size: '1024x1024' }),
    })
    if (!res.ok) throw new ToolError('recraft', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const url = data.data?.[0]?.url
    if (!url) throw new ToolError('recraft', 'bad_response', 'Recraft returned no image.')
    return { type: 'image', url, prompt, tool: 'recraft' }
  },
}

// ── Image editing ─────────────────────────────────────────────────

const removebg = {
  id: 'removebg',
  name: 'Remove.bg',
  category: 'image_edit',
  capability: 'remove the background from any image, returning a clean PNG',
  desc: 'One-purpose tool — background removal that just works',
  keySource: 'tool_keys.removebg',
  docsUrl: 'https://www.remove.bg/dashboard',
  setupHint: 'Free tier ~50 images/month. Needs a Worker proxy route — coming soon.',
  status: 'needs_proxy_route',  // CORS is inconsistent for browser-direct calls
  async run({ prompt, key, context, proxy }) {
    if (!key) throw new ToolError('removebg', 'missing_key', 'Remove.bg needs an API key.')
    const sourceUrl = context?.sourceImageUrl
    if (!sourceUrl) throw new ToolError('removebg', 'no_source', 'Remove.bg needs a source image — generate or upload one first.')
    // Routes through the Worker — proxy adds CORS + masks the key from the page
    const res = await proxy('removebg', { image_url: sourceUrl, size: 'auto' }, { 'X-Api-Key': key })
    if (!res.ok) throw new ToolError('removebg', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    return { type: 'image', url, prompt, tool: 'removebg' }
  },
}

const clipdrop = {
  id: 'clipdrop',
  name: 'Clipdrop',
  category: 'image_edit',
  capability: 'cleanup, uncrop, relight, remove text, upscale — image polish toolkit',
  desc: 'The polish layer between "generated" and "ready to ship"',
  keySource: 'tool_keys.clipdrop',
  docsUrl: 'https://clipdrop.co/apis',
  setupHint: 'Needs a Worker proxy route — coming soon.',
  status: 'needs_proxy_route',
  async run({ prompt, key, context, proxy }) {
    if (!key) throw new ToolError('clipdrop', 'missing_key', 'Clipdrop needs an API key.')
    const sourceUrl = context?.sourceImageUrl
    if (!sourceUrl) throw new ToolError('clipdrop', 'no_source', 'Clipdrop needs a source image to edit.')
    const res = await proxy('clipdrop', { source_url: sourceUrl }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('clipdrop', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    return { type: 'image', url, prompt, tool: 'clipdrop' }
  },
}

// ── Voice / TTS ───────────────────────────────────────────────────

const elevenlabs = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  category: 'audio_tts',
  capability: 'synthesize realistic AI voices',
  desc: 'Premium AI voice synthesis — best-in-class quality',
  keySource: 'tool_keys.elevenlabs',
  docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('elevenlabs', 'missing_key', 'ElevenLabs needs an API key.')
    const voiceId = '21m00Tcm4TlvDq8ikWAM'
    const res = await proxy('elevenlabs', { text: prompt.slice(0, 2500), voice_id: voiceId }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('elevenlabs', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.audio) throw new ToolError('elevenlabs', 'bad_response', 'ElevenLabs returned no audio.')
    return { type: 'audio', url: `data:audio/mpeg;base64,${data.audio}`, title: prompt.slice(0, 60), prompt, tool: 'elevenlabs' }
  },
}

// ── Music ─────────────────────────────────────────────────────────

const suno = {
  id: 'suno',
  name: 'Suno',
  category: 'audio_music',
  capability: 'generate full songs with vocals',
  desc: 'Full songs with vocals from a description',
  keySource: 'tool_keys.suno',
  docsUrl: 'https://suno.com/account',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('suno', 'missing_key', 'Suno needs an API key.')
    const res = await proxy('suno', { prompt: prompt.slice(0, 500) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('suno', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('suno', 'bad_response', 'Suno returned no audio URL.')
    return { type: 'audio', url: data.url, title: data.title || prompt.slice(0, 60), prompt, tool: 'suno' }
  },
}

// ── Video ─────────────────────────────────────────────────────────

const runway = {
  id: 'runway',
  name: 'Runway Gen-4',
  category: 'video',
  capability: 'generate short AI videos from text',
  desc: 'AI video generation, ~5s clips',
  keySource: 'tool_keys.runway',
  docsUrl: 'https://app.runwayml.com/account',
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('runway', 'missing_key', 'Runway needs an API key.')
    const res = await proxy('runway', { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('runway', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('runway', 'bad_response', 'Runway returned no video URL.')
    return { type: 'video', url: data.url, prompt, tool: 'runway', duration: data.duration }
  },
}

// ── Search ────────────────────────────────────────────────────────

const perplexity = {
  id: 'perplexity',
  name: 'Perplexity',
  category: 'search',
  capability: 'search the web for real-time information with citations',
  desc: 'Real-time web search with answers',
  keySource: 'tool_keys.perplexity',
  keyPrefix: 'pplx-',
  docsUrl: 'https://www.perplexity.ai/settings/api',
  status: 'live',
  async run({ prompt, key }) {
    if (!key) throw new ToolError('perplexity', 'missing_key', 'Perplexity needs an API key.')
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'llama-3.1-sonar-small-128k-online', messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new ToolError('perplexity', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new ToolError('perplexity', 'bad_response', 'No content.')
    return { type: 'search', text, citations: data.citations || [], tool: 'perplexity' }
  },
}

const tavily = {
  id: 'tavily',
  name: 'Tavily',
  category: 'search',
  capability: 'AI-optimized web search built for agents',
  desc: 'Cleaner results, better for agentic loops',
  keySource: 'tool_keys.tavily',
  keyPrefix: 'tvly-',
  docsUrl: 'https://app.tavily.com/home',
  status: 'live',
  async run({ prompt, key }) {
    if (!key) throw new ToolError('tavily', 'missing_key', 'Tavily needs an API key.')
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: prompt, search_depth: 'advanced', max_results: 5, include_answer: true }),
    })
    if (!res.ok) throw new ToolError('tavily', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const text = data.answer || (data.results || []).map(r => `${r.title}: ${r.content}`).join('\n\n')
    if (!text) throw new ToolError('tavily', 'bad_response', 'No results.')
    return { type: 'search', text, citations: (data.results || []).map(r => ({ title: r.title, url: r.url })), tool: 'tavily' }
  },
}

// ── agent_synth — the panel as a tool ─────────────────────────────
// Used inside a build plan when one step needs structured output from
// the orchestration model: turn a topic into a slide outline, distill
// a discussion into bullet points, etc. Lets builds intersperse "agents
// think" steps with "tools create" steps.

const agentSynth = {
  id: 'agent_synth',
  name: 'Agent synthesis',
  category: 'meta',
  capability: 'have the panel produce structured content (outlines, scripts, summaries) for downstream steps',
  desc: 'Internal — used by multi-step builds to feed structured input into other tools',
  keySource: 'agent.claude',  // prefers Claude key; falls back below if missing
  status: 'live',
  hidden: true,  // not shown in Settings — it's a build-internal tool
  async run({ prompt, settings, outputSchema }) {
    // Pick whichever orchestration model the user has — Claude → GPT → Gemini
    const cfg =
      settings?.agents?.claude?.key ? { provider: 'claude', key: settings.agents.claude.key } :
      settings?.agents?.gpt?.key    ? { provider: 'gpt',    key: settings.agents.gpt.key } :
      settings?.agents?.gemini?.key ? { provider: 'gemini', key: settings.agents.gemini.key } :
      null
    if (!cfg) throw new ToolError('agent_synth', 'no_model', 'No orchestration model available — add a Claude, GPT, or Gemini key.')

    const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'

    const schemaHint = outputSchema === 'slides'
      ? `\nReturn JSON of this exact shape: {"slides":[{"title":"...", "bullets":["...","..."], "notes":"speaker notes"}, ...]}`
      : outputSchema === 'document'
      ? `\nReturn JSON of this exact shape: {"title":"...", "sections":[{"heading":"...", "paragraphs":["...","..."]}, ...]}`
      : outputSchema === 'spreadsheet'
      ? `\nReturn JSON of this exact shape: {"title":"...", "sheets":[{"name":"Sheet1","rows":[["Header A","Header B"],["row1 col1","row1 col2"]]}, ...]}. First row of each sheet is the header.`
      : outputSchema === 'page'
      ? `\nReturn JSON of this exact shape: {"title":"...", "theme":"light"|"dark"|"serif", "sections":[{"heading":"...", "body":"paragraph text — use \\n\\n between paragraphs", "items":["optional bullet","..."]}, ...]}`
      : outputSchema === 'post'
      ? `\nReturn JSON of this exact shape: {"title":"...", "frontmatter":{"author":"...", "tags":["..."]}, "sections":[{"heading":"...", "body":"...", "items":["..."]}, ...]}`
      : outputSchema === 'project'
      ? `\nReturn JSON of this exact shape: {"files":[{"path":"src/index.js","content":"// file contents as a string\\n"}, ...]}. Paths can be nested. Escape newlines in content as \\n.`
      : outputSchema === 'event'
      ? `\nReturn JSON of this exact shape: {"summary":"event title","start":"2026-06-01T15:00:00-07:00","end":"2026-06-01T16:00:00-07:00","description":"...","attendees":["email@example.com"]}. Use ISO 8601 with timezone offset, or {"date":"YYYY-MM-DD"} for all-day.`
      : `\nReturn clean JSON only — no markdown fences, no prose around it.`

    const fullPrompt = `${prompt}${schemaHint}`

    // Worker requires the Supabase auth header — same shape the
    // orchestrator uses. Without it, the Worker returns 401.
    const { supabase } = await import('../utils/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    const supaAuth = session?.access_token
      ? { 'x-supabase-auth': `Bearer ${session.access_token}` }
      : {}

    // One provider call. Returns raw text; throws an Error with .status
    // on HTTP failure so the retry loop can decide whether to try again.
    const callOnce = async () => {
      if (cfg.provider === 'claude') {
        const res = await fetch(`${PROXY}/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, ...supaAuth },
          // 4K fits any outline (slides[] or sections[]) and finishes
          // well inside Cloudflare's ~100s wall. 8K gens were hitting
          // 524 timeouts in real testing.
          body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }], max_tokens: 4096 }),
        })
        if (!res.ok) { const e = new Error(`claude_${res.status}`); e.status = res.status; throw e }
        const data = await res.json()
        return data.content?.[0]?.text || ''
      } else if (cfg.provider === 'gpt') {
        const res = await fetch(`${PROXY}/gpt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}`, ...supaAuth },
          body: JSON.stringify({ messages: [{ role: 'user', content: fullPrompt }], max_tokens: 4096 }),
        })
        if (!res.ok) { const e = new Error(`gpt_${res.status}`); e.status = res.status; throw e }
        return res.text()
      } else {
        const res = await fetch(`${PROXY}/gemini`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, ...supaAuth },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: { maxOutputTokens: 4096 },
          }),
        })
        if (!res.ok) { const e = new Error(`gemini_${res.status}`); e.status = res.status; throw e }
        return res.text()
      }
    }

    // Retry transient failures up to 3x with backoff. Cloudflare 524
    // (timeout), 529 (overloaded), and 5xx upstream blips are usually
    // self-healing within a few seconds. Hard errors (auth, bad request)
    // fail fast.
    const TRANSIENT = new Set([429, 500, 502, 503, 524, 529])
    let raw = ''
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await callOnce()
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        if (!TRANSIENT.has(e.status)) break
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
    if (lastErr) {
      const friendly = (lastErr.status === 524 || lastErr.status === 529)
        ? 'the model timed out — try again'
        : lastErr.message
      throw new ToolError('agent_synth', 'bad_response', friendly)
    }

    // Robust JSON extraction — finds the first balanced { ... }
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    const start = cleaned.indexOf('{')
    if (start === -1) throw new ToolError('agent_synth', 'bad_response', 'No JSON in response')
    let depth = 0, inString = false, escape = false
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i]
      if (inString) {
        if (escape) { escape = false; continue }
        if (c === '\\') { escape = true; continue }
        if (c === '"') inString = false
        continue
      }
      if (c === '"') { inString = true; continue }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1))
          } catch {
            throw new ToolError('agent_synth', 'bad_response', 'Malformed JSON')
          }
        }
      }
    }
    throw new ToolError('agent_synth', 'bad_response', 'Unterminated JSON')
  },
}

// ── pptxgen — generate .pptx slides browser-side, no key needed ───
const pptxgen = {
  id: 'pptxgen',
  name: 'Slide deck (.pptx)',
  category: 'document',
  capability: 'generate a PowerPoint deck from a structured slide outline',
  desc: 'Browser-side .pptx generation — no API key, no rate limit',
  keySource: null,  // no key needed
  status: 'live',
  hidden: true,  // surfaces only inside build plans
  async run({ structuredInput, label }) {
    const { default: PptxGenJS } = await import('pptxgenjs')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const slides = data?.slides || []
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new ToolError('pptxgen', 'no_input', 'pptxgen needs a slides[] array')
    }

    const pres = new PptxGenJS()
    pres.layout = 'LAYOUT_WIDE'
    for (const s of slides) {
      const slide = pres.addSlide()
      if (s.title) {
        slide.addText(s.title, {
          x: 0.5, y: 0.4, w: 12, h: 1,
          fontSize: 32, bold: true, color: '0E0F12',
        })
      }
      if (Array.isArray(s.bullets) && s.bullets.length) {
        slide.addText(
          s.bullets.map(b => ({ text: b, options: { bullet: true } })),
          { x: 0.7, y: 1.6, w: 11.5, h: 5, fontSize: 20, color: '263238' }
        )
      }
      if (s.notes) {
        slide.addNotes(s.notes)
      }
    }

    const blob = await pres.write({ outputType: 'blob' })
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'deck').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'deck'}.pptx`,
      tool: 'pptxgen',
      meta: {
        slideCount: slides.length,
        slideTitles: slides.map(s => s.title || 'Untitled slide').slice(0, 12),
      },
    }
  },
}

// ── docgen — generate .docx documents browser-side ────────────────
const docgen = {
  id: 'docgen',
  name: 'Document (.docx)',
  category: 'document',
  capability: 'generate a Word document from a structured outline',
  desc: 'Browser-side .docx generation — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const docxMod = await import('docx')
    const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docxMod
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput

    const children = []
    if (data?.title) {
      children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: data.title })] }))
    }

    // Two supported shapes:
    //   - { sections: [{ heading, paragraphs[] }] }
    //   - { slides: [{ title, bullets, notes }] } — used for speaker notes from a deck outline
    if (Array.isArray(data?.sections)) {
      for (const sec of data.sections) {
        if (sec.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(sec.heading)] }))
        for (const p of sec.paragraphs || []) {
          children.push(new Paragraph({ children: [new TextRun(p)] }))
        }
      }
    } else if (Array.isArray(data?.slides)) {
      data.slides.forEach((s, i) => {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Slide ${i + 1}: ${s.title || ''}`)] }))
        for (const b of s.bullets || []) {
          children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }))
        }
        if (s.notes) {
          children.push(new Paragraph({ children: [new TextRun({ text: 'Speaker notes:', bold: true })] }))
          children.push(new Paragraph({ children: [new TextRun(s.notes)] }))
        }
      })
    }

    const doc = new Document({ sections: [{ properties: {}, children }] })
    const blob = await Packer.toBlob(doc)
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'document').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'document'}.docx`,
      tool: 'docgen',
      meta: { sections: Array.isArray(data?.sections) ? data.sections.length : (data?.slides?.length || 0) },
    }
  },
}

// ── pdfgen — generate .pdf documents browser-side ─────────────────
const pdfgen = {
  id: 'pdfgen',
  name: 'PDF document (.pdf)',
  category: 'document',
  capability: 'generate a PDF from structured content (title, headings, paragraphs)',
  desc: 'Browser-side .pdf generation via jspdf — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const { jsPDF } = await import('jspdf')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput

    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const margin = 56
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    let y = margin

    const writeWrapped = (text, opts = {}) => {
      const { size = 11, bold = false, gap = 14 } = opts
      doc.setFontSize(size)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(text, pageWidth - margin * 2)
      for (const line of lines) {
        if (y > pageHeight - margin) { doc.addPage(); y = margin }
        doc.text(line, margin, y)
        y += gap
      }
    }

    if (data?.title) {
      writeWrapped(data.title, { size: 22, bold: true, gap: 28 })
      y += 8
    }

    if (Array.isArray(data?.sections)) {
      for (const sec of data.sections) {
        if (sec.heading) writeWrapped(sec.heading, { size: 14, bold: true, gap: 18 })
        for (const p of sec.paragraphs || []) {
          writeWrapped(p, { size: 11, gap: 14 })
          y += 6
        }
        y += 8
      }
    } else if (Array.isArray(data?.slides)) {
      data.slides.forEach((s, i) => {
        writeWrapped(`Slide ${i + 1}: ${s.title || ''}`, { size: 14, bold: true, gap: 18 })
        for (const b of s.bullets || []) {
          writeWrapped(`• ${b}`, { size: 11, gap: 14 })
        }
        if (s.notes) {
          y += 4
          writeWrapped('Speaker notes:', { size: 10, bold: true, gap: 12 })
          writeWrapped(s.notes, { size: 10, gap: 12 })
        }
        y += 10
      })
    } else if (typeof data === 'string') {
      writeWrapped(data, { size: 11, gap: 14 })
    }

    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'document').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'document'}.pdf`,
      tool: 'pdfgen',
    }
  },
}

// ── Gmail send — uses existing Google OAuth token + gmail.send scope ─
// No separate API key needed. Reuses the user's Drive connection.
const gmail = {
  id: 'gmail',
  name: 'Email (Gmail)',
  category: 'action',
  capability: 'send an email through the user\'s own Gmail (with optional Drive-hosted attachments)',
  desc: 'Uses your Google connection — no separate key. Reconnect Drive after this update to add the gmail.send scope.',
  keySource: null,  // uses OAuth token from storage_connections
  status: 'live',
  hidden: true,  // surfaces only via build plans, not as a Settings toggle
  async run({ structuredInput, prompt, settings }) {
    // Look up the Google OAuth token from storage_connections
    const { supabase } = await import('../utils/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new ToolError('gmail', 'no_user', 'Not signed in.')
    const { data: conn } = await supabase.from('storage_connections')
      .select('access_token').eq('user_id', user.id).eq('provider', 'google_drive').maybeSingle()
    if (!conn?.access_token) throw new ToolError('gmail', 'no_token', 'Connect Google Drive first (Settings → Storage).')

    // Input can be either a structured object {to, subject, body} or a
    // string the model wrote naturally. Try structured first.
    const input = typeof structuredInput === 'object' && structuredInput !== null
      ? structuredInput
      : { to: null, subject: null, body: (prompt || '') }

    const to = input.to
    const subject = input.subject || 'From your Agent Interface panel'
    const body = input.body || prompt || ''

    if (!to) throw new ToolError('gmail', 'no_recipient', 'No recipient email specified.')

    // Build RFC 2822 message, base64url-encoded for Gmail API
    const mime = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n')

    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.access_token}` },
      body: JSON.stringify({ raw }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      if (res.status === 403 && t.includes('insufficient')) {
        throw new ToolError('gmail', 'needs_scope', 'Gmail send needs an additional permission. Disconnect and reconnect Google Drive in Settings → Storage to grant it.')
      }
      throw new ToolError('gmail', 'send_failed', `Gmail returned ${res.status}: ${t.slice(0, 200)}`)
    }
    const data = await res.json()
    return {
      type: 'action',
      tool: 'gmail',
      summary: `Email sent to ${to}`,
      meta: { messageId: data.id, threadId: data.threadId, to, subject },
    }
  },
}

// ── xlsxgen — Excel .xlsx browser-side ────────────────────────────
// Input: { sheets: [{ name, rows: [[cell, cell, ...], ...] }] }
// First row of each sheet is treated as the header for column widths.
const xlsxgen = {
  id: 'xlsxgen',
  name: 'Spreadsheet (.xlsx)',
  category: 'document',
  capability: 'generate an Excel spreadsheet from structured rows (multi-sheet supported)',
  desc: 'Browser-side .xlsx generation — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const XLSX = await import('xlsx')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const sheets = Array.isArray(data?.sheets) ? data.sheets
      : Array.isArray(data?.rows) ? [{ name: 'Sheet1', rows: data.rows }]
      : null
    if (!sheets?.length) throw new ToolError('xlsxgen', 'no_input', 'xlsxgen needs sheets[] or rows[][]')

    const wb = XLSX.utils.book_new()
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows || [])
      // Auto-width columns based on the longest cell in each column
      const header = (s.rows || [])[0] || []
      ws['!cols'] = header.map((_, i) => {
        let max = 8
        for (const row of (s.rows || [])) {
          const v = row?.[i]
          const len = v == null ? 0 : String(v).length
          if (len > max) max = Math.min(len, 60)
        }
        return { wch: max + 2 }
      })
      XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet').slice(0, 31))
    }
    const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'spreadsheet').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'spreadsheet'}.xlsx`,
      tool: 'xlsxgen',
      meta: { sheetCount: sheets.length, sheetNames: sheets.map(s => s.name).filter(Boolean) },
    }
  },
}

// ── htmlgen — single-page .html landing page browser-side ─────────
// Input: { title, sections: [{ heading?, body?, items?[] }], theme? }
// Theme: 'light' (default) | 'dark' | 'serif' — picks tasteful built-in CSS.
const htmlgen = {
  id: 'htmlgen',
  name: 'Landing page (.html)',
  category: 'document',
  capability: 'generate a self-contained single-page HTML site with inlined CSS',
  desc: 'Browser-side .html with inlined styles — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const title = data?.title || label || 'Untitled'
    const sections = Array.isArray(data?.sections) ? data.sections : []
    const theme = data?.theme || 'light'

    const themes = {
      light: { bg: '#ffffff', fg: '#0e0f12', muted: '#5b6470', accent: '#2563eb', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
      dark:  { bg: '#0e0f12', fg: '#f0f2f5', muted: '#9aa3b0', accent: '#6fa1ff', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
      serif: { bg: '#faf8f3', fg: '#1b1b1b', muted: '#5e574a', accent: '#a14b2b', font: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' },
    }
    const t = themes[theme] || themes.light

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const renderSection = (s) => {
      const heading = s?.heading ? `<h2>${esc(s.heading)}</h2>` : ''
      const body = s?.body ? `<p>${esc(s.body).replace(/\n\n/g, '</p><p>')}</p>` : ''
      const items = Array.isArray(s?.items) && s.items.length
        ? `<ul>${s.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
        : ''
      return `<section>${heading}${body}${items}</section>`
    }

    const css = `
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:${t.font};background:${t.bg};color:${t.fg};line-height:1.6;padding:64px 24px;max-width:780px;margin:0 auto}
      h1{font-size:2.6rem;font-weight:700;letter-spacing:-0.02em;margin-bottom:24px}
      h2{font-size:1.4rem;font-weight:600;margin:48px 0 12px;color:${t.fg}}
      p{color:${t.muted};margin-bottom:12px;font-size:1.05rem}
      ul{padding-left:22px;color:${t.muted};margin-bottom:16px}
      li{margin-bottom:6px}
      a{color:${t.accent};text-decoration:none}
      a:hover{text-decoration:underline}
      section:first-of-type h2{margin-top:32px}
      .footer{margin-top:64px;padding-top:24px;border-top:1px solid ${t.muted}33;color:${t.muted};font-size:0.85rem}
    `.trim()

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
<h1>${esc(title)}</h1>
${sections.map(renderSection).join('\n')}
<div class="footer">Built with Agent Interface</div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'page').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'page'}.html`,
      tool: 'htmlgen',
      meta: { sectionCount: sections.length, theme },
    }
  },
}

// ── mdgen — markdown blog post / doc browser-side ─────────────────
// Input: { title, sections: [{ heading, body, items?[] }], frontmatter?: {} }
// Emits YAML frontmatter + markdown body — drops into any static site.
const mdgen = {
  id: 'mdgen',
  name: 'Markdown post (.md)',
  category: 'document',
  capability: 'generate a markdown blog post with YAML frontmatter (drops into any static site)',
  desc: 'Browser-side .md with frontmatter — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const title = data?.title || label || 'Untitled'
    const sections = Array.isArray(data?.sections) ? data.sections : []
    const fm = { title, date: new Date().toISOString().slice(0, 10), ...(data?.frontmatter || {}) }

    const yaml = Object.entries(fm)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : JSON.stringify(v)}`)
      .join('\n')

    const body = sections.map(s => {
      const h = s.heading ? `## ${s.heading}\n\n` : ''
      const b = s.body ? `${s.body}\n\n` : ''
      const i = Array.isArray(s.items) && s.items.length
        ? s.items.map(x => `- ${x}`).join('\n') + '\n\n'
        : ''
      return `${h}${b}${i}`
    }).join('').trim()

    const md = `---\n${yaml}\n---\n\n# ${title}\n\n${body}\n`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'post').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'post'}.md`,
      tool: 'mdgen',
      meta: { sectionCount: sections.length, wordCount: body.split(/\s+/).filter(Boolean).length },
    }
  },
}

// ── codezip — multi-file code project as .zip browser-side ────────
// Input: { files: [{ path, content }] }
// Paths can be nested ('src/index.js'). Empty content allowed.
const codezip = {
  id: 'codezip',
  name: 'Code project (.zip)',
  category: 'document',
  capability: 'bundle a multi-file code project into a downloadable .zip (paths can be nested)',
  desc: 'Browser-side .zip via JSZip — no API key',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const { default: JSZip } = await import('jszip')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const files = Array.isArray(data?.files) ? data.files : []
    if (!files.length) throw new ToolError('codezip', 'no_input', 'codezip needs files[]')

    const zip = new JSZip()
    for (const f of files) {
      if (!f?.path) continue
      zip.file(f.path, f.content == null ? '' : String(f.content))
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const url = URL.createObjectURL(blob)
    return {
      type: 'document',
      url,
      filename: `${(label || 'project').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'project'}.zip`,
      tool: 'codezip',
      meta: { fileCount: files.length, paths: files.map(f => f.path).slice(0, 12) },
    }
  },
}

// ── gsheets — create a Google Sheet in the user's Drive ───────────
// Input: { title, sheets: [{ name, rows: [[]] }] }
// Reuses the user's Google OAuth token (needs spreadsheets scope —
// added in StorageTab; users must reconnect Drive after this update).
// Returns an 'action' so the build card surfaces the link.
const gsheets = {
  id: 'gsheets',
  name: 'Google Sheet',
  category: 'action',
  capability: 'create a Google Sheet in the user\'s Drive with multi-sheet rows (returns a shareable link)',
  desc: 'Uses your Google connection. Reconnect Drive after this update to grant the spreadsheets scope.',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput, label }) {
    const { supabase } = await import('../utils/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new ToolError('gsheets', 'no_user', 'Not signed in.')
    const { data: conn } = await supabase.from('storage_connections')
      .select('access_token').eq('user_id', user.id).eq('provider', 'google_drive').maybeSingle()
    if (!conn?.access_token) throw new ToolError('gsheets', 'no_token', 'Connect Google Drive first (Settings → Storage).')

    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const title = data?.title || label || 'Untitled spreadsheet'
    const sheets = Array.isArray(data?.sheets) ? data.sheets
      : Array.isArray(data?.rows) ? [{ name: 'Sheet1', rows: data.rows }]
      : null
    if (!sheets?.length) throw new ToolError('gsheets', 'no_input', 'gsheets needs sheets[] or rows[][]')

    // 1. Create the spreadsheet with all sheets in one call
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.access_token}` },
      body: JSON.stringify({
        properties: { title: title.slice(0, 200) },
        sheets: sheets.map((s, i) => ({ properties: { title: (s.name || `Sheet${i + 1}`).slice(0, 100), index: i } })),
      }),
    })
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '')
      if (createRes.status === 403 && /insufficient|scope/i.test(t)) {
        throw new ToolError('gsheets', 'needs_scope', 'Google Sheets needs an additional permission. Disconnect and reconnect Google Drive in Settings → Storage to grant it.')
      }
      throw new ToolError('gsheets', 'bad_response', `Sheets returned ${createRes.status}: ${t.slice(0, 200)}`)
    }
    const created = await createRes.json()
    const spreadsheetId = created.spreadsheetId

    // 2. Batch-update values across all sheets
    const valueRanges = sheets.map((s, i) => ({
      range: `'${(s.name || `Sheet${i + 1}`).slice(0, 100)}'!A1`,
      majorDimension: 'ROWS',
      values: s.rows || [],
    }))
    const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.access_token}` },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: valueRanges }),
    })
    if (!updateRes.ok) {
      const t = await updateRes.text().catch(() => '')
      throw new ToolError('gsheets', 'bad_response', `Sheets write returned ${updateRes.status}: ${t.slice(0, 200)}`)
    }

    return {
      type: 'action',
      tool: 'gsheets',
      summary: `Google Sheet "${title}" created with ${sheets.length} tab${sheets.length === 1 ? '' : 's'}`,
      link: created.spreadsheetUrl,
      meta: { spreadsheetId, title, sheetCount: sheets.length, sheetNames: sheets.map(s => s.name).filter(Boolean) },
    }
  },
}

// ── gcal — create a Google Calendar event ─────────────────────────
// Input: { summary, start, end, description?, location?, attendees?: ['email', ...], calendarId? }
// start/end accept ISO strings ('2026-06-01T15:00:00-07:00') or
// { date: 'YYYY-MM-DD' } for all-day events.
const gcal = {
  id: 'gcal',
  name: 'Calendar event',
  category: 'action',
  capability: 'create a Google Calendar event with attendees and a description',
  desc: 'Uses your Google connection. Reconnect Drive after this update to grant the calendar.events scope.',
  keySource: null,
  status: 'live',
  hidden: true,
  async run({ structuredInput }) {
    const { supabase } = await import('../utils/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new ToolError('gcal', 'no_user', 'Not signed in.')
    const { data: conn } = await supabase.from('storage_connections')
      .select('access_token').eq('user_id', user.id).eq('provider', 'google_drive').maybeSingle()
    if (!conn?.access_token) throw new ToolError('gcal', 'no_token', 'Connect Google Drive first (Settings → Storage).')

    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    if (!data?.summary) throw new ToolError('gcal', 'no_summary', 'Calendar event needs a summary (title).')
    if (!data?.start || !data?.end) throw new ToolError('gcal', 'no_time', 'Calendar event needs start and end times.')

    // Normalize start/end: ISO string → dateTime, {date} → all-day
    const norm = (t) => {
      if (typeof t === 'string') return { dateTime: t, timeZone: data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }
      if (t?.date) return { date: t.date }
      if (t?.dateTime) return { dateTime: t.dateTime, timeZone: t.timeZone || data.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }
      return null
    }
    const start = norm(data.start), end = norm(data.end)
    if (!start || !end) throw new ToolError('gcal', 'bad_time', 'Calendar start/end must be ISO strings or {date} objects.')

    const event = {
      summary: data.summary,
      start, end,
      ...(data.description ? { description: data.description } : {}),
      ...(data.location ? { location: data.location } : {}),
      ...(Array.isArray(data.attendees) && data.attendees.length
        ? { attendees: data.attendees.map(e => typeof e === 'string' ? { email: e } : e) }
        : {}),
    }

    const calendarId = data.calendarId || 'primary'
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.access_token}` },
        body: JSON.stringify(event),
      }
    )
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      if (res.status === 403 && /insufficient|scope/i.test(t)) {
        throw new ToolError('gcal', 'needs_scope', 'Google Calendar needs an additional permission. Disconnect and reconnect Google Drive in Settings → Storage to grant it.')
      }
      throw new ToolError('gcal', 'bad_response', `Calendar returned ${res.status}: ${t.slice(0, 200)}`)
    }
    const created = await res.json()
    return {
      type: 'action',
      tool: 'gcal',
      summary: `Calendar event "${data.summary}" scheduled`,
      link: created.htmlLink,
      meta: { eventId: created.id, start: created.start, end: created.end, attendees: created.attendees?.length || 0 },
    }
  },
}

// ── narrate_per_slide — ElevenLabs per slide for synced narration ──
// Produces N audio files (one per slide) plus timing metadata, ready
// to combine with the slide deck into a synced video later.
const narratePerSlide = {
  id: 'narrate_per_slide',
  name: 'Per-slide narration',
  category: 'audio_tts',
  capability: 'narrate a slide deck one slide at a time — N audio files with timing data',
  desc: 'Internal — used in deck builds to produce slide-synced narration',
  keySource: 'tool_keys.elevenlabs',
  status: 'live',
  hidden: true,
  async run({ structuredInput, key, proxy }) {
    if (!key) throw new ToolError('narrate_per_slide', 'missing_key', 'ElevenLabs needs an API key.')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const slides = data?.slides || []
    if (slides.length === 0) throw new ToolError('narrate_per_slide', 'no_slides', 'No slides to narrate.')

    const voiceId = '21m00Tcm4TlvDq8ikWAM' // Rachel
    const files = []
    let cumulativeSec = 0
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      const text = s.notes || `${s.title || ''}. ${(s.bullets || []).join('. ')}`
      const safe = text.slice(0, 2500).trim()
      if (!safe) continue

      const res = await proxy('elevenlabs', { text: safe, voice_id: voiceId }, { 'x-api-key': key })
      if (!res.ok) {
        files.push({ slideIndex: i + 1, error: `elevenlabs_${res.status}` })
        continue
      }
      const payload = await res.json()
      if (!payload.audio) {
        files.push({ slideIndex: i + 1, error: 'no_audio' })
        continue
      }
      // Rough duration estimate: ~150 words/min, ~5 chars/word → ~12.5 chars/sec
      const estSec = Math.max(2, Math.round(safe.length / 12.5))
      files.push({
        slideIndex: i + 1,
        url: `data:audio/mpeg;base64,${payload.audio}`,
        startSec: cumulativeSec,
        durationSec: estSec,
        filename: `slide-${String(i + 1).padStart(2, '0')}.mp3`,
      })
      cumulativeSec += estSec
    }

    return {
      type: 'audio_bundle',
      tool: 'narrate_per_slide',
      files,
      totalDurationSec: cumulativeSec,
    }
  },
}

// ── The registry ──────────────────────────────────────────────────

export const TOOL_REGISTRY = [
  // Image generation — all confirmed working from browser
  dalle, stability, ideogram, flux, recraft,
  // Image editing — stubbed but UI shows "coming with Worker route"
  removebg, clipdrop,
  // Voice / music
  elevenlabs, suno,
  // Video
  runway,
  // Search
  perplexity, tavily,
  // Document generation — browser-side, no API key needed
  pptxgen, docgen, pdfgen, xlsxgen, htmlgen, mdgen, codezip,
  // Per-slide narration (synced audio for deck builds)
  narratePerSlide,
  // Action layer
  gmail, gsheets, gcal,
  // Meta — panel-as-tool for multi-step builds
  agentSynth,
]

export const TOOLS_BY_ID = Object.fromEntries(TOOL_REGISTRY.map(t => [t.id, t]))

// Tools we want users to know about but that can't connect yet.
// These appear in Settings as roadmap cards (no Connect button).
export const ROADMAP_TOOLS = [
  { id:'topaz',       name:'Topaz Upscale', category:'image_edit', desc:'Industry-leading upscaling. Currently invite-only beta — once Topaz opens their API we wire it up.' },
  { id:'luma',        name:'Luma Dream Machine (Ray2)', category:'video', desc:'Best-in-class text-to-video. API access expanding through 2026.' },
  { id:'pika',        name:'Pika Labs',     category:'video',      desc:'Image-to-video animation. API in early access.' },
  { id:'heygen',      name:'HeyGen',        category:'video',      desc:'Talking-avatar videos from a script. Browser-direct works — adding next round.' },
  { id:'udio',        name:'Udio',          category:'audio_music', desc:'Music generation — often beats Suno on certain genres. API in private beta.' },
  { id:'whisper',     name:'OpenAI Whisper', category:'audio_tts', desc:'Transcribe audio/video. Uses your existing OpenAI key — adding next round.' },
  { id:'assemblyai',  name:'AssemblyAI',    category:'audio_tts',  desc:'Production-grade transcription with speaker labels. Browser-direct works — adding next round.' },
  { id:'exa',         name:'Exa.ai',        category:'search',     desc:'Semantic web search built for AI agents. Adding next round.' },
  { id:'firecrawl',   name:'Firecrawl',     category:'search',     desc:'Turn any URL into clean markdown the panel can read. Adding next round.' },
  { id:'meshy',       name:'Meshy 3D',      category:'image',      desc:'Generate 3D models from text or images. Adding next round.' },
]

export const CATEGORY_LABELS = {
  image:       'Images',
  image_edit:  'Image editing',
  audio_tts:   'Voice',
  audio_music: 'Music',
  video:       'Video',
  document:    'Documents',
  search:      'Search',
  action:      'Actions',
  meta:        'Internal',
}

export function listEnabledTools(settings) {
  return TOOL_REGISTRY.filter(t => settings?.tools?.[t.id]?.enabled)
}

/**
 * Build the capability list for system prompts and the dispatcher,
 * showing only tools the user has enabled.
 */
export function capabilityList(settings) {
  return listEnabledTools(settings).map(t => ({ id: t.id, capability: t.capability }))
}
