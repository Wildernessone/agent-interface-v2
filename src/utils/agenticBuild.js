// ── Agentic build ──────────────────────────────────────────────────
// A builder AGENT drives a real native tool-call loop: it reads what the user
// wants, picks the right FINAL tool (deck / document / spreadsheet / pdf /
// video), and constructs each input from the ACTUAL output of the previous
// call. This replaces the brittle static "plan script" — there is no giant plan
// JSON to truncate, no {s1} interpolation to mis-wire, and no "doc about the
// thing": to finish, the agent MUST call a tool that emits the real file.
// (Anthropic tool-use; the worker /claude route passes `tools`/`system` through.)
import { TOOLS_BY_ID, readKey, generateImageWithFallback } from '../tools/registry'
import { saveToCloud } from './cloudStorage'

const MODEL = 'claude-sonnet-4-6'

// Tools the builder agent can call. Components (image/voiceover/music) feed the
// FINAL tools (deck/doc/sheet/pdf/markdown/video) that emit the actual file.
const BUILDER_TOOLS = [
  { name: 'generate_image', description: 'Generate ONE still image from a vivid, detailed VISUAL prompt (describe the SHOT — composition, subject, mood, colors — not the pitch). Use for hero/cover/section art. Returns an image id you can pass to build_deck (slide.image_id) or render_video.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'record_voiceover', description: 'Synthesize a spoken voiceover. "script" MUST be the EXACT words to speak (the bare copy) — never an instruction like "record a voiceover saying…". Returns a voiceover id.',
    input_schema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } },
  { name: 'generate_music', description: 'Generate a short instrumental backing track, no vocals. Returns a music id (or skipped if no key).',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' }, duration_sec: { type: 'number' } }, required: ['prompt'] } },
  { name: 'render_video', description: 'FINAL (video): assemble the finished MP4 from the scene image(s), a voiceover, and optional music. Pass image_ids = the ORDERED list of every scene-image id you generated, so all frames play as a slideshow across the voiceover. (image_id is a single-frame fallback.)',
    input_schema: { type: 'object', properties: { image_ids: { type: 'array', items: { type: 'string' }, description: 'ordered scene-image ids — use ALL the images you generated' }, image_id: { type: 'string' }, voiceover_id: { type: 'string' }, music_id: { type: 'string' } }, required: ['voiceover_id'] } },
  { name: 'build_deck', description: 'FINAL (slide deck / pitch deck / PowerPoint): emit a real .pptx. Write COMPLETE slide content yourself — punchy titles and concrete bullets, no placeholders. Optionally attach a generated image to a slide via image_id (use generate_image first for a cover or key visuals).',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      slides: { type: 'array', items: { type: 'object', properties: {
        title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' }, image_id: { type: 'string' } }, required: ['title'] } },
    }, required: ['slides'] } },
  { name: 'write_document', description: 'FINAL (report / one-pager / letter / doc): emit a real .docx. Write the FULL prose yourself — real headings and paragraphs, no "insert X here".',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      sections: { type: 'array', items: { type: 'object', properties: {
        heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } } } },
    }, required: ['sections'] } },
  { name: 'build_spreadsheet', description: 'FINAL (spreadsheet / model / table / budget): emit a real .xlsx. rows is an array of rows; row 0 is the header. Put REAL numbers and labels, not placeholders.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      sheets: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, rows: { type: 'array', items: { type: 'array', items: {} } } }, required: ['rows'] } },
    }, required: ['sheets'] } },
  { name: 'build_pdf', description: 'FINAL (PDF): emit a real .pdf from title + sections (heading + paragraphs). Write the full content yourself.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      sections: { type: 'array', items: { type: 'object', properties: {
        heading: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } } } } },
    }, required: ['sections'] } },
  { name: 'build_webapp', description: 'FINAL (game / interactive app / playable demo / tool / website): emit a SINGLE self-contained .html file that runs on its own — ALL html, css and js inlined, no external files/CDNs/imports. Write the COMPLETE, working code yourself (real game logic / app behavior, not a stub or description). Use this for anything the user wants to PLAY or INTERACT with.',
    input_schema: { type: 'object', properties: { html: { type: 'string', description: 'the entire self-contained HTML document' }, title: { type: 'string' } }, required: ['html'] } },
  { name: 'write_markdown', description: 'FINAL (blog post / markdown / static-site content): emit a real .md with frontmatter. Write the full body yourself.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      sections: { type: 'array', items: { type: 'object', properties: {
        heading: { type: 'string' }, body: { type: 'string' } } } },
    }, required: ['sections'] } },
]

// Which tools emit an actual deliverable file (vs. a reusable component).
const FINAL_TOOLS = new Set(['render_video', 'build_deck', 'write_document', 'build_spreadsheet', 'build_pdf', 'write_markdown', 'build_webapp'])
const FINAL_EXT = { build_deck: 'Deck', write_document: 'Document', build_spreadsheet: 'Spreadsheet', build_pdf: 'PDF', write_markdown: 'Post', render_video: 'Video', build_webapp: 'App' }

function buildFolderName(deliverable) {
  const safe = (deliverable || 'Build').replace(/[<>:"/\\|?*]/g, '').slice(0, 70).trim()
  return `${new Date().toISOString().slice(0, 10)} — ${safe}`
}

export async function runAgenticBuild({ request, deliverable: deliverableIn, brandContext, settings, project, proxy, hasStorage }, onStep = () => {}) {
  const claudeKey = readKey(settings, 'agent.claude')
  if (!claudeKey) throw new Error('The agentic builder needs your Claude (Anthropic) key — add it in Settings → Agents.')

  const store = {}              // id -> real tool output (image/audio/doc/video object)
  const finals = []             // { out, kind } in the order produced
  let renderInputs = null       // which component ids fed the final video — lets the UI re-stitch on a component regen
  const counts = {}
  const files = [], errors = []
  const deliverable = (deliverableIn || 'Build').toString().slice(0, 70)
  const folderName = buildFolderName(deliverable)
  const buildProject = project ? { ...project, name: `${project.name}/${folderName}` } : { id: null, name: folderName }
  const componentsProject = { ...buildProject, name: `${buildProject.name}/components` }
  let folderLink = null, folderProvider = null
  const newId = (kind) => { counts[kind] = (counts[kind] || 0) + 1; return `${kind}_${counts[kind]}` }
  const imageUrl = (id) => (id && store[id]?.url) || null

  // Run one tool the agent asked for. Component tools store output and return a
  // SHORT id (so the agent's context never holds raw media). FINAL tools emit a
  // real file and get pushed to `finals`.
  const execTool = async (name, input) => {
    if (name === 'generate_image') {
      const id = newId('image')
      onStep(id, 'Generate image', 'started')
      const out = await generateImageWithFallback({ prompt: input.prompt, structuredInput: { prompt: input.prompt }, settings, proxy })
      store[id] = { ...out, regenKind: 'image', regenParam: input.prompt }; onStep(id, 'Generate image', 'done')
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
      store[id] = { ...out, regenKind: 'voiceover', regenParam: input.script }; onStep(id, 'Record voiceover', 'done')
      return { id, status: 'ok' }
    }
    if (name === 'generate_music') {
      const key = readKey(settings, 'tool_keys.stability')
      if (!key) return { status: 'skipped', note: 'no Stability key — render without music' }
      const id = newId('music')
      onStep(id, 'Generate backing track', 'started')
      const out = await TOOLS_BY_ID.stable_audio.run({ prompt: input.prompt, structuredInput: { prompt: input.prompt, duration: Math.min(30, Math.max(3, input.duration_sec || 5)) }, key, proxy })
      store[id] = { ...out, regenKind: 'music', regenParam: input.prompt, regenDuration: input.duration_sec || 5 }; onStep(id, 'Generate backing track', 'done')
      return { id, status: 'ok' }
    }
    if (name === 'render_video') {
      // Use EVERY scene image as a slideshow across the voiceover — not just one.
      // The agent builds a multi-frame storyboard but the schema only took a
      // single image_id, so extra frames the user paid to generate were dropped.
      const refIds = (Array.isArray(input.image_ids) && input.image_ids.length)
        ? input.image_ids
        : (input.image_id ? [input.image_id] : [])
      let imgs = refIds.map(id => store[id]).filter(o => o?.url)
      // If fewer were referenced than generated, fall back to ALL images (in
      // creation order) so nothing generated gets thrown away.
      const allImgs = Object.keys(store).filter(k => /^image_\d+$/.test(k)).sort().map(k => store[k]).filter(o => o?.url)
      if (allImgs.length > imgs.length) imgs = allImgs
      const vo = store[input.voiceover_id], mu = input.music_id ? store[input.music_id] : null
      if (!imgs.length) throw new Error('no generated image to render')
      if (!vo) throw new Error(`unknown voiceover_id "${input.voiceover_id}"`)
      onStep('render_video', 'Render the finished MP4', 'started')
      const out = await TOOLS_BY_ID.ad_render.run({ structuredInput: { images: imgs, voiceover: vo, music: mu }, label: deliverable, context: { sourceImageUrl: imgs[0].url } })
      store.final_video = out; finals.push({ out, kind: 'render_video' }); onStep('render_video', 'Render the finished MP4', 'done')
      renderInputs = { image: refIds[0] || null, voiceover: input.voiceover_id, music: input.music_id || null }
      return { id: 'final_video', status: 'ok', note: 'finished MP4 rendered' }
    }
    if (name === 'build_deck') {
      onStep('build_deck', 'Assemble the slide deck', 'started')
      // Resolve any per-slide image_id refs to real urls for pptxgen.
      const slides = (input.slides || []).map(s => ({ ...s, image: imageUrl(s.image_id) }))
      const out = await TOOLS_BY_ID.pptxgen.run({ structuredInput: { slides }, label: input.title || deliverable })
      finals.push({ out, kind: 'build_deck' }); onStep('build_deck', 'Assemble the slide deck', 'done')
      return { status: 'ok', note: `deck built — ${slides.length} slides` }
    }
    if (name === 'write_document') {
      onStep('write_document', 'Write the document', 'started')
      const out = await TOOLS_BY_ID.docgen.run({ structuredInput: { title: input.title, sections: input.sections || [] }, label: input.title || deliverable })
      finals.push({ out, kind: 'write_document' }); onStep('write_document', 'Write the document', 'done')
      return { status: 'ok', note: 'document written' }
    }
    if (name === 'build_spreadsheet') {
      onStep('build_spreadsheet', 'Build the spreadsheet', 'started')
      const out = await TOOLS_BY_ID.xlsxgen.run({ structuredInput: { sheets: input.sheets || [] }, label: input.title || deliverable })
      finals.push({ out, kind: 'build_spreadsheet' }); onStep('build_spreadsheet', 'Build the spreadsheet', 'done')
      return { status: 'ok', note: 'spreadsheet built' }
    }
    if (name === 'build_pdf') {
      onStep('build_pdf', 'Render the PDF', 'started')
      const out = await TOOLS_BY_ID.pdfgen.run({ structuredInput: { title: input.title, sections: input.sections || [] }, label: input.title || deliverable })
      finals.push({ out, kind: 'build_pdf' }); onStep('build_pdf', 'Render the PDF', 'done')
      return { status: 'ok', note: 'pdf rendered' }
    }
    if (name === 'write_markdown') {
      onStep('write_markdown', 'Write the post', 'started')
      const out = await TOOLS_BY_ID.mdgen.run({ structuredInput: { title: input.title, sections: input.sections || [] }, label: input.title || deliverable })
      finals.push({ out, kind: 'write_markdown' }); onStep('write_markdown', 'Write the post', 'done')
      return { status: 'ok', note: 'post written' }
    }
    if (name === 'build_webapp') {
      onStep('build_webapp', 'Build the app', 'started')
      const html = String(input.html || '')
      if (!/<\/?[a-z]/i.test(html)) throw new Error('build_webapp got no HTML')
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const safe = (input.title || deliverable || 'app').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'app'
      const out = { type: 'webapp', html, url, filename: `${safe}.html`, title: input.title || deliverable, tool: 'build_webapp' }
      finals.push({ out, kind: 'build_webapp' }); onStep('build_webapp', 'Build the app', 'done')
      return { status: 'ok', note: 'web app built' }
    }
    return { status: 'error', note: `unknown tool ${name}` }
  }

  const webappIntent = /\b(game|web ?app|web ?site|app|playable|tower[ -]?defen[sc]e|arcade|simulator|interactive|mini[- ]?game|html game)\b/i.test(`${request || ''} ${deliverable || ''}`)
  const webappDirective = webappIntent
    ? `\n\n⚠ THIS REQUEST IS A GAME / INTERACTIVE APP. Your ONLY acceptable final action is build_webapp, emitting ONE self-contained .html with the COMPLETE working code (vanilla HTML/CSS/JS, canvas where it's a game, real logic you write in full). Do NOT call generate_image and do NOT stop after making any image — a game/app is built from CODE, not pictures. Describing it, planning it, or producing an image instead of calling build_webapp = the build FAILS and the user gets nothing playable. CRITICAL: keep the code TIGHT and efficient so the ENTIRE thing fits in ONE response — compact, working code with minimal comments. If the scope is getting too large to finish in one go, SIMPLIFY it (fewer tower types, simpler art) rather than leaving the file truncated and unplayable. The .html MUST be complete, ending with </html>. Write the whole thing and call build_webapp.`
    : ''
  const system = `You are the Builder inside Agent Interface — it produces REAL finished files, not descriptions or plans. Read what the user wants and BUILD IT by calling tools, using the real result of each call to construct the next. Do NOT write a "plan" or a "production doc" — perform the work and emit the actual file.${webappDirective}

Pick the right FINAL tool for the deliverable:
- Slide deck / pitch deck / PowerPoint → build_deck (write COMPLETE slide content yourself; for a pitch deck, call generate_image first for a cover/key visuals and attach via slide.image_id).
- Report / one-pager / letter / brief / doc → write_document.
- Spreadsheet / financial model / table / budget / pricing → build_spreadsheet (real numbers; row 0 = header).
- PDF → build_pdf.
- Blog post / article / markdown → write_markdown.
- Promo video / ad / reel / trailer → generate_image, then record_voiceover (the EXACT words, never an instruction), then generate_music (skip gracefully if "skipped"), then render_video LAST with the ids.
- Game / interactive app / playable demo / tool / website → build_webapp: ONE self-contained .html with all html/css/js inlined and the REAL, fully-working logic written by you (no external libraries, no placeholders, no "// add game logic here"). Make it actually playable/usable.

Write ALL real content YOURSELF — headlines, bullets, prose, numbers — never placeholders, never "insert X here". When the final file is produced, confirm in ONE short sentence and STOP (no further tool calls).${brandContext ? `\n\nBRAND CONTEXT (ground everything in this; do not contradict it):\n${String(brandContext).slice(0, 1500)}` : ''}`

  let messages = [{ role: 'user', content: request || deliverable }]
  console.log('[agentic] start —', deliverable, '·', request?.slice(0, 80))
  for (let turn = 0; turn < 14; turn++) {
    // 24k cap so a full self-contained app/game (build_webapp) isn't truncated
    // mid-code — verified a complete tower-defense game lands in ~8k with the
    // "keep it tight" directive, so 24k is generous headroom. It's a ceiling, not
    // a target, so other builds stop early as before.
    const res = await proxy('claude', { model: MODEL, max_tokens: 24000, system, messages, tools: BUILDER_TOOLS }, { 'x-api-key': claudeKey })
    if (!res.ok) { console.error('[agentic] claude not ok', res.status); errors.push({ stepId: '_agent', tool: 'claude', code: 'agent_http', error: `claude_${res.status}` }); break }
    const data = await res.json().catch(() => ({}))
    // Anthropic can return HTTP 200 with an error envelope (overloaded, etc.).
    // Without this check `content` is [], no tools fire, the loop breaks, and the
    // build silently produces nothing — an opaque "no deliverable". Surface it.
    if (data.type === 'error' || data.error) {
      const msg = data.error?.message || data.error?.type || 'Claude returned an error'
      console.error('[agentic] claude error envelope', msg)
      errors.push({ stepId: '_agent', tool: 'claude', code: 'agent_error', error: msg })
      break
    }
    const content = data.content || []
    messages.push({ role: 'assistant', content })
    const toolUses = content.filter(c => c.type === 'tool_use')
    console.log(`[agentic] turn ${turn}: stop=${data.stop_reason} tools=[${toolUses.map(t => t.name).join(',')}]`)
    // Execute whenever the model emitted tool calls — even if it also hit the
    // token cap (stop_reason 'max_tokens'). Only stop when there are NO tools.
    if (!toolUses.length) break
    const results = []
    for (const tu of toolUses) {
      try {
        const r = await execTool(tu.name, tu.input || {})
        if (r.status === 'error') errors.push({ stepId: tu.name, tool: tu.name, code: 'tool_error', error: r.note })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r) })
      } catch (e) {
        console.error('[agentic] tool error', tu.name, e?.message)
        onStep(tu.name, tu.name, 'failed', e.message)
        errors.push({ stepId: tu.name, tool: tu.name, code: 'exception', error: e.message })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `error: ${e.message}`, is_error: true })
      }
    }
    messages.push({ role: 'user', content: results })
    // Stop once a final deliverable exists and the agent has nothing else queued.
    if (finals.length && toolUses.every(t => FINAL_TOOLS.has(t.name))) break
  }

  // DETERMINISTIC VIDEO FINISHER — if a video was clearly intended (image +
  // voiceover produced) but render_video never ran, assemble the MP4 ourselves
  // so a finished video ALWAYS results.
  if (!finals.length) {
    const last = (k) => Object.keys(store).filter(id => id.startsWith(k)).pop()
    const allImgs = Object.keys(store).filter(k => /^image_\d+$/.test(k)).sort().map(k => store[k]).filter(o => o?.url)
    const voId = last('voiceover_'), muId = last('music_')
    const vo = store[voId], mu = store[muId]
    console.log('[agentic] post-loop, finals?', finals.length, 'imgs?', allImgs.length, 'vo?', !!vo)
    if (allImgs.length && vo?.url) {
      try {
        onStep('render_video', 'Render the finished MP4', 'started')
        const out = await TOOLS_BY_ID.ad_render.run({ structuredInput: { images: allImgs, voiceover: vo, music: mu || null }, label: deliverable, context: { sourceImageUrl: allImgs[0].url } })
        store.final_video = out; finals.push({ out, kind: 'render_video' })
        renderInputs = { image: last('image_'), voiceover: voId, music: muId || null }
        onStep('render_video', 'Render the finished MP4', 'done')
        console.log('[agentic] auto-render OK')
      } catch (e) {
        console.error('[agentic] auto-render failed', e?.message)
        onStep('render_video', 'Render the finished MP4', 'failed', e.message)
        errors.push({ stepId: 'render_video', error: e.message })
      }
    }
  }

  // Save: each final file = a FINAL deliverable; the generated pieces = reusable components.
  const saveOne = async (out, displayName, target, isFinal) => {
    if (!out?.url) return
    if (!hasStorage) { files.push({ stepId: displayName, label: displayName, output: out, unsaved: true, component: !isFinal }); return }
    const saved = await saveToCloud({ ...out, displayName }, target)
    if (saved) {
      files.push({ stepId: displayName, label: displayName, output: out, savedLink: saved.webViewLink || null, savedProvider: saved.provider || null, component: !isFinal })
      if (isFinal && !folderLink) { folderLink = saved.folderLink; folderProvider = saved.provider }
    } else errors.push({ stepId: displayName, error: 'save_failed' })
  }
  const multi = finals.length > 1
  for (const f of finals) {
    const tag = multi ? `FINAL — ${FINAL_EXT[f.kind] || deliverable}` : `FINAL — ${deliverable}`
    await saveOne(f.out, tag, buildProject, true)
  }
  if (!finals.length) errors.push({ stepId: 'build', error: 'no_deliverable_produced' })
  for (const [id, out] of Object.entries(store)) {
    if (id === 'final_video') continue
    await saveOne(out, id.replace(/_/g, ' '), componentsProject, false)
  }

  console.log('[agentic] DONE — finals:', finals.length, 'files:', files.length, 'errors:', JSON.stringify(errors))
  return { deliverable, folderName, files, errors, folderLink, folderProvider, agentic: true, renderInputs }
}
