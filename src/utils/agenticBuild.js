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
  { name: 'build_webapp', description: 'FINAL (game / interactive app / tool / website / chart / graph / diagram / flowchart / mind map / form / survey / quiz / calculator / dashboard / QR code): emit a SINGLE self-contained .html file that runs on its own — inline ALL your html/css/js. Write the COMPLETE, working code yourself (real logic with REAL data/labels, not a stub). For charts/diagrams/QR you MAY load ONE well-known CDN library (Chart.js for charts, Mermaid for diagrams, a qrcode lib for QR) when it materially helps; otherwise no external deps. Use this for anything the user wants to PLAY with, INTERACT with, or VISUALIZE.',
    input_schema: { type: 'object', properties: { html: { type: 'string', description: 'the entire self-contained HTML document' }, title: { type: 'string' } }, required: ['html'] } },
  { name: 'write_markdown', description: 'FINAL (blog post / markdown / static-site content): emit a real .md with frontmatter. Write the full body yourself.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      sections: { type: 'array', items: { type: 'object', properties: {
        heading: { type: 'string' }, body: { type: 'string' } } } },
    }, required: ['sections'] } },
  { name: 'build_podcast', description: 'FINAL (podcast / audio show / two-host conversation / interview / dialogue audio): emit a real .mp3 episode. Write the COMPLETE script yourself as alternating spoken turns between speakers — natural back-and-forth conversation, real spoken language, NO stage directions / no "[Host]:" tags / no "(laughs)". Each turn is { speaker, text }. The system gives each distinct speaker its own voice and stitches all the lines into one audio file. Aim for 8-30 turns.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string' },
      segments: { type: 'array', items: { type: 'object', properties: {
        speaker: { type: 'string', description: "speaker label, e.g. 'Alex' or 'Host A' — reuse the same labels so each gets a consistent voice" },
        text: { type: 'string', description: 'the exact words this speaker says (spoken language only)' } }, required: ['speaker', 'text'] } },
    }, required: ['segments'] } },
]

// Which tools emit an actual deliverable file (vs. a reusable component).
const FINAL_TOOLS = new Set(['render_video', 'build_deck', 'write_document', 'build_spreadsheet', 'build_pdf', 'write_markdown', 'build_webapp', 'build_podcast'])
const FINAL_EXT = { build_deck: 'Deck', write_document: 'Document', build_spreadsheet: 'Spreadsheet', build_pdf: 'PDF', write_markdown: 'Post', render_video: 'Video', build_webapp: 'App', build_podcast: 'Podcast' }

// Friendly "what's being written" labels for live progress while the model
// streams a tool call's content (so the build card reads "Writing the slide
// deck…" instead of sitting on a dead spinner for 60-120s).
const WRITING_LABEL = {
  build_deck: 'the slide deck', build_spreadsheet: 'the spreadsheet',
  write_document: 'the document', build_pdf: 'the PDF', write_markdown: 'the post',
  build_webapp: 'the app', build_podcast: 'the podcast', render_video: 'the video',
  generate_image: 'an image', record_voiceover: 'the voiceover', generate_music: 'the music',
}

function buildFolderName(deliverable) {
  const safe = (deliverable || 'Build').replace(/[<>:"/\\|?*]/g, '').slice(0, 70).trim()
  return `${new Date().toISOString().slice(0, 10)} — ${safe}`
}

// Read Anthropic's streaming (SSE) response and reassemble it into the same
// { content, stop_reason } shape the non-streaming API returns, so the builder
// loop is unchanged. We stream so a long build (a full game/app via build_webapp)
// keeps bytes flowing and doesn't 524 through Cloudflare. Tool-use inputs arrive
// as input_json_delta fragments we concatenate and JSON.parse at the end.
async function readClaudeStream(res, onProgress = () => {}) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const blocks = []
  let stop_reason = null, error = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let ev
        try { ev = JSON.parse(payload) } catch { continue }
        if (ev.type === 'content_block_start') {
          const cb = ev.content_block || {}
          blocks[ev.index] = cb.type === 'tool_use'
            ? { type: 'tool_use', id: cb.id, name: cb.name, json: '' }
            : { type: 'text', text: '' }
          // Live progress: the model just started emitting a tool call — we know
          // WHICH deliverable it's writing before the content finishes streaming.
          if (cb.type === 'tool_use') onProgress({ type: 'tool_start', name: cb.name })
        } else if (ev.type === 'content_block_delta') {
          const b = blocks[ev.index]
          if (!b) continue
          if (ev.delta?.type === 'text_delta') b.text = (b.text || '') + (ev.delta.text || '')
          else if (ev.delta?.type === 'input_json_delta') {
            b.json = (b.json || '') + (ev.delta.partial_json || '')
            // Report bytes streamed so the card shows the file growing, not a freeze.
            onProgress({ type: 'delta', name: b.name, bytes: b.json.length })
          }
        } else if (ev.type === 'message_delta') {
          if (ev.delta?.stop_reason) stop_reason = ev.delta.stop_reason
        } else if (ev.type === 'error') {
          error = ev.error?.message || 'stream_error'
        }
      }
    }
  } catch (e) {
    error = error || e?.message || 'stream_read_failed'
  }
  // Track tool calls whose JSON didn't parse — almost always because the 24k
  // length cap cut the input off mid-stream. Executing those would emit an
  // empty/garbage file, so the caller regenerates them instead.
  const truncated = []
  const content = blocks.filter(Boolean).map(b => {
    if (b.type === 'tool_use') {
      let input = {}
      if (b.json) { try { input = JSON.parse(b.json) } catch { input = {}; truncated.push(b.id) } }
      return { type: 'tool_use', id: b.id, name: b.name, input }
    }
    return { type: 'text', text: b.text || '' }
  })
  return { content, stop_reason, error, truncated }
}

export async function runAgenticBuild({ request, deliverable: deliverableIn, brandContext, settings, project, proxy, hasStorage, context }, onStep = () => {}) {
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
    if (name === 'build_podcast') {
      const elevenKey = readKey(settings, 'tool_keys.elevenlabs')
      if (!elevenKey) throw new Error('A podcast needs an ElevenLabs key (Settings → Tools).')
      const segs = (Array.isArray(input.segments) ? input.segments : []).filter(s => s && String(s.text || '').trim())
      if (!segs.length) throw new Error('build_podcast got no dialogue.')
      onStep('build_podcast', `Recording ${segs.length} lines…`, 'started')
      // Distinct voice per speaker label: 1st speaker → voice A, 2nd → B, etc.
      const VOICES = [settings?.narratorVoiceId || '21m00Tcm4TlvDq8ikWAM', 'pNInz6obpgDQGcFmaJgB', 'EXAVITQu4vr4xnSDxMaL', 'TxGEqnHWrfWFTfGW9XjX']
      const order = []
      const voiceFor = (sp) => { const k = String(sp || 'A'); if (!order.includes(k)) order.push(k); return VOICES[order.indexOf(k) % VOICES.length] }
      const { getFFmpeg, fetchFile, acquireFFmpegLock } = await import('../utils/ffmpegLoader')
      const { arrayBufferToBase64 } = await import('../utils/base64')
      // TTS each line in order (sequential — preserves order + respects rate limits).
      const clips = []
      for (let i = 0; i < segs.length; i++) {
        const r = await proxy('elevenlabs', { text: String(segs[i].text).slice(0, 1500), voice_id: voiceFor(segs[i].speaker) }, { 'x-api-key': elevenKey })
        if (!r.ok) continue
        const d = await r.json().catch(() => ({}))
        if (d.audio) clips.push(d.audio)
      }
      if (!clips.length) throw new Error('podcast voiceover produced no audio.')
      const release = await acquireFFmpegLock()
      let ff
      try { ff = await getFFmpeg() } catch (e) { release(); throw e }
      try {
        const names = []
        for (let i = 0; i < clips.length; i++) { const nm = `p${i}.mp3`; await ff.writeFile(nm, await fetchFile(`data:audio/mpeg;base64,${clips[i]}`)); names.push(nm) }
        await ff.writeFile('list.txt', new TextEncoder().encode(names.map(n => `file ${n}`).join('\n')))
        // Re-encode on concat (not -c copy) so the mp3 frames join cleanly.
        await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c:a', 'libmp3lame', '-b:a', '128k', 'episode.mp3'])
        const outBuf = await ff.readFile('episode.mp3')
        const b64 = arrayBufferToBase64(outBuf)
        for (const n of [...names, 'list.txt', 'episode.mp3']) { try { await ff.deleteFile(n) } catch {} }
        const safe = (input.title || deliverable || 'podcast').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'podcast'
        const out = { type: 'audio', url: `data:audio/mpeg;base64,${b64}`, filename: `${safe}.mp3`, title: input.title || deliverable, tool: 'build_podcast' }
        finals.push({ out, kind: 'build_podcast' }); onStep('build_podcast', 'Record the podcast', 'done')
        return { status: 'ok', note: `podcast recorded (${clips.length} lines)` }
      } finally { release() }
    }
    return { status: 'error', note: `unknown tool ${name}` }
  }

  const webappIntent = /\b(game|web ?app|web ?site|app|playable|tower[ -]?defen[sc]e|arcade|simulator|interactive|mini[- ]?game|html game|chart|graph|diagram|flow ?chart|mind ?map|org ?chart|form|survey|quiz|calculator|dashboard|qr ?code)\b/i.test(`${request || ''} ${deliverable || ''}`)
  const webappDirective = webappIntent
    ? `\n\n⚠ THIS REQUEST IS A GAME / INTERACTIVE APP. Your ONLY acceptable final action is build_webapp, emitting ONE self-contained .html with the COMPLETE working code (vanilla HTML/CSS/JS, canvas where it's a game, real logic you write in full). Do NOT call generate_image and do NOT stop after making any image — a game/app is built from CODE, not pictures. Describing it, planning it, or producing an image instead of calling build_webapp = the build FAILS and the user gets nothing playable. CRITICAL: keep the code TIGHT and efficient so the ENTIRE thing fits in ONE response — compact, working code with minimal comments. If the scope is getting too large to finish in one go, SIMPLIFY it (fewer tower types, simpler art) rather than leaving the file truncated and unplayable. The .html MUST be complete, ending with </html>. Write the whole thing and call build_webapp.`
    : ''
  const podcastIntent = /\b(podcast|audio (?:show|episode|drama)|two[- ]?host)\b/i.test(`${request || ''} ${deliverable || ''}`)
  const podcastDirective = podcastIntent
    ? `\n\n⚠ THIS REQUEST IS A PODCAST / AUDIO SHOW. Your ONLY acceptable final action is build_podcast — write the FULL dialogue yourself as alternating { speaker, text } turns (real spoken back-and-forth, no stage directions, no "[Host]:" labels in the text). Do NOT write a script document or call write_document — the deliverable is a real .mp3 the system voices and stitches. Aim for 8-30 natural turns. Call build_podcast.`
    : ''

  // Single-final-tool builds (a self-contained webapp/game, a podcast) need ZERO
  // component steps — there is exactly one tool that emits the deliverable. The
  // builder would sometimes return prose instead of calling it (especially when
  // the threaded conversation is a panel DEBATING whether to build at all — it
  // mirrors the hedging and never fires the tool → no_deliverable_produced).
  // Forcing tool_choice on the first turn removes the talk-instead-of-build
  // escape hatch entirely. Multi-tool builds (deck+images, ad video) must NOT be
  // forced — they legitimately call a component tool (generate_image, voiceover)
  // before the finisher — so this is scoped to the two single-call classes only.
  const forcedFinalTool = webappIntent ? 'build_webapp' : podcastIntent ? 'build_podcast' : null

  // How many DISTINCT final deliverables did the user ask for? "a deck AND a
  // spreadsheet" = 2. The build loop used to stop after the FIRST final tool, so
  // a multi-part request silently lost everything after deliverable #1. Count
  // only types that map to a FINAL tool (logos/mottos are image/text COMPONENTS
  // that ride inside a deliverable, not finals of their own — don't count them,
  // or the loop waits forever for a final that never comes).
  const DELIVERABLE_GROUPS = [
    /\b(deck|slides?|powerpoint|presentation|pitch|keynote)\b/i,
    /\b(spreadsheet|excel|workbook|xlsx|budget|pricing|flight plan)\b/i,
    /\b(doc|document|report|one[- ]?pager|whitepaper|memo|brief|letter|proposal)\b/i,
    /\bpdf\b/i,
    /\b(video|promo|reel|trailer|advert|commercial|mp4)\b/i,
    /\b(podcast|audio show)\b/i,
    /\b(web ?app|web ?site|\bgame\b|playable|landing page)\b/i,
    /\b(blog post|article|newsletter|markdown)\b/i,
  ]
  const _reqText = `${request || ''} ${deliverable || ''}`
  const expectedDeliverables = Math.max(1, DELIVERABLE_GROUPS.filter(re => re.test(_reqText)).length)
  const multiDirective = expectedDeliverables > 1
    ? `\n\n⚠ THE USER ASKED FOR ${expectedDeliverables} SEPARATE DELIVERABLES. You MUST produce EVERY one — call each one's final tool (e.g. build_deck AND build_spreadsheet). Do NOT stop after the first file. Prefer calling all the final tools together in one response. The build is only done when all ${expectedDeliverables} exist.`
    : ''

  const system = `You are the Builder inside Agent Interface — it produces REAL finished files, not descriptions or plans. Read what the user wants and BUILD IT by calling tools, using the real result of each call to construct the next. Do NOT write a "plan" or a "production doc" — perform the work and emit the actual file.${webappDirective}${podcastDirective}${multiDirective}

Pick the right FINAL tool for the deliverable:
- Slide deck / pitch deck / PowerPoint → build_deck (write COMPLETE slide content yourself; for a pitch deck, call generate_image first for a cover/key visuals and attach via slide.image_id).
- Report / one-pager / letter / brief / doc → write_document.
- Spreadsheet / financial model / table / budget / pricing → build_spreadsheet (real numbers; row 0 = header).
- PDF → build_pdf.
- Blog post / article / markdown → write_markdown.
- Promo video / ad / reel / trailer → generate_image, then record_voiceover (the EXACT words, never an instruction), then generate_music (skip gracefully if "skipped"), then render_video LAST with the ids.
- Game / interactive app / playable demo / tool / website → build_webapp: ONE self-contained .html with all html/css/js inlined and the REAL, fully-working logic written by you (no external libraries, no placeholders, no "// add game logic here"). Make it actually playable/usable.
- Podcast / audio show / two-host conversation / interview → build_podcast: write the FULL dialogue yourself as alternating { speaker, text } turns (natural spoken back-and-forth, no stage directions). The system voices each speaker distinctly and stitches one .mp3 episode.

Write ALL real content YOURSELF — headlines, bullets, prose, numbers — never placeholders, never "insert X here". When EVERY requested deliverable has been produced, confirm in ONE short sentence and STOP (no further tool calls).${brandContext ? `\n\nBRAND CONTEXT (ground everything in this; do not contradict it):\n${String(brandContext).slice(0, 1500)}` : ''}`

  // Thread the conversation so far into the build, so references like "make THIS
  // game" / "build the thing we discussed" resolve to what was actually talked
  // about — without it the builder only sees the bare request and asks "which
  // game?" instead of building (the no_deliverable cause).
  let messages = [{ role: 'user', content: context
    ? `CONVERSATION SO FAR (the user is referring to what was discussed below — use it to know EXACTLY what to build; do not ask for clarification):\n${String(context).slice(0, 3000)}\n\n---\nNow BUILD what the user asked for: ${request || deliverable}`
    : (request || deliverable) }]
  console.log('[agentic] start —', deliverable, '·', request?.slice(0, 80))
  let nudged = false, truncRetries = 0
  for (let turn = 0; turn < 14; turn++) {
    // 24k cap so a full self-contained app/game (build_webapp) isn't truncated
    // mid-code — verified a complete tower-defense game lands in ~8k with the
    // "keep it tight" directive, so 24k is generous headroom. It's a ceiling, not
    // a target, so other builds stop early as before.
    // STREAM the call. A full game/app (build_webapp, 20k+ chars) takes 60-120s
    // to generate; as a single non-streamed response that 524-times-out through
    // Cloudflare → claude_524 / no_deliverable. Streaming keeps bytes flowing.
    // Force the finisher for single-tool builds so the model emits the file
    // instead of hedging in prose. Forced while no deliverable exists yet; the
    // loop breaks the instant the tool succeeds, so this never blocks a clean stop.
    const toolChoice = (forcedFinalTool && !finals.length) ? { type: 'tool', name: forcedFinalTool } : null
    // Live progress so a 60-120s generation doesn't look frozen. Show a step the
    // instant the turn starts, then update it as the model streams each tool's
    // content ("Writing the slide deck… (8 KB)"). Per-turn maps keep the byte
    // counts fresh. FINAL tools reuse their tool name as the step id, so execTool
    // transitions the SAME step from "Writing…" → "Assemble…" → done with no
    // flicker; component tools (image/voice/music) get finished here instead.
    onStep('_working', turn === 0 ? 'Designing your build…' : 'Working…', 'started')
    const reported = {}, streamed = new Set()
    const onProg = (ev) => {
      if (ev.type === 'tool_start' && ev.name) {
        streamed.add(ev.name)
        onStep('_working', '', 'done')
        onStep(ev.name, `Writing ${WRITING_LABEL[ev.name] || ev.name}…`, 'started')
      } else if (ev.type === 'delta' && ev.name && reported[ev.name] !== Math.floor((ev.bytes || 0) / 1024)) {
        const kb = Math.floor((ev.bytes || 0) / 1024)
        reported[ev.name] = kb
        if (kb >= 1) onStep(ev.name, `Writing ${WRITING_LABEL[ev.name] || ev.name}… (${kb} KB)`, 'started')
      }
    }
    // Retry transient API failures (rate limit / overload / proxy timeout) with
    // backoff. A heavy build makes several Claude calls; on a BYOK key a single
    // 429 used to kill the whole build with no deliverable. Honor Retry-After when
    // the provider sends it, else exponential backoff. 4xx other than 429 (bad
    // request, auth) are NOT retried — they won't get better.
    let res = null
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await proxy('claude', { model: MODEL, max_tokens: 24000, stream: true, system, messages, tools: BUILDER_TOOLS, ...(toolChoice ? { tool_choice: toolChoice } : {}) }, { 'x-api-key': claudeKey })
      if (res.ok || ![429, 503, 524, 529].includes(res.status) || attempt === 2) break
      const ra = parseInt(res.headers.get('retry-after') || '', 10)
      const waitMs = Number.isFinite(ra) ? Math.min(ra * 1000, 15000) : 1500 * (attempt + 1) * (attempt + 1)
      console.warn(`[agentic] claude ${res.status} — retry ${attempt + 1}/2 in ${waitMs}ms`)
      onStep('_working', `Provider busy (${res.status}) — retrying in ${Math.round(waitMs / 1000)}s…`, 'started')
      await new Promise(r => setTimeout(r, waitMs))
    }
    if (!res || !res.ok) { console.error('[agentic] claude not ok', res?.status); onStep('_working', '', 'done'); errors.push({ stepId: '_agent', tool: 'claude', code: 'agent_http', error: `claude_${res?.status}` }); break }
    const data = await readClaudeStream(res, onProg)
    // Turn done streaming: clear the generic indicator and finish any streamed
    // component-tool steps (their execTool runs under a different id). FINAL tools
    // are left for execTool to transition in place.
    onStep('_working', '', 'done')
    streamed.forEach(name => { if (!FINAL_TOOLS.has(name)) onStep(name, `Wrote ${WRITING_LABEL[name] || name}`, 'done') })
    // Surface a stream/API error (overloaded, etc.) instead of silently breaking
    // to an empty "no deliverable".
    if (data.error) {
      console.error('[agentic] claude stream error', data.error)
      errors.push({ stepId: '_agent', tool: 'claude', code: 'agent_error', error: data.error })
      break
    }
    const content = data.content || []
    messages.push({ role: 'assistant', content })
    const toolUses = content.filter(c => c.type === 'tool_use')
    console.log(`[agentic] turn ${turn}: stop=${data.stop_reason} tools=[${toolUses.map(t => t.name).join(',')}]`)
    // Execute whenever the model emitted tool calls — even if it also hit the
    // token cap (stop_reason 'max_tokens'). Only stop when there are NO tools.
    // Backstop for single-tool builds: if the model talked instead of building
    // (no tool call — the no_deliverable_produced failure), nudge it ONCE to fire
    // the finisher rather than silently shipping nothing. This catches the case
    // where tool_choice didn't reach the model (e.g. an out-of-date proxy).
    if (!toolUses.length) {
      if (forcedFinalTool && !nudged) {
        nudged = true
        messages.push({ role: 'user', content: `You replied with text but produced no file. Call ${forcedFinalTool} NOW with the COMPLETE, fully-working content — output only the tool call, no prose, no questions.` })
        continue
      }
      break
    }
    // Tool inputs cut off by the length cap: do NOT execute them (the JSON is
    // incomplete → an empty/garbage file). Ask the model to regenerate that
    // deliverable more concisely, escalating after repeated truncation.
    const truncatedIds = new Set(data.truncated || [])
    let hadTruncation = false
    const results = []
    for (const tu of toolUses) {
      if (truncatedIds.has(tu.id)) {
        hadTruncation = true
        onStep(tu.name, `${WRITING_LABEL[tu.name] || tu.name} ran long — regenerating tighter…`, 'started')
        const harder = truncRetries >= 2
          ? `DRASTICALLY cut the scope (far fewer slides/rows, much shorter copy)`
          : `MORE CONCISELY (fewer slides/rows, shorter copy)`
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true,
          content: `Your ${tu.name} call was cut off by the length limit before its content finished — it is incomplete and was NOT used. Regenerate ${tu.name} ${harder} so the ENTIRE tool call fits in one response.` })
        continue
      }
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
    // Truncation happened → loop again so the model re-emits the cut-off deliverable
    // (the 14-turn cap bounds runaway). Don't let the break below end the build with
    // a missing file just because the other tools this turn were finals.
    if (hadTruncation) { truncRetries++; if (turn < 13) continue }
    // Stop once ALL requested deliverables exist and the agent has nothing else
    // queued. Using expectedDeliverables (not just `finals.length`) keeps a
    // multi-part build ("a deck AND a spreadsheet") going past the first file.
    if (finals.length >= expectedDeliverables && toolUses.every(t => FINAL_TOOLS.has(t.name))) break
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
    } else {
      // Save failed (token revoked / quota / network blip) — DON'T discard the
      // fully-produced file. Keep it inline as unsaved so the user can still
      // preview/download it this session; only the reload copy is lost.
      files.push({ stepId: displayName, label: displayName, output: out, unsaved: true, saveFailed: true, component: !isFinal })
      errors.push({ stepId: displayName, error: 'save_failed' })
    }
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
