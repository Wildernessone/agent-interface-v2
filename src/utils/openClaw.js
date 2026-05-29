/**
 * AGENT INTERFACE — OpenClaw v3
 * ================================
 * The compiler at the heart of Agent Interface.
 * Reads the roundtable, decides who talks, what tools fire, and what to build.
 */

import { supabase } from './supabase'
import { pricingTableFor, sortByCost, pricingFor } from './agentPricing'

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

// ── Role pool ────────────────────────────────────────
export const ROLE_POOL = {
  skeptic: { name: "Skeptic", purpose: "Find what's broken. Do not agree with the premise. Only 'no, because' — never 'yes, and'. If you genuinely cannot find a flaw, say so explicitly: 'I can't find a flaw here, and here's why this is unusually solid.' That rare admission is your most useful signal — never fake skepticism, never fake comfort." },
  reality_checker: { name: "Reality Checker", purpose: "Surface unstated assumptions and missing context. Ask the questions the user didn't think to ask. What does this plan require that we have not confirmed the user has — money, time, connections, skills, access, audience? No opinions on the idea itself — only flag what's unspoken." },
  builder: { name: "Builder", purpose: "Take the idea seriously and figure out how it would actually work on day one with what's in front of us right now. Constructive and concrete. Specific first step, specific tool, specific output. No hand-waving." },
  synthesizer: { name: "Synthesizer", purpose: "Write the actual read across what everyone said. Not consensus — real conclusions, including the disagreements that didn't resolve. Example shape: 'Three of us think this is solid. The Skeptic's objection is X, and it wasn't answered. Here's what to do about it.'" },
  pattern_spotter: { name: "Pattern Spotter", purpose: "Notice the shape underneath. Connect this idea to structures from other domains, prior conversations the user mentioned, or recurring patterns the user might not see. One sharp connection beats five vague ones." },
  steel_manner: { name: "Steel-Manner", purpose: "Argue for the idea as strongly as possible. Make the best version of the case before anyone tears it down. Even if you privately disagree, your job is to articulate why this could actually work, taken at its strongest." },
  numbers_person: { name: "Numbers Person", purpose: "Get concrete about money, time, and math. Real numbers — costs, hours, conversion rates, break-evens, traffic estimates. If you have to estimate, estimate openly and show the math. No vague 'this could be profitable' — give actual figures." },
  translator: { name: "Translator", purpose: "Restate the idea or the discussion in plainer terms. Strip the jargon. Confirm everyone (user + other agents) is using the same words to mean the same things." },
  historian: { name: "Historian", purpose: "Pull in what we've discussed before — prior conversations, memory the user has confirmed, decisions they've already made. Bring continuity. Surface a contradiction with something they said earlier if you spot one." },
}

const ROLE_IDS = Object.keys(ROLE_POOL)
const SPEND_MODES = ['frugal', 'balanced', 'premium']

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

export function selectOrchestrationModel(settings) {
  if (settings?.agents?.claude?.key) return { provider: "claude", key: settings.agents.claude.key }
  if (settings?.agents?.gpt?.key) return { provider: "gpt", key: settings.agents.gpt.key }
  if (settings?.agents?.gemini?.key) return { provider: "gemini", key: settings.agents.gemini.key }
  return null
}

function extractJson(text) {
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

async function callOpenClaw(prompt, modelConfig) {
  if (!modelConfig) return { decision: null, raw: null, error: "no_model" }

  const system =
    "You are OpenClaw — the compiler inside Agent Interface. " +
    "Your only job is to return ONE JSON object that follows the schema exactly. " +
    "Begin your response with `{` and end with `}`. No prose. No markdown. No code fences."

  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }], max_tokens: 2048 }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { decision: null, raw: data, error: `claude_${res.status}` }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
      })
      raw = await streamToText(res, "gpt")
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }),
      })
      raw = await streamToText(res, "gemini")
    }
    const decision = extractJson(raw)
    return { decision, raw, error: decision ? null : "parse_failed" }
  } catch (e) {
    return { decision: null, raw: null, error: e.message }
  }
}

async function streamToText(res, kind) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = "", full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop()
    for (const l of lines) {
      if (!l.startsWith("data: ")) continue
      if (l.includes("[DONE]")) continue
      try {
        const d = JSON.parse(l.slice(6))
        if (kind === "gemini") {
          const t = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (t) full += t
        } else {
          const c = d.choices?.[0]?.delta?.content
          if (c) full += c
        }
      } catch {}
    }
  }
  return full
}

function buildOrchestratorPrompt({
  userMessage, agentSummary, toolList, memorySummary, enabledAgents,
  activeProject, isCorrection, isBuildSignal, hasPriorDiscussion,
  voiceMode, previousRoleAssignments, routingPerformance, previousSpendMode,
}) {
  const roleCatalog = Object.entries(ROLE_POOL)
    .map(([id, r]) => `  - "${id}" (${r.name}): ${r.purpose.split('.')[0]}.`)
    .join("\n")

  const previousAssignmentsLine = previousRoleAssignments && Object.keys(previousRoleAssignments).length
    ? Object.entries(previousRoleAssignments).map(([a, r]) => `${a}=${r}`).join(", ")
    : "(none — this is the first turn or roles weren't assigned last turn)"

  const perfBlock = routingPerformance && routingPerformance.length
    ? routingPerformance.filter(p => p.agent_id !== '_any_').slice(0, 12)
        .map(p => `  - ${p.agent_id} as ${p.role_id}: ${p.total} turns, ${p.positive_pct}% positive`).join("\n") || "(no actionable signal yet)"
    : "(no signal yet — first few sessions, weight tendencies above instead)"

  const requestedRoles = routingPerformance?.filter(p => p.agent_id === '_any_').map(p => p.role_id) || []
  const requestedHint = requestedRoles.length ? `\nThe user has previously asked for these roles explicitly: ${requestedRoles.join(", ")}` : ""

  // Adaptive pricing context — only shows agents the user has connected.
  // Sorted cheapest-first so frugal mode picks naturally from the top.
  const pricingBlock = enabledAgents.length
    ? pricingTableFor(enabledAgents)
    : '  (no agents available)'
  const cheapest = sortByCost(enabledAgents)[0]
  const mostExpensive = sortByCost(enabledAgents).slice(-1)[0]

  return `
You are the DISPATCHER for a panel of specialist AIs. You are NOT a fifth voice in the rotation.
Your job: read the user's intent, decide who speaks, assign roles, and decide what spend mode the conversation is in.

INPUT
=====
USER MESSAGE: "${userMessage}"
PRIOR AGENT DISCUSSION: ${hasPriorDiscussion ? "yes" : "none"}
EXPLICIT BUILD APPROVAL DETECTED: ${isBuildSignal ? "yes" : "no"}
IS CORRECTION: ${isCorrection}
VOICE MODE: ${voiceMode}

AGENTS CONNECTED & PRICING (sorted cheapest-first):
${pricingBlock}
${enabledAgents.length > 1 ? `Cheapest: ${cheapest}.  Most expensive: ${mostExpensive}.` : ''}

TOOLS AVAILABLE: ${toolList || "none"}
ACTIVE PROJECT: ${activeProject?.name || "none"}${activeProject?.description ? ` — ${activeProject.description}` : ""}

USER MEMORY:
${memorySummary || "none"}

WHAT AGENTS SAID JUST NOW:
${agentSummary || "(nothing yet — first message in this thread)"}

PREVIOUS TURN'S ROLE ASSIGNMENTS: ${previousAssignmentsLine}
PREVIOUS TURN'S SPEND MODE: ${previousSpendMode || "(none — first turn)"}

PRIOR ROUTING OUTCOMES FOR THIS USER (90-day rolling):
${perfBlock}${requestedHint}

ROLE POOL:
${roleCatalog}

SPEND MODE
==========
Read the user's message + recent conversation for cost vs. quality cues:

FRUGAL — user wants exploratory/cheap thinking. Triggers:
  "brainstorm", "just thinking", "rough idea", "quick", "save tokens",
  "affordable", "exploratory", "casual", "no need to overthink".
  Routing: prefer the CHEAPEST available agents. If only premium agents are
  connected, pick the cheapest of those. Skills get force-disabled. V2 audit
  skipped. Single round.

PREMIUM — user wants this done right, cost is not the constraint. Triggers:
  "build this right", "bulletproof", "make sure it's solid", "for investors",
  "final version", "production ready", "be thorough", "polish this".
  Routing: prefer the MOST CAPABLE available agents (usually highest-priced).
  Skills get force-enabled. V2 audit on every critical role. 2-3 rounds.

BALANCED — default. Anything else.
  Routing: pick what fits the role best regardless of cost.
  Skills and audit respect the user's existing per-agent settings.

ADAPTIVE TO WHAT'S CONNECTED — this matters:
- The user might have only 2 agents connected, or 6. Always reason RELATIVE
  to what's in the AGENTS CONNECTED list above, not against an absolute scale.
- If they have only one agent: spend mode is informational, that's the only choice.
- If they have only premium agents (no budget tier): frugal still means
  "cheapest of these", not "can't fulfill".
- If a budget-tier agent (e.g. gemini) is available and user signals frugal,
  lean on it heavily — it's ~40x cheaper than premium agents.

MODE STICKINESS:
- Mode persists from previous turn unless user signals a shift.
- Build approval ("build it") forces minimum balanced.
- If the message mixes signals ("brainstorm me a bulletproof pitch") —
  premium wins. Quality signal overrides cost signal in conflict.

ROLE ASSIGNMENT RULES
=====================
- Roles are ASSIGNMENTS, not identities. Same agent can play different roles
  on different turns. Sticky by default — reassign only when the SHAPE of
  the conversation shifts (brainstorm → stress-test), not the topic.
- FRICTION RULE: on multi-agent discuss turns with 2+ agents, MUST include
  at least one critical role (Skeptic OR Reality Checker) unless:
    • Voice mode is on
    • User explicitly asked for supportive mode ("hype me up", "no critique")
    • We already did a critical pass; this turn is synthesis or building
  Builder + Numbers Person + Steel-Manner is WRONG — no friction. Always
  pair generative roles with one that finds the flaw.
- Pick 2-3 roles per turn. Silence from a role is a meaningful signal.
- Match role to agent strengths (use the strengths field in the pricing
  table above as a guide — these are tendencies, not rules).
- PRIOR ROUTING OUTCOMES are a TIEBREAKER, not an override. Sample sizes
  under 5 are noise.

DECISION TREE (first match wins)
================================
1. If TOOLS AVAILABLE includes a search tool AND user asked a search question:
     → mode = "build", plan = [{tool: <search>, prompt: <topic>}], agents_to_respond = []

2. If EXPLICIT BUILD APPROVAL DETECTED yes AND PRIOR AGENT DISCUSSION yes:
     → mode = "build"
     → agents_to_respond = []
     → deliverable = short folder-friendly name
     → plan = multi-step graph using available tools + internal tools
       (agent_synth, pptxgen, docgen, pdfgen, narrate_per_slide, gmail)
     → Internal tools always available. See BUILD-INTERNAL TOOLS section below.

3. Otherwise:
     → mode = "discuss", plan = []
     → agents_to_respond = 2-3 from AGENTS CONNECTED, biased by spend_mode
     → role_assignments mapping each to a role_id, honoring stickiness
     → rounds = 1 for simple Q&A, 2 for back-and-forth, 3 for genuine debate
     → In frugal: 1 round, cheapest agents. In premium: up to 3, capable agents.

BUILD-INTERNAL TOOLS (always available in build mode):
- agent_synth (returns JSON; use output_schema "slides" or "document")
- pptxgen (slides[] → .pptx)
- docgen (sections[] or slides[] → .docx)
- pdfgen (sections[] or slides[] or text → .pdf)
- narrate_per_slide (slides[] → per-slide audio with timing)
- gmail ({to,subject,body} → sent email)

Variable interpolation: "{stepId}" or "{stepId.field}" in input.
Dependency order via needs[].

OUTPUT (return EXACTLY this JSON, no preface, no fence):
{
  "mode": "discuss" | "build",
  "spend_mode": "frugal" | "balanced" | "premium",
  "agents_to_respond": ["<agent_id>", ...],
  "role_assignments": { "<agent_id>": "<role_id>" },
  "rounds": 1,
  "response_mode": "concise" | "balanced" | "detailed",
  "deliverable": "<short folder name for build, or null in discuss>",
  "plan": { "steps": [{ "id": "...", "tool": "...", "needs": [], "input": "...", "label": "...", "output_schema": "slides" }] },
  "correction": { "detected": false, "what_was_wrong": null, "what_user_wants": null, "save_to_memory": false, "memory_entry": null },
  "voice_response_chars": 300,
  "reasoning": "one sentence: why this mode, these agents, this spend tier"
}
`.trim()
}

export async function orchestrate({
  userMessage, conversationHistory = [], agentResponses = [],
  enabledAgents = [], enabledTools = {}, memory = [], activeProject = null,
  previousRoleAssignments = {}, previousSpendMode = null,
  routingPerformance = [], settings, voiceMode = false,
}) {
  const modelConfig = selectOrchestrationModel(settings)

  const agentSummary = agentResponses
    .map(r => `${r.agent?.toUpperCase()}: ${(r.text || "").slice(0, 400)}`)
    .join("\n\n")

  const toolList = Object.entries(enabledTools).filter(([, v]) => v).map(([id]) => id).join(", ")
  const memorySummary = memory.slice(0, 5).map(m => `[${m.title}]: ${(m.content || "").slice(0, 150)}`).join("\n")

  const correctionPhrases = ["that's not what i meant", "no i wanted", "wrong", "not right", "try again", "that's not", "i said", "i meant", "actually"]
  const isCorrection = correctionPhrases.some(p => userMessage.toLowerCase().includes(p))

  const buildSignals = [
    "build it", "build this", "let's build", "go build", "ship it", "let's ship",
    "go for it", "let's go", "do it now", "yes do it", "yes build", "yes make it",
    "perfect, build", "great, build", "ok build", "let's make this",
    "go ahead and build", "fire the tools", "make it", "do it",
  ]
  const lower = userMessage.toLowerCase()
  const isBuildSignal = buildSignals.some(p => lower.includes(p))
  const hasPriorDiscussion = agentResponses.length > 0

  const prompt = buildOrchestratorPrompt({
    userMessage, agentSummary, toolList, memorySummary, enabledAgents,
    activeProject, isCorrection, isBuildSignal, hasPriorDiscussion, voiceMode,
    previousRoleAssignments, routingPerformance, previousSpendMode,
  })

  if (!modelConfig) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: "No orchestrator model configured — defaulted to discuss." }
  }

  const { decision, raw, error } = await callOpenClaw(prompt, modelConfig)
  if (raw) console.log("[OpenClaw]", raw.slice(0, 600))
  if (error) console.warn("[OpenClaw error]", error)

  if (!decision) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: `OpenClaw fallback — ${error || "no decision"}.` }
  }

  // Filter agents_to_respond to enabled
  if (Array.isArray(decision.agents_to_respond)) {
    decision.agents_to_respond = decision.agents_to_respond.filter(a => enabledAgents.includes(a))
    if (decision.mode !== "build" && decision.agents_to_respond.length === 0) {
      decision.agents_to_respond = enabledAgents
    }
  }

  // Validate spend_mode. Build approval forces at least balanced regardless of
  // what came back from the LLM — you're past brainstorming if you're building.
  if (!SPEND_MODES.includes(decision.spend_mode)) {
    decision.spend_mode = previousSpendMode && SPEND_MODES.includes(previousSpendMode) ? previousSpendMode : 'balanced'
  }
  if (isBuildSignal && decision.spend_mode === 'frugal') {
    decision.spend_mode = 'balanced'
  }

  // Sanitize role_assignments
  const cleanRoles = {}
  if (decision.role_assignments && typeof decision.role_assignments === "object") {
    for (const [agent, role] of Object.entries(decision.role_assignments)) {
      if (decision.agents_to_respond?.includes(agent) && ROLE_IDS.includes(role)) cleanRoles[agent] = role
    }
  }
  decision.role_assignments = cleanRoles

  // Normalize plan
  const BUILD_INTERNAL_TOOLS = new Set(['agent_synth', 'pptxgen', 'docgen', 'pdfgen', 'narrate_per_slide', 'gmail'])
  const isToolAllowed = (toolId) => BUILD_INTERNAL_TOOLS.has(toolId) || !!enabledTools?.[toolId]

  let steps = []
  let deliverable = decision.deliverable || null
  if (Array.isArray(decision.plan)) {
    steps = decision.plan.filter(s => s?.tool && isToolAllowed(s.tool)).map((s, i) => ({
      id: s.id || `step_${i}`, tool: s.tool,
      input: s.input || s.prompt || '', needs: [],
      label: s.label || s.tool, output_schema: s.output_schema,
    }))
  } else if (decision.plan?.steps && Array.isArray(decision.plan.steps)) {
    steps = decision.plan.steps.filter(s => s?.id && s?.tool && isToolAllowed(s.tool)).map(s => ({
      id: s.id, tool: s.tool,
      input: s.input || s.prompt || '', needs: Array.isArray(s.needs) ? s.needs : [],
      label: s.label || s.tool, output_schema: s.output_schema,
    }))
    deliverable = decision.plan.deliverable || deliverable
  }
  const validIds = new Set(steps.map(s => s.id))
  steps = steps.map(s => ({ ...s, needs: s.needs.filter(n => validIds.has(n)) }))
  decision.plan = { deliverable, steps }

  if (decision.mode === "build" && steps.length === 0) {
    decision.mode = "discuss"
    decision.agents_to_respond = decision.agents_to_respond?.length ? decision.agents_to_respond : enabledAgents
    decision.reasoning = (decision.reasoning || "") + " (no usable tool in plan — switched to discuss)"
  }

  return decision
}

function defaultDecision(enabledAgents, voiceMode) {
  return {
    mode: "discuss",
    spend_mode: 'balanced',
    agents_to_respond: enabledAgents,
    role_assignments: {}, skip_agents: [],
    rounds: 1,
    response_mode: voiceMode ? "concise" : "balanced",
    plan: [], correction: { detected: false },
    voice_response_chars: voiceMode ? 200 : 500,
    reasoning: "Default fallback",
  }
}

export async function processCorrection(decision, settings, saveMemory) {
  if (!decision?.correction?.detected) return
  if (!decision.correction.save_to_memory) return
  if (!decision.correction.memory_entry) return
  try {
    await saveMemory(
      `Learned: ${decision.correction.what_was_wrong?.slice(0, 50) || "preference"}`,
      decision.correction.memory_entry, "learned"
    )
  } catch {}
}

// ── V2 audit ────────────────────────────────────────────
const DRIFT_PRONE_ROLES = new Set(['skeptic', 'reality_checker', 'steel_manner'])

const AUDIT_TESTS = {
  skeptic: "Did they find an actual flaw? PASS = a real objection, even a small one. FAIL = soft agreement, 'good point but also...', restating the user's idea back, or generic concerns.",
  reality_checker: "Did they only flag unstated assumptions and missing context? PASS = surfacing what's unspoken. FAIL = giving opinions on the idea itself.",
  steel_manner: "Did they make the strongest possible case for the idea? PASS = a real argument FOR. FAIL = hedging, sliding into critique.",
}

export function shouldAudit(role, voiceMode) {
  if (voiceMode) return false
  return DRIFT_PRONE_ROLES.has(role)
}

export async function auditResponse({ text, role, userMessage, settings }) {
  if (!text || text.length < 20) return { passed: true, reason: "empty" }
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { passed: true, reason: "no_model" }
  const roleDef = ROLE_POOL[role]
  if (!roleDef) return { passed: true, reason: "unknown_role" }

  const audit = AUDIT_TESTS[role] || "Did they stay in role?"
  const prompt = `You are auditing whether a specialist AI stayed in its assigned role on this turn.

ROLE ASSIGNED: ${roleDef.name}
ROLE PURPOSE: ${roleDef.purpose}

USER'S MESSAGE: "${userMessage?.slice(0, 600) || "(unknown)"}"

AGENT'S RESPONSE: "${text.slice(0, 1500)}"

AUDIT TEST FOR THIS ROLE: ${audit}

Return EXACTLY this JSON: {"passed": true|false, "reason": "<one short sentence>"}`

  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { passed: true, reason: "audit_error" }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      })
      raw = await streamToText(res, "gpt")
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      })
      raw = await streamToText(res, "gemini")
    }
    const parsed = extractJson(raw)
    if (parsed && typeof parsed.passed === "boolean") return { passed: parsed.passed, reason: parsed.reason || "" }
    return { passed: true, reason: "audit_parse_failed" }
  } catch { return { passed: true, reason: "audit_exception" } }
}

export function buildRetryReminder(role, auditReason) {
  const roleDef = ROLE_POOL[role]
  if (!roleDef) return ""
  return `IMPORTANT — your previous response slipped out of role.
Audit feedback: ${auditReason || "you drifted toward generic helpfulness"}.
You were assigned: ${roleDef.name}.
Your job, restated: ${roleDef.purpose}
This time, do the job. ${role === 'skeptic' ? "Find the actual flaw. If you genuinely cannot, say so explicitly and explain why." : role === 'reality_checker' ? "Surface only what's unspoken. No opinions on whether the idea is good or bad." : role === 'steel_manner' ? "Make the strongest possible case. No hedging." : ""}`
}

// ── Memory inference ────────────────────────────────────────
export async function inferMemoriesFromConversation({ turns, existingMemories = [], settings }) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { candidates: [], error: "no_model_key" }
  const transcript = turns.filter(t => t.text && (t.type === "user" || t.type === "agent"))
    .slice(-40).map(t => `${t.type === "user" ? "USER" : `AGENT(${t.agent || "?"})`}: ${t.text.slice(0, 600)}`).join("\n")
  if (!transcript.trim()) return { candidates: [], error: "empty_conversation" }
  const existingList = existingMemories.length ? existingMemories.slice(0, 30).map(m => `- ${m.title}: ${m.content?.slice(0, 200)}`).join("\n") : "(none yet)"
  const system = `You are OpenClaw's memory layer. Read a conversation and identify stable, useful facts about the user.

EXTRACT: durable preferences, profession, projects, communication style. Cite evidence.
SKIP: one-off curiosity, anything already in EXISTING MEMORIES, sensitive info unless explicitly asked.

OUTPUT JSON: {"candidates":[{"title":"...","content":"...","confidence":"high|medium|low","evidence":"..."}]}
Max 6 candidates.`
  const prompt = `EXISTING MEMORIES:\n${existingList}\n\nCONVERSATION:\n${transcript}\n\nExtract new memory candidates as JSON.`
  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) }, body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }) })
      const data = await res.json()
      if (!res.ok || data.error) return { candidates: [], error: `claude_${res.status}` }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) }, body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }) })
      raw = await streamToText(res, "gpt")
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }) })
      raw = await streamToText(res, "gemini")
    }
    const parsed = extractJson(raw)
    return { candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [], error: null }
  } catch (e) { return { candidates: [], error: e?.message || "infer_failed" } }
}

export const SETUP_GUIDES = {
  anthropic: { name:"Claude", url:"https://console.anthropic.com/api-keys", keyPrefix:"sk-ant-" },
  openai:    { name:"ChatGPT", url:"https://platform.openai.com/api-keys", keyPrefix:"sk-proj-" },
  google:    { name:"Gemini", url:"https://aistudio.google.com/app/apikey", keyPrefix:"AIza" },
  xai:       { name:"Grok", url:"https://console.x.ai", keyPrefix:"xai-" },
  elevenlabs:{ name:"ElevenLabs", url:"https://elevenlabs.io/app/settings/api-keys", keyPrefix:null },
  stability: { name:"Stability AI", url:"https://platform.stability.ai/account/keys", keyPrefix:"sk-" },
  perplexity:{ name:"Perplexity", url:"https://www.perplexity.ai/settings/api", keyPrefix:"pplx-" },
}

export function diagnoseError(agentId, status) {
  const messages = {
    401: { claude:{msg:"Your Anthropic key isn't working.",fix:"anthropic"}, gpt:{msg:"Your OpenAI key isn't working.",fix:"openai"}, gemini:{msg:"Your Google AI key isn't working.",fix:"google"}, grok:{msg:"Your xAI key isn't working.",fix:"xai"} },
    429: { claude:{msg:"Claude is rate limited.",fix:null}, gpt:{msg:"ChatGPT hit its rate limit.",fix:null}, gemini:{msg:"Gemini's free tier is exhausted.",fix:"google_billing",url:"https://aistudio.google.com/app/plan"}, grok:{msg:"Grok is rate limited.",fix:null} },
    402: { grok:{msg:"Your xAI account has no credits.",fix:"xai"} },
  }
  return messages[status]?.[agentId] || { msg: `${agentId} returned an error. Check your API key.`, fix: null }
}

export function getProactiveNotices(settings) {
  const notices = []
  const agents = settings?.agents || {}
  const tools = settings?.tools || {}
  const connected = Object.values(agents).filter(a => a.key && a.enabled).length
  if (connected === 0) notices.push({ priority:"critical", message:"No AI agents connected. Add at least one API key to get started.", fix:"anthropic" })
  if (tools.dalle?.enabled && !agents.gpt?.key) notices.push({ priority:"high", message:"DALL-E is enabled but needs an OpenAI key in Agents → ChatGPT.", fix:"openai" })
  if (tools.elevenlabs?.enabled && !tools.elevenlabs?.key) notices.push({ priority:"medium", message:"ElevenLabs is enabled but needs an API key in Tools → Voice.", fix:"elevenlabs" })
  if (tools.perplexity?.enabled && !tools.perplexity?.key) notices.push({ priority:"medium", message:"Perplexity search is enabled but needs an API key in Tools → Search.", fix:"perplexity" })
  return notices.sort((a,b) => ({critical:0,high:1,medium:2,low:3})[a.priority] - ({critical:0,high:1,medium:2,low:3})[b.priority])
}
