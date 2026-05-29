/**
 * AGENT PRICING — single source of truth for what each model costs.
 *
 * OpenClaw reads this when the user signals cost-sensitivity (frugal mode)
 * or quality-sensitivity (premium mode) and routes to whichever agents in
 * the user's CONNECTED set match the spend signal.
 *
 * Adaptive by design: if a user only has two agents connected, the
 * dispatcher sorts those two by inputCost and picks. The same logic
 * works for two agents, ten agents, or one. No hardcoded thresholds.
 *
 * When we add new providers (DeepSeek, Mistral, Cohere, etc.), add a
 * row here and OpenClaw learns about them automatically.
 *
 * Prices are USD per 1,000,000 tokens. Last updated 2026-05-29.
 */

export const AGENT_PRICING = {
  claude: {
    displayName: 'Claude Sonnet',
    inputCost:  3.00,
    outputCost: 15.00,
    tier: 'premium',
    strengths: 'nuanced reasoning, panel critique, synthesis, careful writing',
  },
  gpt: {
    displayName: 'GPT-4o',
    inputCost:  5.00,
    outputCost: 15.00,
    tier: 'premium',
    strengths: 'structured output, code, builder roles, numbers',
  },
  gemini: {
    displayName: 'Gemini 1.5 Flash',
    inputCost:  0.075,
    outputCost: 0.30,
    tier: 'budget',
    strengths: 'cheap high-volume reasoning, research, fact-checking',
  },
  grok: {
    displayName: 'Grok 2',
    inputCost:  5.00,
    outputCost: 15.00,
    tier: 'premium',
    strengths: 'contrarian, skeptic, direct opinions, pattern-spotting',
  },
  // Future entries land here — add the row, OpenClaw picks it up.
  // deepseek: { displayName: 'DeepSeek R1', inputCost: 0.27, outputCost: 1.10, tier: 'budget',  strengths: '...' },
  // mistral:  { displayName: 'Mistral Large', inputCost: 2.00, outputCost: 6.00,  tier: 'mid',     strengths: '...' },
  // cohere:   { displayName: 'Cohere Command R+', inputCost: 2.50, outputCost: 10.00, tier: 'mid',  strengths: '...' },
}

export function pricingFor(agentId) {
  return AGENT_PRICING[agentId] || null
}

/**
 * Sort a list of connected agent ids cheapest-first by input cost.
 * Used by the dispatcher to know which agent to lean on in frugal mode
 * (front of the list) vs. premium mode (back of the list, usually more
 * capable models).
 */
export function sortByCost(agentIds) {
  return [...agentIds].sort((a, b) => {
    const pa = pricingFor(a)?.inputCost ?? 999
    const pb = pricingFor(b)?.inputCost ?? 999
    return pa - pb
  })
}

/**
 * Render a compact pricing table for the orchestrator prompt. Only
 * includes agents the user actually has connected so the dispatcher
 * doesn't reason about models that aren't available.
 */
export function pricingTableFor(agentIds) {
  const sorted = sortByCost(agentIds)
  return sorted.map(id => {
    const p = pricingFor(id)
    if (!p) return `  - ${id}: (unknown pricing)`
    return `  - ${id}: $${p.inputCost.toFixed(3)}/M input, $${p.outputCost.toFixed(2)}/M output (${p.tier}) — ${p.strengths}`
  }).join('\n')
}
