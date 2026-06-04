import { isModelError } from '../config/models'

// Map an HTTP status (+ raw response text) to a stable errorType. This is what
// decides which RECOVERY ACTION the error card offers the user, so it must be
// precise — a retired model must not read as a bad key, an out-of-credits must
// not read as a generic failure. Extracted from TheInterface so it can be
// unit-tested in isolation.
//   model_unavailable → "Switch agent"   (retired/no-access model)
//   invalid_key       → "Fix key"        (401/403)
//   rate_limited      → "Retry" + wait   (429)
//   out_of_credits    → "Add credits"    (402)
//   service_down      → "Retry"          (5xx)
//   network           → "Retry"          (status 0 — couldn't reach)
//   unknown           → "Retry"          (default; still recoverable)
export function classifyError(status, text) {
  // Checked before the generic 401/403 branch — some providers return 403 for
  // a model the account can't access, which is NOT a bad key.
  if (isModelError(status, text)) return 'model_unavailable'
  if (status === 401 || status === 403) return 'invalid_key'
  if (status === 429) return 'rate_limited'
  if (status === 402) return 'out_of_credits'
  if (status >= 500) return 'service_down'
  if (status === 0) return 'network'
  return 'unknown'
}
