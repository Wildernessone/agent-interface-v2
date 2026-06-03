import { modelsToTry, isModelError } from '../config/models'
import { supabase } from './supabase'

// Lightweight per-provider health check. Sends a 1-token request through the
// proxy with the configured model(s) and reports whether the agent is actually
// reachable — so a retired model / bad key / rate limit shows up in Settings
// before it breaks a real conversation. Tries the model fallback chain so a
// retired primary still reports "ok" via a fallback.

const PROXY = import.meta.env.VITE_PROXY_URL || 'https://claude-proxy.jamesreed.workers.dev'

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

const ROUTES = {
  claude: { path: 'claude', headers: k => ({ 'x-api-key': k }),            body: m => ({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }) },
  gpt:    { path: 'gpt',    headers: k => ({ Authorization: `Bearer ${k}` }), body: m => ({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }) },
  gemini: { path: 'gemini', headers: k => ({ 'x-api-key': k }),            body: m => ({ model: m, contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }) },
  grok:   { path: 'grok',   headers: k => ({ Authorization: `Bearer ${k}` }), body: m => ({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }) },
}

export async function testConnection(provider, key) {
  const cfg = ROUTES[provider]
  if (!cfg) return { ok: false, reason: 'unknown provider' }
  if (!key) return { ok: false, reason: 'no key' }

  const auth = await authHeader()
  const ids = modelsToTry(provider)
  let status = 0, text = '', triedModel
  for (const model of (ids.length ? ids : [undefined])) {
    triedModel = model
    try {
      const res = await fetch(`${PROXY}/${cfg.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cfg.headers(key), ...auth },
        body: JSON.stringify(cfg.body(model)),
      })
      if (res.ok) return { ok: true, model }
      status = res.status
      text = await res.text().catch(() => '')
      if (!isModelError(status, text)) break  // auth/rate/server error — fallback won't help
    } catch (e) {
      status = 0; text = e.message || 'network'
      break
    }
  }

  const reason =
    status === 401 || status === 403 ? 'key rejected' :
    status === 402 ? 'out of credits' :
    status === 429 ? 'rate limited' :
    isModelError(status, text) ? 'model unavailable' :
    status >= 500 ? 'provider down' :
    status === 0 ? 'network error' :
    `error ${status}`
  // `detail` = the provider's own message (dug out of its JSON if present), so
  // Settings can show e.g. "grok-4 — model does not exist" instead of just
  // "model unavailable". This is how we diagnose which model x.ai rejects.
  let human
  try { const j = JSON.parse(text); human = j?.error?.message || j?.error || j?.message || '' } catch { human = text }
  if (typeof human !== 'string') human = ''
  const detail = String(human).replace(/\s+/g, ' ').trim().slice(0, 200) || null
  return { ok: false, reason, status, model: triedModel, detail }
}
