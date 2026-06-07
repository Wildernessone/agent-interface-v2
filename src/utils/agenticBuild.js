// ── Agentic build ──────────────────────────────────────────────────
// A builder AGENT drives a real native tool-call loop: it calls ONE tool at a
// time, constructing each input from the ACTUAL output of the previous call,
// and finishes by rendering. This replaces the brittle static "plan script" for
// video builds — there is no giant plan JSON to truncate, no {s1} interpolation
// to mis-wire, and no "doc about the video": to finish, the agent MUST call
// render_video with the real assets. (Anthropic tool-use; the worker /claude
// route passes `tools`/`system` through.)
import { TOOLS_BY_ID, readKey, generateImageWithFallback } from '../tools/registry'
import { saveToCloud } from './cloudStorage'

const MODEL = 'claude-sonnet-4-6'

const VIDEO_TOOLS = [
  { name: 'generate_image', description: 'Generate ONE still hero image from a vivid, detailed visual prompt (describe the SHOT — composition, mood, colors — not the pitch). Returns an image id.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'record_voiceover', description: 'Synthesize a spoken voiceover. "script" MUST be the EXACT words to speak (the bare ad copy) — never an instruction like "record a voiceover saying…". Returns a voiceover id.',
    input_schema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
  { name: 'generate_music', description: 'Generate a short instrumental backing track, no vocals. Returns a music id (or skipped if no key).',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' }, duration_sec: { type: 'number' } }, required: ['prompt'] } },
  { name: 'render_video', description: 'Assemble the FINISHED MP4 from a generated image, a voiceover, and optional music. Call this LAST, passing the ids returned earlier. This produces the actual deliverable file.',
    input_schema: { type: 'object', properties: { image_id: { type: 'string' }, voiceover_id: { type: 'string' }, music_id: { type: 'string' } }, required: ['image_id', 'voiceover_id'] } },
]

function buildFolderName(deliverable) {
  const safe = (deliverable || 'Promo Video').replace(/[<>:"/\\|?*]/g, '').slice(0, 70).trim()
  return `${new Date().toISOString().slice(0, 10)} — ${safe}`
}

export async function runAgenticBuild({ request, brandContext, settings, project, proxy, hasStorage }, onStep = () => {}) {
  const claudeKey = readKey(settings, 'agent.claude')
  if (!claudeKey) throw new Error('The agentic builder needs your Claude (Anthropic) key — add it in Settings → Agents.')

  const store = {}              // id -> real tool output (image/audio/video object)
  const counts = {}
  const files = [], errors = []
  const deliverable = 'Promo Video'
  const folderName = buildFolderName(deliverable)
  const buildProject = project ? { ...project, name: `${project.name}/${folderName}` } : { id: null, name: folderName }
  const componentsProject = { ...buildProject, name: `${buildProject.name}/components` }
  let folderLink = null, folderProvider = null
  const newId = (kind) => { counts[kind] = (counts[kind] || 0) + 1; return `${kind}_${counts[kind]}` }

  // Run one tool the agent asked for. Store the real output; return a SHORT
  // reference (id + note) so the agent's context never holds raw media.
  const execTool = async (name, input) => {
    if (name === 'generate_image') {
      const id = newId('image')
      onStep(id, 'Generate hero image', 'started')
      const out = await generateImageWithFallback({ prompt: input.prompt, structuredInput: { prompt: input.prompt }, settings, proxy })
      store[id] = out; onStep(id, 'Generate hero image', 'done')
      return { id, status: 'ok', note: `image generated via ${out.provider}` }
    }
    if (name === 'record_voiceover') {
      const elevenKey = readKey(settings, 'tool_keys.elevenlabs')
      const tool = elevenKey ? TOOLS_BY_ID.elevenlabs : TOOLS_BY_ID.openai_tts
      const key = elevenKey || readKey(settings, 'agent.gpt')
      if (!key) throw new Error('No voiceover key (add ElevenLabs or OpenAI).')
      const id = newId('voiceover')
      onStep(id, 'Record voiceover', 'started')
      const out = await tool.run({ prompt: input.script, structuredInput: { text: input.script }, key, proxy, settings })
      store[id] = out; onStep(id, 'Record voiceover', 'done')
      return { id, status: 'ok' }
    }
    if (name === 'generate_music') {
      const key = readKey(settings, 'tool_keys.stability')
      if (!key) return { status: 'skipped', note: 'no Stability key — render without music' }
      const id = newId('music')
      onStep(id, 'Generate backing track', 'started')
      const out = await TOOLS_BY_ID.stable_audio.run({ prompt: input.prompt, structuredInput: { prompt: input.prompt, duration: Math.min(30, Math.max(3, input.duration_sec || 5)) }, key, proxy })
      store[id] = out; onStep(id, 'Generate backing track', 'done')
      return { id, status: 'ok' }
    }
    if (name === 'render_video') {
      const img = store[input.image_id], vo = store[input.voiceover_id], mu = input.music_id ? store[input.music_id] : null
      if (!img) throw new Error(`unknown image_id "${input.image_id}"`)
      if (!vo) throw new Error(`unknown voiceover_id "${input.voiceover_id}"`)
      onStep('render_video', 'Render the finished MP4', 'started')
      const out = await TOOLS_BY_ID.ad_render.run({ structuredInput: { images: img, voiceover: vo, music: mu }, label: deliverable, context: { sourceImageUrl: img.url } })
      store.final_video = out; onStep('render_video', 'Render the finished MP4', 'done')
      return { id: 'final_video', status: 'ok', note: 'finished MP4 rendered' }
    }
    return { status: 'error', note: `unknown tool ${name}` }
  }

  const system = `You are the Builder inside Agent Interface — it produces REAL finished files, not descriptions. Produce the user's promo video by CALLING TOOLS one at a time, using the real result of each call to build the next. Do NOT write a plan or a "production doc" — perform the work.

For a short promo video:
1. Decide a punchy ~5-second ad concept and write the exact voiceover script YOURSELF (~25 words, hook → payoff). Do not call a tool to "write a plan".
2. generate_image — a striking hero visual.
3. record_voiceover — pass the EXACT spoken words (the bare script), never an instruction.
4. generate_music — a short backing track (skip gracefully if it returns "skipped").
5. render_video — assemble the finished MP4 from the image + voiceover (+ music), passing the ids from earlier steps. Call this LAST.
When render_video succeeds, confirm in one short sentence and STOP (no further tool calls).${brandContext ? `\n\nBRAND CONTEXT (ground everything in this; do not contradict it):\n${String(brandContext).slice(0, 1500)}` : ''}`

  let messages = [{ role: 'user', content: request || 'Make a short launch promo video.' }]
  for (let turn = 0; turn < 14; turn++) {
    const res = await proxy('claude', { model: MODEL, max_tokens: 1500, system, messages, tools: VIDEO_TOOLS }, { 'x-api-key': claudeKey })
    if (!res.ok) { errors.push({ stepId: '_agent', error: `claude_${res.status}` }); break }
    const data = await res.json().catch(() => ({}))
    const content = data.content || []
    messages.push({ role: 'assistant', content })
    const toolUses = content.filter(c => c.type === 'tool_use')
    if (data.stop_reason !== 'tool_use' || !toolUses.length) break
    const results = []
    for (const tu of toolUses) {
      try {
        const r = await execTool(tu.name, tu.input || {})
        if (r.status === 'error') errors.push({ stepId: tu.name, error: r.note })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r) })
      } catch (e) {
        onStep(tu.name, tu.name, 'failed', e.message)
        errors.push({ stepId: tu.name, error: e.message })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `error: ${e.message}`, is_error: true })
      }
    }
    messages.push({ role: 'user', content: results })
    if (store.final_video) break
  }

  // Save: finished video = FINAL deliverable; the generated pieces = reusable components.
  const saveOne = async (out, displayName, target, isFinal) => {
    if (!out?.url) return
    if (!hasStorage) { files.push({ stepId: displayName, label: displayName, output: out, unsaved: true }); return }
    const saved = await saveToCloud({ ...out, displayName }, target)
    if (saved) {
      files.push({ stepId: displayName, label: displayName, output: out, savedLink: saved.webViewLink || null, savedProvider: saved.provider || null, component: !isFinal })
      if (isFinal && !folderLink) { folderLink = saved.folderLink; folderProvider = saved.provider }
    } else errors.push({ stepId: displayName, error: 'save_failed' })
  }
  if (store.final_video) await saveOne(store.final_video, `FINAL — ${deliverable}`, buildProject, true)
  else errors.push({ stepId: 'render_video', error: 'no_video_rendered' })
  for (const [id, out] of Object.entries(store)) {
    if (id === 'final_video') continue
    await saveOne(out, id.replace(/_/g, ' '), componentsProject, false)
  }

  return { deliverable, folderName, files, errors, folderLink, folderProvider, agentic: true }
}
