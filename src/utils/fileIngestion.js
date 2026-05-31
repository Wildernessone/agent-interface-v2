/**
 * FILE INGESTION
 * ==============
 * Drop a PDF / image / audio / text file into the chat → extract its
 * content → inject as conversation context. Lets the panel reason
 * about "this PDF" / "this image" / "this voice memo" without us
 * needing to wire every model's native multimodal support separately.
 *
 * Extraction strategy:
 *   - text/markdown/json/csv → native FileReader
 *   - pdf                    → pdf.js extracts text per-page
 *   - image                  → Claude vision (uses existing Claude key)
 *   - audio                  → OpenAI Whisper (uses existing GPT key)
 *
 * Returns a plain text representation that gets prepended to the user's
 * next message as: "[Attached: filename.pdf]\n\n<extracted content>\n\n".
 *
 * All parsing happens client-side except image/audio which use the user's
 * own keys — fully BYOK, nothing touches our servers beyond the proxy.
 */

import { supabase } from './supabase'

const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'

const MAX_INLINE_CHARS = 50000 // sanity cap so massive PDFs don't blow context

async function supabaseAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

export function fileKindFromMime(mime, name = '') {
  if (mime.startsWith('text/') || mime === 'application/json' || /\.(md|txt|csv|json)$/i.test(name)) return 'text'
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  return 'unsupported'
}

async function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read_failed'))
    r.onload = () => resolve(String(r.result || '').slice(0, MAX_INLINE_CHARS))
    r.readAsText(file)
  })
}

async function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read_failed'))
    r.onload = () => resolve(String(r.result || ''))
    r.readAsDataURL(file)
  })
}

async function extractPdf(file) {
  // pdf.js needs a worker. We load it lazily so the main bundle stays small.
  const pdfjs = await import('pdfjs-dist')
  // The worker file ships inside pdfjs-dist. Point at the bundled URL.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const text = tc.items.map(it => it.str).join(' ')
    pages.push(`--- Page ${i} ---\n${text}`)
    if (pages.join('\n').length > MAX_INLINE_CHARS) break
  }
  return pages.join('\n\n').slice(0, MAX_INLINE_CHARS)
}

async function describeImage(file, claudeKey) {
  if (!claudeKey) throw new Error('image_needs_claude_key')
  const dataUrl = await readAsDataUrl(file)
  const b64 = dataUrl.split(',')[1]
  const mediaType = file.type || 'image/png'

  const res = await fetch(`${PROXY}/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Describe this image in detail. Include any text you can read verbatim. Be thorough — this will be the only context downstream agents have.' },
        ],
      }],
    }),
  })
  if (!res.ok) throw new Error(`claude_${res.status}`)
  const data = await res.json()
  return (data.content?.[0]?.text || '').slice(0, MAX_INLINE_CHARS)
}

async function transcribeAudio(file, settings) {
  const aaiKey = settings?.toolKeys?.assemblyai || ''
  const gptKey = settings?.agents?.gpt?.key || ''
  if (!aaiKey && !gptKey) throw new Error('audio_needs_openai_or_assemblyai_key')
  const authH = await supabaseAuthHeader()

  // Prefer AssemblyAI when the user has a key (speaker labels, robust); fall
  // back to Whisper (OpenAI key). Both route through the worker — api.openai.com
  // sends no browser CORS, so the previous browser-direct call silently failed.
  if (aaiKey) {
    try {
      const form = new FormData()
      form.append('file', file, file.name || 'audio.mp3')
      const res = await fetch(`${PROXY}/assemblyai`, { method: 'POST', headers: { ...authH, Authorization: aaiKey }, body: form })
      if (res.ok) {
        const data = await res.json()
        if (data.text) return data.text.slice(0, MAX_INLINE_CHARS)
      }
      // else fall through to Whisper if available
    } catch { /* fall through */ }
  }
  if (!gptKey) throw new Error('audio_needs_openai_key')
  const form = new FormData()
  form.append('file', file, file.name || 'audio.mp3')
  const res = await fetch(`${PROXY}/whisper`, { method: 'POST', headers: { ...authH, Authorization: `Bearer ${gptKey}` }, body: form })
  if (!res.ok) throw new Error(`whisper_${res.status}`)
  const data = await res.json()
  return (data.text || '').slice(0, MAX_INLINE_CHARS)
}

/**
 * Main entry. Returns { ok, content, kind, error? }.
 *   content: the extracted text, formatted to drop into a chat prompt
 *   kind:    text | pdf | image | audio | unsupported
 */
export async function ingestFile(file, settings) {
  const kind = fileKindFromMime(file.type, file.name)
  const claudeKey = settings?.agents?.claude?.key || ''

  try {
    let content = ''
    if (kind === 'text') {
      content = await readAsText(file)
    } else if (kind === 'pdf') {
      content = await extractPdf(file)
    } else if (kind === 'image') {
      content = await describeImage(file, claudeKey)
    } else if (kind === 'audio') {
      content = await transcribeAudio(file, settings)
    } else {
      return { ok: false, kind, error: `Unsupported file type: ${file.type || file.name}` }
    }
    return { ok: true, kind, content, filename: file.name, size: file.size }
  } catch (e) {
    return { ok: false, kind, error: e.message || 'extraction_failed' }
  }
}

/**
 * Format an ingested file for prepending to a user message.
 */
export function formatIngested(ingested) {
  if (!ingested?.ok) return ''
  const head = `[Attached: ${ingested.filename}]`
  return `${head}\n\n${ingested.content}\n\n---\n\n`
}
