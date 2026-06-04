// Error classification drives which RECOVERY ACTION the user is offered, so the
// status→errorType mapping must be precise: a retired model must read as
// "model_unavailable" (→ Switch agent), not "invalid_key" (→ Fix key); an
// out-of-credits must not collapse into a generic "unknown". This locks it.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { classifyError } = await server.ssrLoadModule('/src/utils/errorClassify.js')

  check('401 → invalid_key', classifyError(401, '') === 'invalid_key')
  check('403 → invalid_key', classifyError(403, 'forbidden') === 'invalid_key')
  check('429 → rate_limited', classifyError(429, '') === 'rate_limited')
  check('402 → out_of_credits', classifyError(402, '') === 'out_of_credits')
  check('500 → service_down', classifyError(500, '') === 'service_down')
  check('503 → service_down', classifyError(503, '') === 'service_down')
  check('0 → network', classifyError(0, '') === 'network')
  check('200-ish/other → unknown', classifyError(418, '') === 'unknown')

  // A retired/no-access model: providers often 404 or 400/403 with a
  // model-not-found message. isModelError should win → model_unavailable, NOT
  // invalid_key — so the user is told to switch agents, not "fix your key".
  check('404 "model not found" → model_unavailable', classifyError(404, 'The model `grok-3` does not exist') === 'model_unavailable')
  check('model error outranks 403', classifyError(403, 'model `gpt-9` not found or you do not have access') === 'model_unavailable')

  // 429 splits: a transient rate-limit (retry works) vs an exhausted quota
  // (retrying now won't help — must add billing / switch / wait for reset).
  check('429 transient rate-limit → rate_limited', classifyError(429, 'Rate limit exceeded, please try again in 20s') === 'rate_limited')
  check('429 empty → rate_limited (default)', classifyError(429, '') === 'rate_limited')
  check('429 Gemini free-tier exhausted → quota_exceeded', classifyError(429, 'Resource has been exhausted (e.g. check quota).') === 'quota_exceeded')
  check('429 OpenAI insufficient_quota → quota_exceeded', classifyError(429, 'You exceeded your current quota, please check your plan and billing details. code: insufficient_quota') === 'quota_exceeded')
  check('429 free tier mention → quota_exceeded', classifyError(429, 'Quota exceeded for the free tier') === 'quota_exceeded')
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all error-classify checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
