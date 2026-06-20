// ─────────────────────────────────────────────────────────────
// MODELS — single source of truth for the default model per provider.
//
// Why this exists: providers retire/rename models on their own schedule
// (grok-2 → grok-3, etc.). Model IDs used to live hardcoded in the
// separately-deployed proxy worker, so a model change meant editing AND
// redeploying the worker — and the repo/worker would silently drift.
//
// Now the CLIENT sends the model on every call (the worker honors
// `body.model || <its default>`), so:
//   • Updating a model is a one-line edit HERE, shipped with the normal
//     app deploy — no worker redeploy, no drift.
//   • If a model is retired, the call falls back to the next id in `fallbacks`
//     (see modelsToTry) instead of hard-failing.
// ─────────────────────────────────────────────────────────────

export const MODELS = {
  claude: { primary: 'claude-sonnet-4-6', fallbacks: ['claude-sonnet-4-5', 'claude-3-5-sonnet-latest'] },
  gpt:    { primary: 'gpt-4o',            fallbacks: ['gpt-4o-mini', 'gpt-4-turbo'] },
  gemini: { primary: 'gemini-2.5-flash',  fallbacks: ['gemini-2.0-flash', 'gemini-1.5-flash'] },
  grok:   { primary: 'grok-4.3',          fallbacks: ['grok-4', 'grok-3'] },  // x.ai retired grok-3/grok-2 on 2026-05-15; grok-4.3 is current
  deepseek: { primary: 'deepseek-chat',   fallbacks: ['deepseek-reasoner'] }, // V3 chat; reasoner = R1
}

// The provider's preferred model.
export function modelFor(provider) {
  return MODELS[provider]?.primary
}

// All models to try in order (primary, then fallbacks) — used by the
// model-not-found fallback so a retired primary degrades gracefully.
export function modelsToTry(provider) {
  const m = MODELS[provider]
  if (!m) return []
  return [m.primary, ...(m.fallbacks || [])]
}

// Heuristic: did this failure look like "the model name is bad" (retired,
// renamed, or not enabled for this account) rather than a transient/auth issue?
// Used to decide whether to fall back to the next model and to classify the
// error for the user.
export function isModelError(status, text) {
  const t = String(text || '').toLowerCase()
  if (status === 404) return true
  if ((status === 400 || status === 403) &&
      /(model|decommission|not found|does not exist|unsupported|deprecat|no access|must be verified)/.test(t)) {
    return true
  }
  return false
}
