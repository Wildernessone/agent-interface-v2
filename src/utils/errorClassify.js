import { isModelError } from '../config/models'

// Map an HTTP status (+ raw response text) to a stable errorType. This is what
// decides which RECOVERY ACTION the error card offers the user, so it must be
// precise — a retired model must not read as a bad key, an out-of-credits must
// not read as a generic failure. Extracted from TheInterface so it can be
// unit-tested in isolation.
//   model_unavailable → "Switch agent"      (retired/no-access model)
//   invalid_key       → "Fix key"           (401/403)
//   quota_exceeded    → "Switch agent"/billing (429 that is a daily/free-tier
//                       or plan quota, NOT a transient rate-limit — retrying
//                       now won't help, so we say so)
//   rate_limited      → "Retry" + wait      (transient 429)
//   out_of_credits    → "Add credits"       (402)
//   service_down      → "Retry"             (5xx)
//   network           → "Retry"             (status 0 — couldn't reach)
//   unknown           → "Retry"             (default; still recoverable)

// A 429 can mean two very different things. A daily/free-tier/plan quota is
// EXHAUSTED (Gemini free tier, OpenAI insufficient_quota) — "wait a moment"
// is wrong; the user must add billing, switch agents, or wait for a reset.
// A plain rate-limit is transient — a short wait + retry fixes it. We only
// treat the quota-specific phrases as exhaustion so we don't mislabel a
// transient "rate limit exceeded".
const QUOTA_EXHAUSTED = /insufficient_quota|exceeded your (current )?quota|quota metric|resource(_| has been )exhausted|free[\s_-]?tier|check your plan and billing/i

export function isQuotaExhausted(text) {
  return QUOTA_EXHAUSTED.test(String(text || ''))
}

export function classifyError(status, text) {
  // Checked before the generic 401/403 branch — some providers return 403 for
  // a model the account can't access, which is NOT a bad key.
  if (isModelError(status, text)) return 'model_unavailable'
  if (status === 401 || status === 403) return 'invalid_key'
  if (status === 429) return isQuotaExhausted(text) ? 'quota_exceeded' : 'rate_limited'
  if (status === 402) return 'out_of_credits'
  if (status >= 500) return 'service_down'
  if (status === 0) return 'network'
  return 'unknown'
}
