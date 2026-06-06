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
 *     setup: {                               // deep-links rendered as chips in Settings
 *       signupUrl, getKeyUrl, billingUrl, docsUrl,  // any subset
 *       seeText:  'what you see on the key page',    // optional
 *       note:     'gotcha, e.g. needs prepaid credits',
 *     },
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

import { modelFor } from '../config/models'

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

// Valid DALL-E 3 sizes. Friendly aliases let the dispatcher say "square" /
// "wide" / "tall" / "social" without remembering pixels. (The /dalle worker
// route now defaults to dall-e-3, which uses 1792x1024 / 1024x1792 for
// landscape/portrait — not gpt-image-1's 1536-wide sizes. Legacy 1536 sizes
// still resolve here and the worker remaps them, so older callers don't break.)
const DALLE_SIZES = {
  square:    '1024x1024',
  wide:      '1792x1024',  // landscape — slide covers, banners
  tall:      '1024x1792',  // portrait — phone wallpapers, IG stories
  social:    '1024x1024',  // IG post
  story:     '1024x1792',
  banner:    '1792x1024',
  '1024x1024': '1024x1024',
  '1792x1024': '1792x1024',
  '1024x1792': '1024x1792',
  '1536x1024': '1792x1024', // legacy gpt-image-1 wide → dall-e-3 wide
  '1024x1536': '1024x1792', // legacy gpt-image-1 tall → dall-e-3 tall
}
function normalizeDalleSize(size) {
  if (!size) return '1024x1024'
  return DALLE_SIZES[String(size).toLowerCase()] || '1024x1024'
}

// One raw DALL-E call (no fallback). Extracted as a hoisted declaration so
// generateImageWithFallback can invoke DALL-E WITHOUT recursing through the
// dalle tool's run() — which now delegates to the fallback.
async function dalleGenerateOnce({ prompt, structuredInput, key, proxy }) {
  if (!key) throw new ToolError('dalle', 'missing_key', 'DALL-E uses your OpenAI key — add it in Settings → Agents → ChatGPT.')
  // Size can come from structuredInput or be inferred from a prompt keyword.
  // Quality: 'high' (default), 'medium', 'low'.
  const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
  const size = normalizeDalleSize(cfg.size || cfg.aspect_ratio)
  const quality = ['high', 'medium', 'low'].includes(cfg.quality) ? cfg.quality : 'high'
  const realPrompt = (cfg.prompt || prompt || '').slice(0, 900)

  const res = await proxy('dalle', { prompt: realPrompt, size, quality }, { Authorization: `Bearer ${key}` })
  if (!res.ok) throw new ToolError('dalle', 'bad_response', await res.text().catch(() => `status ${res.status}`))
  const data = await res.json()
  if (data.error) throw new ToolError('dalle', 'bad_response', data.error?.message || 'DALL-E error')
  const b64 = data.data?.[0]?.b64_json
  const url = data.data?.[0]?.url
  const out = b64 ? `data:image/png;base64,${b64}` : url
  if (!out) throw new ToolError('dalle', 'bad_response', 'DALL-E returned no image.')
  return { type: 'image', url: out, prompt: realPrompt, tool: 'dalle', meta: { size, quality } }
}

const dalle = {
  id: 'dalle',
  name: 'DALL-E 3',
  category: 'image',
  capability: 'generate images from text prompts (sizes: square, wide, tall — for slide covers, banners, social posts)',
  desc: 'OpenAI image generation via dall-e-3 (uses your OpenAI key). Sizes: square (1:1), wide (landscape), tall (portrait).',
  keySource: 'agent.gpt',
  status: 'live',
  // Standalone image generation now has the same provider fallback as the build
  // pipeline: a DALL-E billing/quota/policy failure transparently tries the
  // other image providers the user has keys for (see generateImageWithFallback).
  // The /dalle route is translated to dall-e-3 by the worker (PR #30).
  async run({ prompt, structuredInput, key, proxy, settings }) {
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 900)
    // Build/runTool pass full settings (every provider key); if only the bare
    // OpenAI key arrived, synthesize a minimal settings so DALL-E still runs.
    const effSettings = settings || { agents: { gpt: { key } } }
    return generateImageWithFallback({ prompt: realPrompt, structuredInput: { ...cfg, prompt: realPrompt }, settings: effSettings, proxy })
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
  setup: {
    signupUrl: 'https://platform.stability.ai/', getKeyUrl: 'https://platform.stability.ai/account/keys', billingUrl: 'https://platform.stability.ai/account/credits',
    seeText: "Opens on your API Keys — click '+' to generate and copy a key.",
    note: '25 free credits on signup; buy more to keep generating.',
  },
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
  setup: {
    signupUrl: 'https://ideogram.ai/', getKeyUrl: 'https://ideogram.ai/manage-api', billingUrl: 'https://ideogram.ai/manage-api',
    seeText: 'Add a payment method, then create a key on the Manage API page.',
    note: 'Requires a minimum $10 top-up before you can create a key.',
  },
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
  setup: {
    signupUrl: 'https://fal.ai/login', getKeyUrl: 'https://fal.ai/dashboard/keys', billingUrl: 'https://fal.ai/dashboard/billing',
    seeText: "Click 'Add key', name it, and copy it immediately.",
    note: 'Key is shown only once; add a payment method for paid models.',
  },
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
  setup: {
    signupUrl: 'https://www.recraft.ai/', getKeyUrl: 'https://www.recraft.ai/profile/api', billingUrl: 'https://www.recraft.ai/profile/api',
    seeText: "Click 'Generate' to create the API key.",
    note: "The Generate button is disabled until you buy API units.",
  },
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
  setup: {
    signupUrl: 'https://www.remove.bg/users/sign_up', getKeyUrl: 'https://www.remove.bg/dashboard#api-key', billingUrl: 'https://www.remove.bg/pricing',
    seeText: 'Open the API Key section, create a key, and copy it.',
    note: '50 free API calls/month; the key can be re-issued anytime.',
  },
  setupHint: 'Free tier ~50 images/month. Generate or upload an image first, then run this on it.',
  status: 'live',
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
  setup: {
    signupUrl: 'https://clipdrop.co/apis', getKeyUrl: 'https://clipdrop.co/apis/account', billingUrl: 'https://clipdrop.co/apis/account',
    seeText: "On your account page click 'Reveal API Key' to copy it.",
    note: '⚠ Clipdrop is moving under Jasper — the standalone API may be deprecated; verify before relying on it.',
  },
  setupHint: 'Runs background removal on a source image. Other Clipdrop ops (upscale, cleanup) coming later. Note: Clipdrop is migrating under Jasper.',
  status: 'live',
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

const topaz = {
  id: 'topaz',
  name: 'Topaz Upscale',
  category: 'image_edit',
  capability: 'upscale & enhance an image with industry-leading AI (sharpen, denoise, recover detail)',
  desc: 'Topaz Gigapixel image enhancement. Uses your Topaz key. Runs on a source image.',
  keySource: 'tool_keys.topaz',
  docsUrl: 'https://developer.topazlabs.com/',
  setupHint: 'Generate or provide an image first, then run Topaz on it.',
  status: 'live',
  async run({ prompt, structuredInput, key, context, proxy }) {
    if (!key) throw new ToolError('topaz', 'missing_key', 'Topaz needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const sourceUrl = cfg.image_url || context?.sourceImageUrl
    if (!sourceUrl) throw new ToolError('topaz', 'no_source', 'Topaz needs a source image — generate or provide an image first.')
    const res = await proxy('topaz', { image_url: sourceUrl, model: cfg.model || 'Standard V2', output_height: cfg.output_height }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('topaz', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('topaz', 'bad_response', 'No enhanced image returned.')
    return { type: 'image', url: data.url, prompt: sourceUrl, tool: 'topaz', meta: { enhanced: true } }
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
  setup: {
    signupUrl: 'https://elevenlabs.io/sign-up', getKeyUrl: 'https://elevenlabs.io/app/settings/api-keys', billingUrl: 'https://elevenlabs.io/app/settings/billing',
    seeText: "Click '+ Create Key', set permissions, and copy it.",
    note: 'Free tier available; the key is shown only once.',
  },
  status: 'live',
  async run({ prompt, structuredInput, key, proxy, settings }) {
    if (!key) throw new ToolError('elevenlabs', 'missing_key', 'ElevenLabs needs an API key.')
    // Voice priority: explicit input.voice_id → user's narrator voice setting
    // → Rachel fallback. Lets builds say "narrate in my cloned voice" without
    // any plumbing.
    const cfg = typeof structuredInput === 'object' && structuredInput ? structuredInput : {}
    const voiceId = cfg.voice_id || settings?.narratorVoiceId || '21m00Tcm4TlvDq8ikWAM'
    const text = cfg.text || prompt || ''
    const res = await proxy('elevenlabs', { text: text.slice(0, 2500), voice_id: voiceId }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('elevenlabs', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.audio) throw new ToolError('elevenlabs', 'bad_response', 'ElevenLabs returned no audio.')
    return { type: 'audio', url: `data:audio/mpeg;base64,${data.audio}`, title: prompt.slice(0, 60), prompt, tool: 'elevenlabs' }
  },
}

const OPENAI_TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']

const openaiTts = {
  id: 'openai_tts',
  name: 'OpenAI TTS',
  category: 'audio_tts',
  capability: 'synthesize speech via OpenAI TTS — reliable, no proxy/IP issues, works when ElevenLabs free tier is blocked',
  desc: 'OpenAI text-to-speech (uses your OpenAI key). Voices: alloy, echo, fable, onyx, nova, shimmer.',
  keySource: 'agent.gpt',
  docsUrl: 'https://platform.openai.com/api-keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('openai_tts', 'missing_key', 'OpenAI TTS uses your OpenAI key — add it in Settings → Agents → ChatGPT.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const text = (cfg.text || prompt || '').slice(0, 4000)
    const voice = OPENAI_TTS_VOICES.includes(cfg.voice) ? cfg.voice : 'nova'
    const model = cfg.hd ? 'tts-1-hd' : 'tts-1'
    // Route through the worker proxy — api.openai.com sends no CORS headers, so
    // a direct browser fetch is blocked. The worker returns { audio: <base64> }.
    const res = await proxy('openai_tts', { text, voice, model }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('openai_tts', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.audio) throw new ToolError('openai_tts', 'bad_response', 'OpenAI TTS returned no audio.')
    return { type: 'audio', url: `data:audio/mpeg;base64,${data.audio}`, title: text.slice(0, 60), prompt: text, tool: 'openai_tts', meta: { voice, model } }
  },
}

// ── Transcription (speech-to-text) ────────────────────────────────
// These also power audio file attachments (see fileIngestion.js). As build
// tools they transcribe an audio URL; the run() returns the text for
// downstream steps. type:'transcript' is intentionally not a file type.

const whisper = {
  id: 'whisper',
  name: 'OpenAI Whisper',
  category: 'audio_tts',
  capability: 'transcribe an audio/video file or URL to text',
  desc: 'Speech-to-text via OpenAI Whisper. Uses your OpenAI key — also powers audio file attachments.',
  keySource: 'agent.gpt',
  docsUrl: 'https://platform.openai.com/api-keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('whisper', 'missing_key', 'Whisper uses your OpenAI key — add it in Settings → Agents → ChatGPT.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const audioUrl = cfg.audio_url || (typeof prompt === 'string' && prompt.startsWith('http') ? prompt : '')
    if (!audioUrl) throw new ToolError('whisper', 'no_source', 'Whisper needs an audio file URL (or attach an audio file in chat).')
    const res = await proxy('whisper', { audio_url: audioUrl }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('whisper', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (typeof data.text !== 'string') throw new ToolError('whisper', 'bad_response', 'No transcript returned.')
    return { type: 'transcript', text: data.text, prompt: audioUrl, tool: 'whisper' }
  },
}

const assemblyai = {
  id: 'assemblyai',
  name: 'AssemblyAI',
  category: 'audio_tts',
  capability: 'transcribe audio with speaker labels (diarization) — production-grade speech-to-text',
  desc: 'Speech-to-text with speaker labels via AssemblyAI. Uses your AssemblyAI key. Preferred for audio attachments when set.',
  keySource: 'tool_keys.assemblyai',
  docsUrl: 'https://www.assemblyai.com/app/api-keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('assemblyai', 'missing_key', 'AssemblyAI needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const audioUrl = cfg.audio_url || (typeof prompt === 'string' && prompt.startsWith('http') ? prompt : '')
    if (!audioUrl) throw new ToolError('assemblyai', 'no_source', 'AssemblyAI needs an audio file URL (or attach an audio file in chat).')
    const res = await proxy('assemblyai', { audio_url: audioUrl }, { Authorization: key })
    if (!res.ok) throw new ToolError('assemblyai', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (typeof data.text !== 'string') throw new ToolError('assemblyai', 'bad_response', 'No transcript returned.')
    return { type: 'transcript', text: data.text, speakers: data.speakers || [], prompt: audioUrl, tool: 'assemblyai' }
  },
}

// ── Music ─────────────────────────────────────────────────────────

const stableAudio = {
  id: 'stable_audio',
  name: 'Stable Audio 2.0',
  category: 'audio_music',
  capability: 'generate royalty-free instrumental music tracks up to 190 seconds (best for ads, video backing, ambient)',
  desc: 'Official Stability AI music API. Uses your Stability key. Commercial-use OK.',
  keySource: 'tool_keys.stability',
  keyPrefix: 'sk-',
  docsUrl: 'https://platform.stability.ai/account/keys',
  setupHint: 'Uses the same Stability key as Stable Diffusion 3 image generation.',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('stable_audio', 'missing_key', 'Stable Audio uses your Stability key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const duration = Math.max(1, Math.min(190, Number(cfg.duration) || 30))
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 1000)
    const res = await proxy('stable_audio', { prompt: realPrompt, duration }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('stable_audio', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.audio) throw new ToolError('stable_audio', 'bad_response', 'No audio returned.')
    return {
      type: 'audio',
      url: `data:audio/mpeg;base64,${data.audio}`,
      title: realPrompt.slice(0, 60),
      prompt: realPrompt,
      tool: 'stable_audio',
      meta: { duration, provider: 'stability' },
    }
  },
}

const elevenlabsMusic = {
  id: 'elevenlabs_music',
  name: 'ElevenLabs Music',
  category: 'audio_music',
  capability: 'generate music tracks up to 60 seconds with optional vocals — production quality, official API',
  desc: 'Official ElevenLabs music API. Uses your ElevenLabs key (same as voice).',
  keySource: 'tool_keys.elevenlabs',
  docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
  setupHint: 'Uses the same ElevenLabs key as voice/narration.',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('elevenlabs_music', 'missing_key', 'ElevenLabs Music uses your ElevenLabs key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const lengthMs = Math.max(3000, Math.min(60000, Number(cfg.length_ms) || 15000))
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 1000)
    const res = await proxy('elevenlabs_music', { prompt: realPrompt, music_length_ms: lengthMs }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('elevenlabs_music', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.audio) throw new ToolError('elevenlabs_music', 'bad_response', 'No audio returned.')
    return {
      type: 'audio',
      url: `data:audio/mpeg;base64,${data.audio}`,
      title: realPrompt.slice(0, 60),
      prompt: realPrompt,
      tool: 'elevenlabs_music',
      meta: { duration: lengthMs / 1000, provider: 'elevenlabs' },
    }
  },
}

const suno = {
  id: 'suno',
  name: 'Suno',
  category: 'audio_music',
  capability: 'generate full songs with vocals (third-party reseller API — unofficial, may be unreliable)',
  desc: 'Suno via third-party reseller. Suno has no official public API. Prefer Stable Audio or ElevenLabs Music for production use.',
  keySource: 'tool_keys.suno',
  setup: {
    signupUrl: 'https://suno.com/', billingUrl: 'https://suno.com/account',
    note: '⚠ Suno has no official public API or self-serve key page — API access is partner-beta / Premier-tier only. Any third-party key is unofficial.',
  },
  status: 'live',
  async run({ prompt, key, proxy }) {
    if (!key) throw new ToolError('suno', 'missing_key', 'Suno needs an API key.')
    const res = await proxy('suno', { prompt: prompt.slice(0, 500) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('suno', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('suno', 'bad_response', 'Suno returned no audio URL.')
    return {
      type: 'audio',
      url: data.url,
      title: data.title || prompt.slice(0, 60),
      prompt,
      tool: 'suno',
      meta: {
        duration: data.duration ?? null,  // seconds — useful for syncing to video
        tags: data.tags ?? null,
        lyrics: data.lyrics ?? null,
      },
    }
  },
}

// ── Video ─────────────────────────────────────────────────────────

const runway = {
  id: 'runway',
  name: 'Runway Gen-4',
  category: 'video',
  capability: 'generate short AI videos from text OR animate an existing image (5s or 10s, widescreen/portrait/square)',
  desc: 'AI video — text-to-video OR image-to-video. Use {image_url: ...} to animate an image.',
  keySource: 'tool_keys.runway',
  setup: {
    signupUrl: 'https://dev.runwayml.com/', getKeyUrl: 'https://dev.runwayml.com/', billingUrl: 'https://dev.runwayml.com/',
    seeText: "Create an org, open 'API Keys', create a key, and copy the key_… value.",
    note: '⚠ Use the developer portal dev.runwayml.com — NOT app.runwayml.com. API credits are separate from the web app and need a $10 min top-up.',
  },
  status: 'live',
  async run({ prompt, structuredInput, key, proxy, context }) {
    if (!key) throw new ToolError('runway', 'missing_key', 'Runway needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const body = {
      prompt: (cfg.prompt || prompt || '').slice(0, 900),
      duration: cfg.duration === 10 ? 10 : 5,
      ratio: ['1280:720', '768:1280', '960:960'].includes(cfg.ratio) ? cfg.ratio : '1280:720',
    }
    // image_url can come from explicit input or upstream context (e.g.
    // a DALL-E step that ran first and stashed its url in context).
    const imageUrl = cfg.image_url || context?.sourceImageUrl
    if (imageUrl) body.image_url = imageUrl

    const res = await proxy('runway', body, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('runway', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('runway', 'bad_response', 'Runway returned no video URL.')
    return {
      type: 'video',
      url: data.url,
      prompt: body.prompt,
      tool: 'runway',
      duration: data.duration,
      meta: { ratio: body.ratio, mode: imageUrl ? 'image_to_video' : 'text_to_video' },
    }
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
  setup: {
    signupUrl: 'https://www.perplexity.ai/settings/api', getKeyUrl: 'https://www.perplexity.ai/account/api/keys', billingUrl: 'https://www.perplexity.ai/account/api/billing',
    seeText: 'Add credits, then generate a key and copy it.',
    note: 'Keys stop working at $0 balance — enable auto-reload.',
  },
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
  setup: {
    signupUrl: 'https://app.tavily.com/home', getKeyUrl: 'https://app.tavily.com/home', billingUrl: 'https://app.tavily.com/account/plan',
    seeText: 'Your tvly-… key is shown in the API Keys section.',
    note: '1,000 free requests/month; no payment required to start.',
  },
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

const luma = {
  id: 'luma',
  name: 'Luma Dream Machine',
  category: 'video',
  capability: 'generate cinematic AI video from a text prompt (Ray 2) — 5 or 10 seconds, widescreen',
  desc: 'Text-to-video via Luma Ray 2. Uses your Luma key.',
  keySource: 'tool_keys.luma',
  keyPrefix: 'luma-',
  docsUrl: 'https://lumalabs.ai/dream-machine/api/keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('luma', 'missing_key', 'Luma needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 1000)
    const res = await proxy('luma', { prompt: realPrompt, duration: cfg.duration === 10 ? 10 : 5, resolution: cfg.resolution || '720p' }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('luma', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('luma', 'bad_response', 'No video returned.')
    return { type: 'video', url: data.url, title: realPrompt.slice(0, 60), prompt: realPrompt, tool: 'luma', meta: { provider: 'luma' } }
  },
}

const meshy = {
  id: 'meshy',
  name: 'Meshy 3D',
  category: 'image',
  capability: 'generate a 3D model (.glb) from a text prompt — for product mockups, game assets, 3D printing',
  desc: 'Text-to-3D model via Meshy. Uses your Meshy key.',
  keySource: 'tool_keys.meshy',
  keyPrefix: 'msy_',
  docsUrl: 'https://www.meshy.ai/api',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('meshy', 'missing_key', 'Meshy needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 600)
    const res = await proxy('meshy', { prompt: realPrompt, art_style: cfg.art_style || 'realistic' }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('meshy', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('meshy', 'bad_response', 'No model returned.')
    return { type: 'document', url: data.url, title: realPrompt.slice(0, 60), prompt: realPrompt, tool: 'meshy', meta: { format: 'glb', thumbnail: data.thumbnail || null } }
  },
}

const pika = {
  id: 'pika',
  name: 'Pika',
  category: 'video',
  capability: 'generate AI video from text (Pika 2.2, via fal.ai) — 5 or 10 seconds, up to 1080p',
  desc: 'Text-to-video via Pika 2.2 on fal.ai. Uses your fal.ai key (the same "fal-" key Flux uses).',
  keySource: 'tool_keys.pika',
  keyPrefix: 'fal-',
  docsUrl: 'https://fal.ai/dashboard/keys',
  setupHint: 'Pika runs on fal.ai — paste your fal.ai key (same one Flux uses).',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('pika', 'missing_key', 'Pika needs a fal.ai API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const realPrompt = (cfg.prompt || prompt || '').slice(0, 1000)
    const res = await proxy('pika', { prompt: realPrompt, duration: cfg.duration === 10 ? 10 : 5, aspect_ratio: cfg.aspect_ratio || '16:9', resolution: cfg.resolution || '720p' }, { Authorization: `Key ${key}` })
    if (!res.ok) throw new ToolError('pika', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('pika', 'bad_response', 'No video returned.')
    return { type: 'video', url: data.url, title: realPrompt.slice(0, 60), prompt: realPrompt, tool: 'pika', meta: { provider: 'pika' } }
  },
}

const heygen = {
  id: 'heygen',
  name: 'HeyGen',
  category: 'video',
  capability: 'generate a talking-avatar video from a script (requires an avatar_id and voice_id from your HeyGen account)',
  desc: 'Talking-avatar video via HeyGen. Needs your HeyGen key plus an avatar_id and voice_id.',
  keySource: 'tool_keys.heygen',
  docsUrl: 'https://app.heygen.com/settings?nav=API',
  setupHint: 'Needs an avatar_id and voice_id from your HeyGen account — find them in the HeyGen dashboard.',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('heygen', 'missing_key', 'HeyGen needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    if (!cfg.avatar_id || !cfg.voice_id) throw new ToolError('heygen', 'missing_config', 'HeyGen needs an avatar_id and voice_id from your HeyGen account.')
    const script = (cfg.input_text || cfg.script || prompt || '').slice(0, 1500)
    const res = await proxy('heygen', { avatar_id: cfg.avatar_id, voice_id: cfg.voice_id, input_text: script }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('heygen', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('heygen', 'bad_response', 'No video returned.')
    return { type: 'video', url: data.url, title: script.slice(0, 60), prompt: script, tool: 'heygen', meta: { provider: 'heygen' } }
  },
}

const videoRender = {
  id: 'video_render',
  name: 'Video Render (Shotstack)',
  category: 'video',
  capability: 'stitch clips + images + audio into one finished MP4 — the final ad-assembly step (the stitcher)',
  desc: 'Assemble clips/images/a soundtrack into a rendered MP4 via Shotstack. Uses your Shotstack key.',
  keySource: 'tool_keys.shotstack',
  docsUrl: 'https://dashboard.shotstack.io/keys',
  status: 'live',
  async run({ structuredInput, key, proxy }) {
    if (!key) throw new ToolError('video_render', 'missing_key', 'Video Render needs a Shotstack API key.')
    const cfg = (typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput) || {}
    const clips = Array.isArray(cfg.clips) ? cfg.clips : []
    if (!clips.length) throw new ToolError('video_render', 'no_clips', 'Provide clips: [{ url, type?, length? }] to render.')
    let cursor = 0
    const trackClips = clips.map(c => {
      const isImg = c.type === 'image' || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c.url || '')
      const length = Number(c.length) || (isImg ? 4 : 5)
      const clip = { asset: { type: isImg ? 'image' : 'video', src: c.url }, start: cursor, length }
      cursor += length
      return clip
    })
    const timeline = { background: '#000000', tracks: [{ clips: trackClips }] }
    if (cfg.soundtrack) timeline.soundtrack = { src: cfg.soundtrack, effect: 'fadeOut' }
    const output = { format: 'mp4', size: cfg.size || { width: 1280, height: 720 } }
    const res = await proxy('shotstack', { timeline, output }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('video_render', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    if (!data.url) throw new ToolError('video_render', 'bad_response', 'No rendered video URL returned.')
    return { type: 'video', url: data.url, title: 'rendered-video', tool: 'video_render', meta: { durationSec: cursor, clips: clips.length } }
  },
}

// CapCut hand-off bundle. CapCut has NO public render API and its draft format
// is undocumented/version-fragile, so we do NOT fabricate a draft. Instead this
// produces a reliable .zip: a timeline.json edit-plan (clip order, durations,
// soundtrack) + import instructions referencing the asset URLs. Browser-side,
// no key. Use video_render for a finished MP4; use this to hand-edit in CapCut.
const capcutBundle = {
  id: 'capcut_bundle',
  name: 'CapCut Export (.zip)',
  category: 'video',
  capability: 'package clips + audio + a timeline edit-plan into a .zip for hand-assembly in CapCut',
  desc: 'Downloadable .zip (timeline.json + import steps) to rebuild the cut in CapCut. No render API exists — this is an edit-plan, not a finished video.',
  keySource: null,
  status: 'live',
  setupHint: 'CapCut has no public render API, so this is an edit-plan (clip order, timings, asset links) you import into CapCut — not a finished video. For a ready MP4, use Video Render.',
  async run({ structuredInput, label }) {
    const { default: JSZip } = await import('jszip')
    const cfg = (typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput) || {}
    const clips = Array.isArray(cfg.clips) ? cfg.clips : []
    if (!clips.length) throw new ToolError('capcut_bundle', 'no_clips', 'Provide clips: [{ url, type?, length? }].')
    let cursor = 0
    const timeline = clips.map((c, i) => {
      const isImg = c.type === 'image' || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(c.url || '')
      const length = Number(c.length) || (isImg ? 4 : 5)
      const seg = { order: i + 1, src: c.url, type: isImg ? 'image' : 'video', start_sec: cursor, length_sec: length }
      cursor += length
      return seg
    })
    const manifest = { fps: 30, size: cfg.size || { width: 1280, height: 720 }, soundtrack: cfg.soundtrack || null, total_seconds: cursor, clips: timeline }
    const readme = [
      'CapCut assembly bundle',
      '======================',
      '',
      'CapCut has no public API to build a project automatically, so this is an',
      'edit-plan, not a finished video. To assemble in CapCut:',
      '',
      '1. Open CapCut → New project.',
      '2. Import the media at the URLs listed in timeline.json (download each first).',
      '3. Drop the clips on the timeline in `order`, each trimmed to `length_sec`.',
      `4. Add the soundtrack (${manifest.soundtrack || 'none'}) on an audio track from 0s.`,
      `5. Total runtime: ~${cursor}s. Canvas: ${manifest.size.width}x${manifest.size.height}.`,
      '',
      'Tip: for a fully-rendered MP4 with no manual steps, use the Video Render',
      '(Shotstack) tool instead.',
    ].join('\n')
    const zip = new JSZip()
    zip.file('timeline.json', JSON.stringify(manifest, null, 2))
    zip.file('README.txt', readme)
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    const url = URL.createObjectURL(blob)
    return { type: 'document', url, filename: `${(label || 'capcut-bundle').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'capcut-bundle'}.zip`, tool: 'capcut_bundle', meta: { clips: clips.length, totalSeconds: cursor } }
  },
}

const exa = {
  id: 'exa',
  name: 'Exa.ai',
  category: 'search',
  capability: 'semantic web search built for AI agents — returns page contents, not just links',
  desc: 'Semantic web search with full page text. Uses your Exa key.',
  keySource: 'tool_keys.exa',
  docsUrl: 'https://dashboard.exa.ai/api-keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('exa', 'missing_key', 'Exa needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const query = (cfg.query || prompt || '').slice(0, 1000)
    const res = await proxy('exa', { query, numResults: cfg.numResults || 5 }, { 'x-api-key': key })
    if (!res.ok) throw new ToolError('exa', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const results = data.results || []
    const text = results.map(r => `${r.title || r.url}: ${r.text || (r.highlights || []).join(' ')}`).join('\n\n')
    if (!text) throw new ToolError('exa', 'bad_response', 'No results.')
    return { type: 'search', text, citations: results.map(r => ({ title: r.title, url: r.url })), tool: 'exa' }
  },
}

const firecrawl = {
  id: 'firecrawl',
  name: 'Firecrawl',
  category: 'search',
  capability: 'turn any URL into clean markdown the panel can read',
  desc: 'Scrape a web page to clean markdown. Uses your Firecrawl key.',
  keySource: 'tool_keys.firecrawl',
  keyPrefix: 'fc-',
  docsUrl: 'https://www.firecrawl.dev/app/api-keys',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key) throw new ToolError('firecrawl', 'missing_key', 'Firecrawl needs an API key.')
    const cfg = (typeof structuredInput === 'object' && structuredInput) || {}
    const url = (cfg.url || prompt || '').trim()
    if (!url) throw new ToolError('firecrawl', 'no_url', 'Firecrawl needs a URL to scrape.')
    const res = await proxy('firecrawl', { url }, { Authorization: `Bearer ${key}` })
    if (!res.ok) throw new ToolError('firecrawl', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const md = data?.data?.markdown
    if (!md) throw new ToolError('firecrawl', 'bad_response', 'No content returned.')
    return { type: 'search', text: md, citations: [{ title: data.data?.metadata?.title || url, url }], tool: 'firecrawl' }
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
  async run({ prompt, settings, outputSchema, brandContext }) {
    // Pick whichever orchestration model the user has — Claude → GPT → Gemini → Grok
    const cfg =
      settings?.agents?.claude?.key ? { provider: 'claude', key: settings.agents.claude.key } :
      settings?.agents?.gpt?.key    ? { provider: 'gpt',    key: settings.agents.gpt.key } :
      settings?.agents?.gemini?.key ? { provider: 'gemini', key: settings.agents.gemini.key } :
      settings?.agents?.grok?.key   ? { provider: 'grok',   key: settings.agents.grok.key } :
      null
    if (!cfg) throw new ToolError('agent_synth', 'no_model', 'No orchestration model available — add a Claude, GPT, Gemini, or Grok key.')

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
      : outputSchema === 'storyboard'
      ? `\nReturn JSON of this exact shape: {"scenes":[{"id":1,"title":"short scene label","prompt":"a vivid, photoreal image-generation prompt describing the SHOT for this scene","duration_sec":5,"on_screen_text":"optional short text overlay"}, ...], "voiceover_script":"the spoken ad copy"}.
The "prompt" fields drive an image generator — they are visual descriptions of what's on screen.
The "voiceover_script" is the OPPOSITE: it is what a narrator SPEAKS over the ad. It MUST be persuasive marketing copy that sells the product to a viewer — NOT a description of what's on screen, and NOT the scene prompts concatenated. Write it as pure spoken language: no scene labels, no stage directions, no "[VO]:" tags. Pace it for the total duration at ~150 words/minute (a 30-second ad ≈ 75 words).
WRONG voiceover_script: "Scene 1 shows a person frustrated at multiple browser tabs. The screen then splits into four panels."
RIGHT voiceover_script: "Stop juggling four AI tools. Agent Interface gives you Claude, ChatGPT, Gemini, and Grok — working together, debating each other, building real files. One interface. All your AI."`
      : `\nReturn clean JSON only — no markdown fences, no prose around it.`

    // Brand context (from the active project's brief, or one pasted into the
    // message) is prepended as authoritative source material so the panel writes
    // ON-brand instead of inventing the product. The build gate guarantees this
    // is present for any brand-facing build; for neutral builds it's empty.
    const brandBlock = brandContext
      ? `BRAND CONTEXT — the output MUST align to this. Use ONLY these facts about the product/brand; do NOT invent its market, audience, features, or backstory beyond what's stated here:\n${String(brandContext).slice(0, 2000)}\n\n`
      : ''
    const fullPrompt = `${brandBlock}${prompt}${schemaHint}`

    // Worker requires the Supabase auth header — same shape the
    // orchestrator uses. Without it, the Worker returns 401.
    const { supabase } = await import('../utils/supabase')
    const { data: { session } } = await supabase.auth.getSession()
    const supaAuth = session?.access_token
      ? { 'x-supabase-auth': `Bearer ${session.access_token}` }
      : {}

    // Hard ceiling per attempt. Without it a hung proxy/socket leaves the
    // build step stuck on ◐ "in progress" indefinitely (observed: 16 min) —
    // tool.run() neither resolves nor rejects, so runBuild never emits
    // done/failed. AbortController guarantees the call returns within the
    // window so a hang surfaces as a timeout error in the build card.
    const SYNTH_TIMEOUT_MS = 90_000

    // Assemble a streamed SSE response into plain text. The worker streams
    // /gpt, /grok (OpenAI delta format) and /gemini (candidates parts). Without
    // this, res.text() returns the raw `data: {…}` FRAMES — the JSON extractor
    // then grabs the SSE envelope's `{`, not the model's output, so every
    // non-Claude build produced malformed JSON. (Claude's /claude route is
    // non-streaming, which is why this stayed hidden.)
    const sseToText = async (res, kind) => {
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
          } catch { /* partial frame — next read completes it */ }
        }
      }
      return full
    }

    // One provider call. Returns the assembled text; throws an Error with
    // .status on HTTP failure so the retry loop can decide whether to try again.
    // A timeout aborts and throws an error flagged `.timeout` (no .status),
    // which the retry loop treats as non-transient so it fails fast.
    const callOnce = async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), SYNTH_TIMEOUT_MS)
      try {
        if (cfg.provider === 'claude') {
          const res = await fetch(`${PROXY}/claude`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, ...supaAuth },
            signal: ctrl.signal,
            // 4K fits any outline (slides[] or sections[]) and finishes
            // well inside Cloudflare's ~100s wall. 8K gens were hitting
            // 524 timeouts in real testing.
            body: JSON.stringify({ model: modelFor('claude'), messages: [{ role: 'user', content: fullPrompt }], max_tokens: 4096 }),
          })
          if (!res.ok) { const e = new Error(`claude_${res.status}`); e.status = res.status; throw e }
          const data = await res.json()
          return data.content?.[0]?.text || ''
        } else if (cfg.provider === 'gpt' || cfg.provider === 'grok') {
          // GPT and Grok are OpenAI-wire-compatible — same Bearer auth + delta
          // SSE; only the route differs.
          const res = await fetch(`${PROXY}/${cfg.provider}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}`, ...supaAuth },
            signal: ctrl.signal,
            body: JSON.stringify({ model: modelFor(cfg.provider), messages: [{ role: 'user', content: fullPrompt }], max_tokens: 4096 }),
          })
          if (!res.ok) { const e = new Error(`${cfg.provider}_${res.status}`); e.status = res.status; throw e }
          return sseToText(res, 'gpt')
        } else {
          const res = await fetch(`${PROXY}/gemini`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, ...supaAuth },
            signal: ctrl.signal,
            body: JSON.stringify({
              model: modelFor('gemini'),
              contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
              generationConfig: { maxOutputTokens: 4096 },
            }),
          })
          if (!res.ok) { const e = new Error(`gemini_${res.status}`); e.status = res.status; throw e }
          return sseToText(res, 'gemini')
        }
      } catch (e) {
        if (e?.name === 'AbortError') { const te = new Error('synth_timeout_90s'); te.timeout = true; throw te }
        throw e
      } finally {
        clearTimeout(timer)
      }
    }

    // Retry transient failures up to 3x with backoff. Cloudflare 524
    // (timeout), 529 (overloaded), and 5xx upstream blips are usually
    // self-healing within a few seconds. Hard errors (auth, bad request)
    // and timeouts fail fast.
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
        if (e.timeout || !TRANSIENT.has(e.status)) break
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
    if (lastErr) {
      const friendly = lastErr.timeout
        ? 'the model took over 90s and was stopped — try again'
        : (lastErr.status === 524 || lastErr.status === 529)
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
// Pull {mime, b64, filename} out of an inline data: URL (what the build pipeline
// produces). Handles both base64 data URLs (.pptx/.docx) and text ones (.md).
function _gmailPart(att) {
  const url = att?.url || att?.savedLink
  const filename = att?.filename || 'attachment'
  const m = typeof url === 'string' && /^data:([^,]*),(.*)$/s.exec(url)
  if (!m) return null
  const meta = m[1] || ''
  const mime = (meta.split(';')[0] || '').trim() || 'application/octet-stream'
  const b64 = /;base64/i.test(meta) ? m[2] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[2]))))
  return { mime, b64, filename }
}
function _gmailParts(attachments) {
  const out = []
  for (const a of (Array.isArray(attachments) ? attachments : [])) {
    if (!a) continue
    if (Array.isArray(a.files)) { for (const f of a.files) { const p = _gmailPart(f); if (p) out.push(p) } }
    else { const p = _gmailPart(a); if (p) out.push(p) }
  }
  return out
}

// Build the base64url-encoded RFC 2822 message for the Gmail API. multipart/mixed
// with real base64 attachment parts when there are attachments, else text/plain.
// Exported for testing.
export function buildGmailRaw({ to, subject, body = '', attachments = [] }) {
  const parts = _gmailParts(attachments)
  let mime
  if (!parts.length) {
    mime = [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n')
  } else {
    const boundary = `aibnd_${parts.length}_${(body || '').length}_${parts[0].b64.length}`
    const lines = [
      `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', body,
    ]
    for (const p of parts) {
      lines.push('', `--${boundary}`,
        `Content-Type: ${p.mime}; name="${p.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${p.filename}"`,
        '', p.b64)
    }
    lines.push('', `--${boundary}--`)
    mime = lines.join('\r\n')
  }
  return btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const gmail = {
  id: 'gmail',
  name: 'Email (Gmail)',
  category: 'action',
  capability: 'send an email through the user\'s own Gmail, with the build\'s files as real attachments',
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

    // Input may be a structured object {to, subject, body, attachments} OR a
    // JSON string (interpolation produces a string), OR plain prose. Parse all.
    let input = structuredInput
    if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = { body: input } } }
    if (!input || typeof input !== 'object') input = { body: prompt || '' }

    const to = input.to
    const subject = input.subject || 'From your Agent Interface panel'
    const body = input.body || prompt || ''
    const attachments = Array.isArray(input.attachments)
      ? input.attachments
      : (input.attachment ? [input.attachment] : [])

    if (!to) throw new ToolError('gmail', 'no_recipient', 'No recipient email specified.')

    const attachedCount = _gmailParts(attachments).length
    const raw = buildGmailRaw({ to, subject, body, attachments })

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
      summary: `Email sent to ${to}${attachedCount ? ` with ${attachedCount} attachment${attachedCount === 1 ? '' : 's'}` : ''}`,
      meta: { messageId: data.id, threadId: data.threadId, to, subject, attachments: attachedCount },
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
      // Human-readable content (no YAML frontmatter) so the build card can
      // preview it inline — otherwise a one-step text deliverable like an IG
      // caption is only readable by opening the saved .md in Drive.
      text: `# ${title}\n\n${body}\n`,
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

// Image-provider fallback chain. DALL-E is the default; if it fails for a
// transient/account reason (billing hard-limit, quota/429, content policy,
// org verification) we transparently try the OTHER providers the user has
// keys for — Stable Diffusion → Flux → Ideogram → Recraft — so one provider
// being down or out of credit doesn't kill an image step (the failure mode
// that produced empty ad/deck builds tonight). Providers without a key are
// skipped. Returns the first successful { type:'image', url, ... } tagged with
// the provider that produced it; throws a combined ToolError if every
// available provider fails.
const IMAGE_PROVIDER_ORDER = ['dalle', 'stability', 'flux', 'ideogram', 'recraft']

async function generateImageWithFallback({ prompt, structuredInput, settings, proxy }) {
  const errors = []
  let anyKey = false
  for (const id of IMAGE_PROVIDER_ORDER) {
    const tool = TOOLS_BY_ID[id]
    const key = readKey(settings, tool?.keySource)
    if (!key) continue
    anyKey = true
    try {
      // Route DALL-E through the raw single-call so we don't recurse into the
      // dalle tool's run() (which itself delegates here). Other providers have
      // no fallback wrapper, so calling their run() directly is safe.
      const out = id === 'dalle'
        ? await dalleGenerateOnce({ prompt, structuredInput, key, proxy })
        : await tool.run({ prompt, structuredInput, key, proxy, settings })
      if (out?.url) return { ...out, provider: id, fellBackFrom: errors.map(e => e.id) }
      errors.push({ id, error: 'no image returned' })
    } catch (e) {
      errors.push({ id, error: e?.message || String(e) })
    }
  }
  const reason = !anyKey
    ? 'no image provider key configured (add OpenAI, Stability, Flux, Ideogram, or Recraft in Settings)'
    : errors.map(e => `${e.id}: ${e.error}`).join(' | ')
  throw new ToolError('image_per_slide', 'all_providers_failed', reason)
}

// ── image_per_slide — one image per slide, with provider fallback ─────────
// Same pattern as narrate_per_slide: takes slides[] and produces N
// images (one per slide). Saves a bundle so downstream steps can sync
// them with pptxgen or video tools. Each slide runs through
// generateImageWithFallback (DALL-E → SD → Flux → Ideogram → Recraft).
//
// Input: { slides: [{title, prompt?}], style?, size? }
//   - If a slide has its own 'prompt', use it.
//   - Otherwise derive from title + global 'style' hint.
//   - size: 'square'|'wide'|'tall' (default 'wide' for slide covers)
const imagePerSlide = {
  id: 'image_per_slide',
  name: 'Per-slide images',
  category: 'image',
  capability: 'generate one image per slide — N images in a bundle, ready to sync with a deck',
  desc: 'Uses your OpenAI key. Returns N images saved together in the build folder.',
  keySource: 'agent.gpt',
  status: 'live',
  hidden: true,
  async run({ structuredInput, key, proxy, settings }) {
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const slides = Array.isArray(data?.slides) ? data.slides : []
    if (slides.length === 0) throw new ToolError('image_per_slide', 'no_slides', 'No slides to illustrate.')

    const style = data?.style || 'clean, modern, editorial photography'
    const size = normalizeDalleSize(data?.size || 'wide')
    // The fallback reads each provider's key from settings. Inside a build,
    // buildExecutor passes the full settings; if only the bare OpenAI `key` is
    // supplied (standalone use), synthesize a minimal settings so DALL-E works.
    const effSettings = settings || { agents: { gpt: { key } } }

    const providersUsed = new Set()
    const files = []
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      const promptText = (s.prompt || `${s.title || 'cover image'}. Style: ${style}`).slice(0, 900)
      try {
        // Multi-provider fallback (PR #32): DALL-E → stability → flux → ideogram
        // → recraft, first success wins. The DALL-E provider calls proxy('dalle'),
        // which the worker now translates to dall-e-3 (PR #30) — so this inherits
        // the org-verification fix AND survives a single provider being broke.
        const out = await generateImageWithFallback({
          prompt: promptText,
          structuredInput: { prompt: promptText, size, quality: 'high' },
          settings: effSettings,
          proxy,
        })
        providersUsed.add(out.provider)
        files.push({ url: out.url, filename: `slide-${String(i + 1).padStart(2, '0')}.png`, prompt: promptText, provider: out.provider })
      } catch (e) {
        files.push({ error: e.message || 'unknown', filename: `slide-${i + 1}.png` })
      }
    }
    const successful = files.filter(f => !f.error).length
    if (successful === 0) {
      const reasons = [...new Set(files.map(f => f.error).filter(Boolean))].join(' | ')
      throw new ToolError('image_per_slide', 'bad_response', `No images generated — ${reasons || 'unknown error'}`)
    }

    return {
      type: 'image_bundle',
      tool: 'image_per_slide',
      files,
      meta: { slideCount: slides.length, successful, failed: slides.length - successful, size, style, providers: [...providersUsed] },
    }
  },
}

// ── Twilio SMS — send a text from the user's Twilio number ────────
// Twilio needs two credentials: Account SID + Auth Token. To avoid
// a second key field per-tool, users paste them concatenated in the
// key slot: "AC<account_sid>:<auth_token>". The tool splits and
// forwards both as Basic auth.
const twilio = {
  id: 'twilio',
  name: 'Twilio SMS',
  category: 'action',
  capability: 'send an SMS to a phone number (incl. the user\'s own) — useful for "text the link when done"',
  desc: 'Sends SMS via your Twilio account. Paste credentials as AC<sid>:<auth_token>.',
  keySource: 'tool_keys.twilio',
  keyPrefix: 'AC',
  setup: {
    signupUrl: 'https://www.twilio.com/try-twilio', getKeyUrl: 'https://console.twilio.com/us1/account/keys-credentials/api-keys', billingUrl: 'https://console.twilio.com/us1/billing/manage-billing/billing-overview',
    seeText: 'Copy your Account SID + Auth Token from the console, or create an API key.',
    note: 'Add funds before sending; prefer an API key over the raw Auth Token in production.',
  },
  setupHint: 'In Twilio Console copy your Account SID (starts with AC...) and Auth Token. Paste them here joined with a colon: "AC123...:authtoken123...". Also set your Twilio phone number in the build input as {from:"+15551234567"}.',
  status: 'live',
  async run({ structuredInput, prompt, key, proxy }) {
    if (!key || !key.includes(':')) {
      throw new ToolError('twilio', 'missing_key', 'Twilio needs credentials as "AC<sid>:<auth_token>".')
    }
    const data = (typeof structuredInput === 'object' && structuredInput) || {}
    const to = data.to
    const from = data.from
    const body = data.body || prompt || ''
    if (!to) throw new ToolError('twilio', 'no_recipient', 'SMS needs a "to" phone number in E.164 format (e.g. +15551234567).')
    if (!from) throw new ToolError('twilio', 'no_sender', 'SMS needs a "from" — one of your Twilio numbers in E.164 format.')
    if (!body.trim()) throw new ToolError('twilio', 'no_body', 'SMS body is empty.')

    const res = await proxy('twilio', { to, from, body }, { 'x-twilio-creds': key })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      if (res.status === 401) {
        throw new ToolError('twilio', 'bad_token', 'Twilio rejected your credentials. Re-copy from Console.')
      }
      throw new ToolError('twilio', 'bad_response', `Twilio returned ${res.status}: ${t.slice(0, 200)}`)
    }
    const json = await res.json()
    return {
      type: 'action',
      tool: 'twilio',
      summary: `SMS sent to ${to}`,
      meta: { sid: json.sid, status: json.status, from, to },
    }
  },
}

// ── Stripe Payment Link — create a one-off payment link ───────────
// Single key (Stripe secret key). No Worker route — Stripe's REST
// API takes Bearer auth, so we call it directly. Creates a Payment
// Link with an inline Product + Price so the user doesn't need to
// pre-create products in their Stripe dashboard.
const stripe = {
  id: 'stripe',
  name: 'Stripe payment link',
  category: 'action',
  capability: 'create a Stripe payment link for one-off charges (amount, currency, product name) — returns a shareable checkout URL',
  desc: 'Uses your Stripe secret key. Creates a one-off Product + Price + Payment Link in one call.',
  keySource: 'tool_keys.stripe',
  keyPrefix: 'sk_',
  setup: {
    signupUrl: 'https://dashboard.stripe.com/register', getKeyUrl: 'https://dashboard.stripe.com/apikeys', billingUrl: 'https://dashboard.stripe.com/settings/billing',
    seeText: 'Copy the Publishable (pk_…) and reveal the Secret (sk_…) key; toggle test/live at the top.',
    note: 'No prepaid credits needed; the live-mode secret key is shown only once.',
  },
  setupHint: 'Use a TEST key (sk_test_...) until you\'re ready to take real money. Live keys (sk_live_...) charge real cards.',
  status: 'live',
  async run({ structuredInput, key }) {
    if (!key || !key.startsWith('sk_')) {
      throw new ToolError('stripe', 'missing_key', 'Stripe needs a secret key (starts with sk_).')
    }
    const data = (typeof structuredInput === 'object' && structuredInput) || {}
    const name = data.name || data.product_name || 'Payment'
    const amount = Number(data.amount)
    const currency = (data.currency || 'usd').toLowerCase()
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ToolError('stripe', 'bad_amount', 'Stripe needs an "amount" in dollars (e.g. 49.99) or cents (e.g. 4999). Use one consistently.')
    }
    // Accept dollars (49.99) or cents (4999). Integers >= 1000 are
    // treated as cents; decimals or smaller integers as dollars.
    const unitAmountCents = Number.isInteger(amount) && amount >= 1000
      ? amount
      : Math.round(amount * 100)

    // Stripe wants form-encoded bodies, not JSON.
    const post = async (path, form) => {
      const res = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      return res
    }

    const productForm = new URLSearchParams()
    productForm.set('name', name.slice(0, 250))
    if (data.description) productForm.set('description', String(data.description).slice(0, 500))
    const prodRes = await post('products', productForm)
    if (!prodRes.ok) {
      const t = await prodRes.text().catch(() => '')
      if (prodRes.status === 401) throw new ToolError('stripe', 'bad_token', 'Stripe rejected your key.')
      throw new ToolError('stripe', 'bad_response', `Stripe (product) ${prodRes.status}: ${t.slice(0, 200)}`)
    }
    const product = await prodRes.json()

    const priceForm = new URLSearchParams()
    priceForm.set('product', product.id)
    priceForm.set('currency', currency)
    priceForm.set('unit_amount', String(unitAmountCents))
    const priceRes = await post('prices', priceForm)
    if (!priceRes.ok) {
      const t = await priceRes.text().catch(() => '')
      throw new ToolError('stripe', 'bad_response', `Stripe (price) ${priceRes.status}: ${t.slice(0, 200)}`)
    }
    const price = await priceRes.json()

    const linkForm = new URLSearchParams()
    linkForm.set('line_items[0][price]', price.id)
    linkForm.set('line_items[0][quantity]', '1')
    if (data.after_completion_url) {
      linkForm.set('after_completion[type]', 'redirect')
      linkForm.set('after_completion[redirect][url]', data.after_completion_url)
    }
    const linkRes = await post('payment_links', linkForm)
    if (!linkRes.ok) {
      const t = await linkRes.text().catch(() => '')
      throw new ToolError('stripe', 'bad_response', `Stripe (link) ${linkRes.status}: ${t.slice(0, 200)}`)
    }
    const link = await linkRes.json()
    const isTest = key.startsWith('sk_test_')
    return {
      type: 'action',
      tool: 'stripe',
      summary: `Stripe payment link created — ${currency.toUpperCase()} ${(unitAmountCents / 100).toFixed(2)}${isTest ? ' (TEST mode)' : ''}`,
      link: link.url,
      meta: { paymentLinkId: link.id, productId: product.id, priceId: price.id, amountCents: unitAmountCents, currency, mode: isTest ? 'test' : 'live' },
    }
  },
}

// ── Notion — create a page in a user's Notion workspace ───────────
// Uses an "Internal Integration" token (no OAuth dance): user goes to
// notion.com/my-integrations → New integration → copies the token →
// pastes it in Settings, then shares the parent page/database with the
// integration in Notion's UI.
//
// Input: { parentPageId | parentDatabaseId, title, sections: [{heading, body}] }
const notion = {
  id: 'notion',
  name: 'Notion page',
  category: 'action',
  capability: 'create a Notion page in a parent page or database (writes title + sections as headings+paragraphs)',
  desc: 'Uses an Internal Integration token. Share the parent page with your integration after pasting the token.',
  keySource: 'tool_keys.notion',
  keyPrefix: 'ntn_',
  setup: {
    signupUrl: 'https://www.notion.so/signup', getKeyUrl: 'https://www.notion.so/my-integrations',
    seeText: "Click '+ New integration', choose Internal, then copy the Internal Integration Token.",
    note: 'Free — but you must separately share each target page/database with the integration.',
  },
  setupHint: 'Create an integration at notion.com/my-integrations, paste the token here, then SHARE the target parent page/database with your integration in Notion (Share menu → invite your integration by name). Otherwise Notion returns "object not found".',
  status: 'live',
  async run({ structuredInput, key }) {
    if (!key) throw new ToolError('notion', 'missing_key', 'Notion needs an Integration token.')
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const parentPageId = data?.parentPageId || data?.parent_page_id
    const parentDatabaseId = data?.parentDatabaseId || data?.parent_database_id
    if (!parentPageId && !parentDatabaseId) {
      throw new ToolError('notion', 'no_parent', 'Notion needs parentPageId or parentDatabaseId — copy the ID from the parent page URL.')
    }
    const title = data?.title || 'Untitled'
    const sections = Array.isArray(data?.sections) ? data.sections : []

    const parent = parentDatabaseId
      ? { database_id: parentDatabaseId }
      : { page_id: parentPageId }

    // Property shape differs: database has structured "Name" property,
    // child-page has title. Try database shape if database id given.
    const properties = parentDatabaseId
      ? { Name: { title: [{ text: { content: title.slice(0, 200) } }] } }
      : { title: [{ text: { content: title.slice(0, 200) } }] }

    // Flatten sections into Notion blocks: heading_2 + paragraph(s).
    // Notion's max is 100 blocks per create; we cap at 90 to leave slack.
    const blocks = []
    for (const s of sections) {
      if (s?.heading) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: String(s.heading).slice(0, 2000) } }] },
        })
      }
      if (s?.body) {
        // Notion paragraphs cap at 2000 chars per rich_text. Split long bodies.
        const chunks = String(s.body).match(/[\s\S]{1,1900}/g) || []
        for (const chunk of chunks) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
          })
        }
      }
      if (Array.isArray(s?.items)) {
        for (const item of s.items.slice(0, 30)) {
          blocks.push({
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ type: 'text', text: { content: String(item).slice(0, 1900) } }] },
          })
        }
      }
      if (blocks.length >= 90) break
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ parent, properties, children: blocks }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      if (res.status === 404) {
        throw new ToolError('notion', 'no_parent', 'Notion can\'t find that parent — make sure you SHARED the parent page with your integration (Notion → Share menu → invite by integration name).')
      }
      if (res.status === 401) {
        throw new ToolError('notion', 'bad_token', 'Notion rejected the token. Re-copy from notion.com/my-integrations.')
      }
      throw new ToolError('notion', 'bad_response', `Notion returned ${res.status}: ${t.slice(0, 200)}`)
    }
    const created = await res.json()
    return {
      type: 'action',
      tool: 'notion',
      summary: `Notion page "${title}" created`,
      link: created.url,
      meta: { pageId: created.id, blocksWritten: blocks.length, title },
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
  async run({ structuredInput, key, proxy, settings }) {
    const data = typeof structuredInput === 'string' ? JSON.parse(structuredInput) : structuredInput
    const slides = data?.slides || []
    if (slides.length === 0) throw new ToolError('narrate_per_slide', 'no_slides', 'No slides to narrate.')

    // provider: 'elevenlabs' (default) | 'openai'. ElevenLabs uses the
    // tool_keys.elevenlabs key passed in as `key`; OpenAI uses the user's
    // ChatGPT key from settings (no proxy — direct, avoids IP/geo blocks).
    const provider = data?.provider === 'openai' ? 'openai' : 'elevenlabs'
    const oaKey = settings?.agents?.gpt?.key || null
    if (provider === 'elevenlabs' && !key) throw new ToolError('narrate_per_slide', 'missing_key', 'ElevenLabs needs an API key.')
    if (provider === 'openai' && !oaKey) throw new ToolError('narrate_per_slide', 'missing_key', 'OpenAI TTS uses your OpenAI key — add it in Settings → Agents → ChatGPT.')

    // Voice priority: explicit input → user's narrator voice setting → Rachel
    const voiceId = data?.voice_id || settings?.narratorVoiceId || '21m00Tcm4TlvDq8ikWAM'
    const oaVoice = OPENAI_TTS_VOICES.includes(data?.voice) ? data.voice : 'nova'
    const files = []
    let cumulativeSec = 0
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]
      const text = s.notes || `${s.title || ''}. ${(s.bullets || []).join('. ')}`
      const safe = text.slice(0, 2500).trim()
      if (!safe) continue

      let audioB64 = null
      let errLabel = null
      if (provider === 'openai') {
        const res = await proxy('openai_tts', { text: safe, voice: oaVoice, model: 'tts-1' }, { Authorization: `Bearer ${oaKey}` })
        if (!res.ok) errLabel = `openai_${res.status}`
        else {
          const payload = await res.json()
          if (!payload.audio) errLabel = 'no_audio'
          else audioB64 = payload.audio
        }
      } else {
        const res = await proxy('elevenlabs', { text: safe, voice_id: voiceId }, { 'x-api-key': key })
        if (!res.ok) errLabel = `elevenlabs_${res.status}`
        else {
          const payload = await res.json()
          if (!payload.audio) errLabel = 'no_audio'
          else audioB64 = payload.audio
        }
      }
      if (errLabel) { files.push({ slideIndex: i + 1, error: errLabel }); continue }

      // Rough duration estimate: ~150 words/min, ~5 chars/word → ~12.5 chars/sec
      const estSec = Math.max(2, Math.round(safe.length / 12.5))
      files.push({
        slideIndex: i + 1,
        url: `data:audio/mpeg;base64,${audioB64}`,
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
      provider,
    }
  },
}

// ── Reddit — submit a post to a subreddit (OAuth via Storage tab) ─
const redditPost = {
  id: 'reddit_post',
  name: 'Reddit',
  category: 'action',
  capability: 'submit a post to a subreddit (subreddit + title + body text, or a link) via the user\'s connected Reddit account',
  desc: 'Post to a subreddit using your connected Reddit account (connect in Settings → Storage)',
  keySource: null,  // OAuth token from storage_connections (provider=reddit)
  status: 'live',
  hidden: true,  // surfaces via build plans; you connect Reddit in Storage, not here
  async run({ structuredInput, prompt, proxy }) {
    const { getValidRedditToken } = await import('../utils/redditAuth')
    const token = await getValidRedditToken()
    if (!token) throw new ToolError('reddit_post', 'no_token', 'Connect Reddit first (Settings → Storage → Connect Reddit).')
    const input = (typeof structuredInput === 'object' && structuredInput) || {}
    const sr = String(input.subreddit || input.sr || '').replace(/^\/?r\//i, '').trim()
    if (!sr) throw new ToolError('reddit_post', 'no_subreddit', 'Which subreddit? e.g. {subreddit:"test", title:"…", body:"…"}.')
    const title = String(input.title || '').slice(0, 300)
    if (!title) throw new ToolError('reddit_post', 'no_title', 'A Reddit post needs a title.')
    const res = await proxy(
      'reddit_submit',
      { sr, title, text: input.body || input.text || prompt || '', url: input.url || null },
      { Authorization: `Bearer ${token}` }
    )
    if (!res.ok) throw new ToolError('reddit_post', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    const errs = data?.json?.errors
    if (errs && errs.length) throw new ToolError('reddit_post', 'reddit_error', errs.map(e => e.join(' ')).join('; '))
    return { type: 'action', summary: `Posted to r/${sr}`, link: data?.json?.data?.url || null, tool: 'reddit_post' }
  },
}

// ── Mastodon — post a status to the user's instance ───────────────
// Token is per-instance, so the key bundles both: "https://instance|TOKEN"
// (same single-slot pattern as Twilio's "sid:token").
const mastodon = {
  id: 'mastodon',
  name: 'Mastodon',
  category: 'action',
  capability: 'post a status (toot) to your Mastodon account — give it the text to publish',
  desc: 'Publish a post to your Mastodon instance',
  keySource: 'tool_keys.mastodon',
  keyPrefix: 'https://instance|token',
  setup: {
    signupUrl: 'https://joinmastodon.org/servers',
    seeText: 'On your instance: Preferences → Development → New application → create, then copy the access token.',
    note: 'Paste it here as "https://your.instance|ACCESS_TOKEN" — the token is tied to that instance.',
  },
  setupHint: 'Format: https://mastodon.social|your_access_token (instance URL, a pipe, then the token).',
  status: 'live',
  async run({ prompt, structuredInput, key, proxy }) {
    if (!key || !key.includes('|')) {
      throw new ToolError('mastodon', 'missing_key', 'Mastodon needs "https://instance|token". Create a token in your instance: Preferences → Development → New application.')
    }
    const sep = key.indexOf('|')
    const instance = key.slice(0, sep).trim().replace(/\/+$/, '')
    const token = key.slice(sep + 1).trim()
    const text = ((typeof structuredInput === 'object' && structuredInput?.text) || prompt || '').slice(0, 500)
    if (!text) throw new ToolError('mastodon', 'no_text', 'Nothing to post — give me the text for the status.')
    const res = await proxy('mastodon', { instance, status: text }, { Authorization: `Bearer ${token}` })
    if (!res.ok) throw new ToolError('mastodon', 'bad_response', await res.text().catch(() => `status ${res.status}`))
    const data = await res.json()
    return { type: 'action', summary: 'Posted to Mastodon', link: data.url || data.uri || null, tool: 'mastodon' }
  },
}

// ── ad_render — COMPOSER: storyboard frames + voiceover → one MP4 ──
// The browser-side stitcher for ad/promo builds. Unlike narrated_deck
// (one audio segment PER slide), an ad has N still frames shown across a
// SINGLE continuous voiceover, with an optional backing track ducked
// underneath. Shotstack can't fetch the data: URLs this pipeline produces
// (DALL·E frames + base64 audio); ffmpeg.wasm renders them in-browser with
// no key and no asset hosting. Output is a finished data: MP4.
const adRender = {
  id: 'ad_render',
  name: 'Ad render → video',
  category: 'video',
  capability: 'combine storyboard frames + a voiceover (+ optional backing track) into ONE finished MP4 ad, browser-side',
  desc: 'Internal composer — renders storyboard frames + voiceover into a single MP4 ad, browser-side (no key)',
  keySource: null,
  status: 'live',
  hidden: true,
  composer: true,
  async run({ structuredInput, label }) {
    let data = structuredInput
    if (typeof data === 'string') {
      try { data = JSON.parse(data) }
      catch { throw new ToolError('ad_render', 'bad_input', 'ad_render expects { images, voiceover, music? } — the upstream bundles did not resolve into valid JSON.') }
    }

    // Accept a bundle ({files:[...]}), a bare array, or a JSON string of either.
    const listOf = (x) => {
      if (!x) return []
      if (typeof x === 'string') { try { x = JSON.parse(x) } catch { return [] } }
      if (Array.isArray(x)) return x.map(i => (typeof i === 'string' ? { url: i } : i))
      if (Array.isArray(x.files)) return x.files
      if (x.url) return [x]
      return []
    }
    // Pull a single playable url from a single audio object OR the first
    // non-error file of a bundle.
    const oneUrl = (x) => {
      const list = listOf(x).filter(f => f && !f.error && f.url)
      return list[0]?.url || null
    }

    const images = listOf(data?.images || data?.frames || data?.slides).filter(f => f && !f.error && f.url)
    const voiceUrl = oneUrl(data?.voiceover || data?.voice || data?.narration)
    const musicUrl = oneUrl(data?.music || data?.soundtrack || data?.track)

    if (images.length === 0) throw new ToolError('ad_render', 'no_images', 'ad_render needs storyboard frames.')
    if (!voiceUrl) throw new ToolError('ad_render', 'no_voiceover', 'ad_render needs a voiceover track.')
    if (images.length > 60) throw new ToolError('ad_render', 'too_many_frames', `Too many frames to render in-browser (${images.length}). Split it up.`)

    const { getFFmpeg, fetchFile } = await import('../utils/ffmpegLoader')
    const { arrayBufferToBase64 } = await import('../utils/base64')
    const ff = await getFFmpeg()

    const W = 1280, H = 720
    const VF = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`

    // Probe the voiceover length by capturing ffmpeg's log output during a
    // no-output decode. ffmpeg "errors" (no output file) but still prints
    // "Duration: HH:MM:SS.ss". Fall back to 5s/frame if the probe is silent.
    const probeDuration = async (name) => {
      let dur = 0
      const onLog = ({ message }) => {
        const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message || '')
        if (m) dur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])
      }
      ff.on('log', onLog)
      try { await ff.exec(['-i', name]) } catch { /* expected: no output specified */ }
      ff.off('log', onLog)
      return dur
    }

    const segNames = []
    try {
      await ff.writeFile('vo.mp3', await fetchFile(voiceUrl))
      if (musicUrl) await ff.writeFile('music.mp3', await fetchFile(musicUrl))

      const total = await probeDuration('vo.mp3') || images.length * 5
      const per = Math.max(1, total / images.length)

      // One silent video segment per frame, each held for an equal slice of
      // the voiceover. Uniform codec params so the segments concat-copy.
      for (let i = 0; i < images.length; i++) {
        const imgName = `img${i}.png`
        const segName = `seg${i}.mp4`
        await ff.writeFile(imgName, await fetchFile(images[i].url))
        await ff.exec([
          '-loop', '1', '-t', per.toFixed(3), '-i', imgName,
          '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
          '-vf', VF, '-r', '25',
          segName,
        ])
        segNames.push(segName)
        await ff.deleteFile(imgName)
      }

      const concatList = segNames.map(s => `file ${s}`).join('\n')
      await ff.writeFile('concat.txt', new TextEncoder().encode(concatList))
      await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'slideshow.mp4'])

      // Mux audio over the slideshow. With music, duck it under the voice and
      // mix; duration=first ties the result to the voiceover. -shortest caps
      // the video (which may be a hair longer from rounding) to the audio.
      if (musicUrl) {
        await ff.exec([
          '-i', 'slideshow.mp4', '-i', 'vo.mp3', '-i', 'music.mp3',
          '-filter_complex', '[2:a]volume=0.22[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]',
          '-map', '0:v', '-map', '[a]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-shortest', '-movflags', '+faststart', 'out.mp4',
        ])
      } else {
        await ff.exec([
          '-i', 'slideshow.mp4', '-i', 'vo.mp3',
          '-map', '0:v', '-map', '1:a',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-shortest', '-movflags', '+faststart', 'out.mp4',
        ])
      }

      const out = await ff.readFile('out.mp4')
      const b64 = arrayBufferToBase64(out)
      for (const s of segNames) { try { await ff.deleteFile(s) } catch {} }
      for (const f of ['concat.txt', 'slideshow.mp4', 'vo.mp3', 'music.mp3', 'out.mp4']) { try { await ff.deleteFile(f) } catch {} }

      return {
        type: 'video',
        url: `data:video/mp4;base64,${b64}`,
        title: (label || 'ad').slice(0, 60),
        tool: 'ad_render',
        meta: { frames: images.length, durationSec: Math.round(total) || null, hadMusic: !!musicUrl, composer: true },
      }
    } catch (e) {
      if (e instanceof ToolError) throw e
      throw new ToolError('ad_render', 'render_failed', `Couldn't render the ad: ${e?.message || e}`)
    }
  },
}

// ── The registry ──────────────────────────────────────────────────

export const TOOL_REGISTRY = [
  // Image generation — all confirmed working from browser
  dalle, stability, ideogram, flux, recraft,
  // Image editing
  removebg, clipdrop, topaz,
  // Voice / music
  elevenlabs, openaiTts, stableAudio, elevenlabsMusic, suno,
  // Transcription
  whisper, assemblyai,
  // Video
  runway, luma, pika, heygen, videoRender, capcutBundle,
  // 3D
  meshy,
  // Search
  perplexity, tavily, exa, firecrawl,
  // Document generation — browser-side, no API key needed
  pptxgen, docgen, pdfgen, xlsxgen, htmlgen, mdgen, codezip,
  // Per-slide bundles (synced visuals + narration for deck builds)
  imagePerSlide, narratePerSlide,
  // Composers — fuse prior assets into ONE finished deliverable, browser-side
  adRender,
  // Action layer
  gmail, gsheets, gcal, notion, twilio, stripe, mastodon,
  // Social
  redditPost,
  // Meta — panel-as-tool for multi-step builds
  agentSynth,
]

export const TOOLS_BY_ID = Object.fromEntries(TOOL_REGISTRY.map(t => [t.id, t]))

// Tools we want users to know about but that can't connect yet.
// These appear in Settings as roadmap cards (no Connect button).
// "Work or not be there" — no vaporware placeholders in the UI. Every tool the
// user sees is a live, runnable entry in TOOL_REGISTRY. Tools graduate here as
// real entries (Exa, Firecrawl, Stable Audio, ElevenLabs Music, Luma, Meshy all
// did). Genuinely-blocked providers (e.g. Udio — no official API) stay out.
export const ROADMAP_TOOLS = []

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
