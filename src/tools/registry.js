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
  search:      'Search',
  action:      'Actions',
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
