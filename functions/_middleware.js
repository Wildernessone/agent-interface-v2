// Runs on every request. Two fire-and-forget jobs (SideWRK's proven pattern):
//  1) AI-crawler logging: when an LLM / answer-engine bot fetches a real page,
//     record it to ai_crawls — the leading indicator that engines read us
//     (they crawl before they cite).
//  2) AI-referral logging: a HUMAN landing here from an AI assistant's app
//     (Perplexity, ChatGPT, Gemini…) — the payoff signal: an answer named us
//     and someone clicked through.
// NEVER blocks or breaks the response (waitUntil + swallowed errors); skips
// asset requests so the log stays page-level.

const AI_BOTS = [
  ['GPTBot', /GPTBot/i],
  ['OAI-SearchBot', /OAI-SearchBot/i],
  ['ChatGPT-User', /ChatGPT-User/i],
  ['PerplexityBot', /PerplexityBot/i],
  ['Perplexity-User', /Perplexity-User/i],
  ['ClaudeBot', /ClaudeBot/i],
  ['Claude-User', /Claude-User/i],
  ['Claude-SearchBot', /Claude-SearchBot/i],
  ['anthropic-ai', /anthropic-ai/i],
  ['Google-Extended', /Google-Extended/i],
  ['Applebot-Extended', /Applebot-Extended/i],
  ['Bytespider', /Bytespider/i],
  ['Amazonbot', /Amazonbot/i],
  ['meta-externalagent', /meta-externalagent|FacebookBot\/AI/i],
  ['CCBot', /CCBot/i],
  ['cohere-ai', /cohere-ai/i],
  ['YouBot', /YouBot/i],
  ['DuckAssistBot', /DuckAssistBot/i],
  ['Diffbot', /Diffbot/i],
]

const AI_REFERRERS = [
  ['Perplexity', /(^|\.)perplexity\.ai$/i],
  ['ChatGPT', /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i],
  ['Gemini', /(^|\.)gemini\.google\.com$/i],
  ['Copilot', /(^|\.)copilot\.microsoft\.com$/i],
  ['Claude', /(^|\.)claude\.ai$/i],
  ['Grok', /(^|\.)(grok\.com|x\.ai)$/i],
  ['Meta AI', /(^|\.)meta\.ai$/i],
  ['You.com', /(^|\.)you\.com$/i],
  ['Poe', /(^|\.)poe\.com$/i],
  ['Phind', /(^|\.)phind\.com$/i],
]

const SKIP = /\.(js|mjs|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|map|mp4|webm|pdf)$/i

// Vulnerability-scanner probes wearing spoofed crawler UAs (.git, env/config
// files, wp-admin…). Real AI crawlers never request these; logging them as
// "GPTBot read us" poisons the stats. Don't log — they 404 anyway.
const PROBE = /(^|\/)\.(git|env|aws|ssh|svn|DS_Store)|\.(ya?ml|properties|ini|bak|sql|pem|key)$|wp-(admin|login|content)|phpinfo|\.php$|\/etc\/passwd/i

const SB = 'https://oqbpuspnmznqxgkmyzyb.supabase.co'
const ANON = 'sb_publishable_hbloUBTnVl7-2kSMtCbu8A_lfzoId9Z'

const detectBot = ua => { if (!ua) return null; for (const [n, re] of AI_BOTS) if (re.test(ua)) return n; return null }
const detectRef = ref => {
  if (!ref) return null
  let h; try { h = new URL(ref).hostname } catch { return null }
  for (const [n, re] of AI_REFERRERS) if (re.test(h)) return n
  return null
}

const log = (context, table, row) => context.waitUntil(
  fetch(SB + '/rest/v1/' + table, {
    method: 'POST',
    headers: { apikey: ANON, authorization: 'Bearer ' + ANON, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify(row),
  }).catch(() => {})
)

export async function onRequest (context) {
  const { request } = context
  const url = new URL(request.url)
  const page = !SKIP.test(url.pathname) && !PROBE.test(url.pathname)
  if (page) {
    const ua = request.headers.get('user-agent') || ''
    const bot = detectBot(ua)
    const country = request.headers.get('cf-ipcountry') || null
    if (bot) {
      log(context, 'ai_crawls', { bot, path: url.pathname.slice(0, 300), ua: ua.slice(0, 400), country })
    } else {
      const ref = request.headers.get('referer') || ''
      const src = detectRef(ref)
      if (src) log(context, 'ai_referrals', { source: src, referrer: ref.slice(0, 300), path: url.pathname.slice(0, 300), country })
    }
  }
  return context.next()
}
