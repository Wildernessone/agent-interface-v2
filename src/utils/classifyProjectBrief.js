/**
 * CLASSIFY PROJECT BRIEF
 * ======================
 * One cheap fast-model call that decides whether a user message is actually a
 * substantive brand/product brief (names a thing, says what it is + who for +
 * what's unique) — so the app can offer to remember it as a project instead of
 * making the user create one by hand first.
 *
 * Returns { is_project_brief, confidence, extracted: {name,type,description,
 * audience,voice} }. Never throws — on any failure returns is_project_brief:false.
 */

import { callCheapModel, parseJsonObject } from './cheapModel'

const SYSTEM =
  "You are a precise classifier. Return ONE JSON object and nothing else — " +
  "begin with `{` and end with `}`. No prose, no markdown, no code fences."

export async function classifyProjectBrief(messageText, settings) {
  const text = (messageText || '').trim()
  if (text.length < 150) return { is_project_brief: false, confidence: 0, extracted: null }

  const prompt = [
    "Analyze this user message. Does it contain a substantive brand/product/",
    "project brief — naming a thing they're working on, describing what it is,",
    "who it's for, what makes it unique?",
    "",
    "If YES, extract:",
    "  - name: the brand/product name",
    "  - type: 1-3 words ('hunting deal tracker', 'coffee roastery', 'newsletter platform')",
    "  - description: 2-3 sentences capturing what it does, who for, what's unique — in the user's voice",
    "  - audience: who it's for",
    "  - voice: tone/style if mentioned (else empty string)",
    "",
    "If NO, return {\"is_project_brief\": false}.",
    "",
    "Bias toward catching project briefs (better to ask than miss). But require",
    "at least: a name mentioned, plus a description of what the thing is. Casual",
    "chat about projects without specifics should return false.",
    "",
    "Return JSON exactly shaped like:",
    '{ "is_project_brief": true, "confidence": 0.0-1.0, "extracted": { "name": "", "type": "", "description": "", "audience": "", "voice": "" } }',
    "",
    "=== MESSAGE ===",
    text.slice(0, 4000),
  ].join("\n")

  try {
    const { text: raw } = await callCheapModel({ system: SYSTEM, prompt, settings, maxTokens: 500 })
    const parsed = parseJsonObject(raw)
    if (!parsed || parsed.is_project_brief !== true) {
      return { is_project_brief: false, confidence: Number(parsed?.confidence) || 0, extracted: null }
    }
    const e = parsed.extracted || {}
    const extracted = {
      name: String(e.name || '').trim(),
      type: String(e.type || '').trim(),
      description: String(e.description || '').trim(),
      audience: String(e.audience || '').trim(),
      voice: String(e.voice || '').trim(),
    }
    // Require the minimum: a name and a description of what the thing is.
    if (!extracted.name || extracted.description.length < 20) {
      return { is_project_brief: false, confidence: 0, extracted: null }
    }
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    return { is_project_brief: true, confidence, extracted }
  } catch {
    return { is_project_brief: false, confidence: 0, extracted: null }
  }
}

/**
 * Compose a single project `description` (the field the brand-context gate and
 * agent-prompt injection read) from the classifier's structured extraction.
 * Structured so it reliably clears MIN_BRAND_CONTEXT_CHARS and carries voice +
 * audience into every future conversation in the project.
 */
export function briefToDescription(extracted) {
  if (!extracted) return ''
  const lines = []
  if (extracted.description) lines.push(`What it is: ${extracted.description}`)
  if (extracted.audience) lines.push(`Audience: ${extracted.audience}`)
  if (extracted.voice) lines.push(`Voice & tone: ${extracted.voice}`)
  return lines.join('\n').trim()
}
