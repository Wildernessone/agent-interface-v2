// Entitlement enforcement — the hard caps applied to every turn. A Free user
// must get 1 agent + 1 tool and no memory; Standard 1 agent + 2 tools + memory;
// Pro everything. These are the unbypassable gates the send path uses.
import { createServer } from 'vite'

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

const server = await createServer({ root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })
try {
  const { entitlements, capAgents, capTools, capNudge } = await server.ssrLoadModule('/src/utils/entitlements.js')

  const NOW = 1_900_000_000_000, DAY = 86400000
  const startedDaysAgo = (n) => ({ trial_starts_at: new Date(NOW - n * DAY).toISOString() })
  const ents = (billing) => entitlements(billing, NOW)

  const free = ents(startedDaysAgo(25))     // past trial → free
  const standard = ents(startedDaysAgo(17))  // day 17 → standard
  const pro = ents(startedDaysAgo(3))        // day 3 → pro

  // ── Resolved limits per tier ────────────────────────────────────────
  check('free → 1 agent/1 tool, no memory/storage', free.tier === 'free' && free.agents === 1 && free.tools === 1 && !free.memory && !free.storage)
  check('standard → 1 agent/2 tools, memory+storage', standard.tier === 'standard' && standard.agents === 1 && standard.tools === 2 && standard.memory && standard.storage)
  check('pro → unlimited, everything', pro.tier === 'pro' && pro.agents === null && pro.tools === null && pro.memory && pro.storage)

  // ── capAgents ───────────────────────────────────────────────────────
  const four = ['claude', 'gpt', 'gemini', 'grok']
  check('free caps 4 agents → 1', capAgents(four, free).agents.length === 1 && capAgents(four, free).trimmed === 3)
  check('standard caps 4 agents → 1', capAgents(four, standard).agents.length === 1)
  check('pro keeps all 4 agents', capAgents(four, pro).agents.length === 4 && capAgents(four, pro).trimmed === 0)

  // ── capTools (flips over-limit tools off) ───────────────────────────
  const tools = { dalle: { enabled: true }, perplexity: { enabled: true }, exa: { enabled: true } }
  const fr = capTools(tools, free)
  check('free keeps exactly 1 tool enabled', Object.values(fr.tools).filter(Boolean).length === 1 && fr.trimmed === 2)
  const st = capTools(tools, standard)
  check('standard keeps exactly 2 tools enabled', Object.values(st.tools).filter(Boolean).length === 2 && st.trimmed === 1)
  check('pro keeps all 3 tools', Object.values(capTools(tools, pro).tools).filter(Boolean).length === 3)

  // ── nudge copy ──────────────────────────────────────────────────────
  check('free nudge mentions 1 agent + 1 tool + Pro', /1 agent at a time and 1 tool at a time/.test(capNudge({ agentsTrimmed: 3, toolsTrimmed: 2 }, free) || '') && /Upgrade to Pro/.test(capNudge({ agentsTrimmed: 1, toolsTrimmed: 0 }, free)))
  check('no nudge when nothing trimmed', capNudge({ agentsTrimmed: 0, toolsTrimmed: 0 }, free) === null)
  check('pro never trims, never nudges', capNudge({ agentsTrimmed: 0, toolsTrimmed: 0 }, pro) === null)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\n✅ all entitlement checks passed' : `\n❌ ${failures} check(s) failed`)
process.exit(failures ? 1 : 0)
