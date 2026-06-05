/**
 * CHEAP MODEL — one-shot helper for the cheapest fast model the user has.
 * ======================================================================
 * Small, non-streaming-feeling calls that aren't part of the panel: project-
 * brief detection, dynamic suggested prompts. Prefers Gemini Flash (cheapest),
 * falls back to whatever orchestration model is connected so the feature still
 * works for a Claude/GPT-only user. Returns plain text; callers parse JSON with
 * parseJsonObject().
 *
 * Mirrors openClaw's proxy wiring (claude = JSON, gpt/gemini = SSE stream) but
 * stays self-contained so it never blocks the panel path.
 */

import { supabase } from './supabase'
import { selectOrchestrationModel } from './openClaw'
import { makeIdleTimeout, isAbort } from './fetchTimeout'

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

// Cheapest-first: Gemini Flash if available, else any connected orchestration
// model. Returns { provider, key } | null.
export function selectCheapModel(settings) {
  if (settings?.agents?.gemini?.key) return { provider: "gemini", key: settings.agents.gemini.key }
  return selectOrchestrationModel(settings)
}

async function streamSSE(res, kind, timeout) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = "", full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    timeout?.bump()
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop()
    for (const l of lines) {
      if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
      try {
        const d = JSON.parse(l.slice(6))
        if (kind === "gemini") {
          const t = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (t) full += t
        } else {
          const c = d.choices?.[0]?.delta?.content
          if (c) full += c
        }
      } catch { /* partial frame */ }
    }
  }
  return full
}

/**
 * One-shot completion. Returns { text, error }. Never throws.
 * `system` is prepended to `prompt` (the proxy endpoints take a single user
 * message), matching how callOpenClaw composes its calls.
 */
export async function callCheapModel({ system = "", prompt, settings, maxTokens = 1024 }) {
  const modelConfig = selectCheapModel(settings)
  if (!modelConfig) return { text: "", error: "no_model" }

  const composed = system ? `${system}\n\n${prompt}` : prompt
  const t = makeIdleTimeout()
  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: composed }], max_tokens: maxTokens }),
        signal: t.signal,
      })
      const data = await res.json()
      if (!res.ok || data.error) { t.clear(); return { text: "", error: `claude_${res.status}` } }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: composed }] }),
        signal: t.signal,
      })
      if (!res.ok) { t.clear(); return { text: "", error: `gpt_${res.status}` } }
      raw = await streamSSE(res, "gpt", t)
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: composed }] }] }),
        signal: t.signal,
      })
      if (!res.ok) { t.clear(); return { text: "", error: `gemini_${res.status}` } }
      raw = await streamSSE(res, "gemini", t)
    }
    t.clear()
    return { text: (raw || "").trim(), error: raw ? null : "empty" }
  } catch (e) {
    t.clear()
    return { text: "", error: isAbort(e) ? "timeout" : e.message }
  }
}

/**
 * Pull the first balanced { … } JSON object out of a model reply, tolerant of
 * ```json fences and surrounding prose. Returns the parsed object or null.
 */
export function parseJsonObject(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  if (start === -1) return null
  let depth = 0, inString = false, escape = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (c === "\\") { escape = true; continue }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) }
        catch { return null }
      }
    }
  }
  return null
}
