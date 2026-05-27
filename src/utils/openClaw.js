/**
 * AGENT INTERFACE — OpenClaw v3
 * ================================
 * The compiler at the heart of Agent Interface.
 * Reads the roundtable, decides who talks, what tools fire, and what to build.
 *
 * Design notes for v3:
 *  - JSON extraction is now robust to LLMs adding prose before/after the JSON.
 *  - Prompt is restructured: hard rules first, examples second.
 *  - We surface OpenClaw's reasoning back to the UI so the user can see what it decided.
 */

import { supabase } from './supabase'

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

// ── Role pool ──────────────────────────────────────────────────────
// Roles are ASSIGNMENTS, not identities. The dispatcher assigns one to
// each responding agent per turn. The same agent can play different
// roles on different turns. Roles are sticky — they persist unless the
// conversation shape changes.
export const ROLE_POOL = {
  skeptic: {
    name: "Skeptic",
    purpose: "Find what's broken. Do not agree with the premise. Only 'no, because' — never 'yes, and'. If you genuinely cannot find a flaw, say so explicitly: 'I can't find a flaw here, and here's why this is unusually solid.' That rare admission is your most useful signal — never fake skepticism, never fake comfort.",
  },
  reality_checker: {
    name: "Reality Checker",
    purpose: "Surface unstated assumptions and missing context. Ask the questions the user didn't think to ask. What does this plan require that we have not confirmed the user has — money, time, connections, skills, access, audience? No opinions on the idea itself — only flag what's unspoken.",
  },
  builder: {
    name: "Builder",
    purpose: "Take the idea seriously and figure out how it would actually work on day one with what's in front of us right now. Constructive and concrete. Specific first step, specific tool, specific output. No hand-waving.",
  },
  synthesizer: {
    name: "Synthesizer",
    purpose: "Write the actual read across what everyone said. Not consensus — real conclusions, including the disagreements that didn't resolve. Example shape: 'Three of us think this is solid. The Skeptic's objection is X, and it wasn't answered. Here's what to do about it.'",
  },
  pattern_spotter: {
    name: "Pattern Spotter",
    purpose: "Notice the shape underneath. Connect this idea to structures from other domains, prior conversations the user mentioned, or recurring patterns the user might not see. One sharp connection beats five vague ones.",
  },
  steel_manner: {
    name: "Steel-Manner",
    purpose: "Argue for the idea as strongly as possible. Make the best version of the case before anyone tears it down. Even if you privately disagree, your job is to articulate why this could actually work, taken at its strongest.",
  },
  numbers_person: {
    name: "Numbers Person",
    purpose: "Get concrete about money, time, and math. Real numbers — costs, hours, conversion rates, break-evens, traffic estimates. If you have to estimate, estimate openly and show the math. No vague 'this could be profitable' — give actual figures.",
  },
  translator: {
    name: "Translator",
    purpose: "Restate the idea or the discussion in plainer terms. Strip the jargon. Confirm everyone (user + other agents) is using the same words to mean the same things.",
  },
  historian: {
    name: "Historian",
    purpose: "Pull in what we've discussed before — prior conversations, memory the user has confirmed, decisions they've already made. Bring continuity. Surface a contradiction with something they said earlier if you spot one.",
  },
}

const ROLE_IDS = Object.keys(ROLE_POOL)

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

// ── Model selection (Claude preferred, GPT next, Gemini fallback) ─────
export function selectOrchestrationModel(settings) {
  if (settings?.agents?.claude?.key) return { provider: "claude", key: settings.agents.claude.key }
  if (settings?.agents?.gpt?.key) return { provider: "gpt", key: settings.agents.gpt.key }
  if (settings?.agents?.gemini?.key) return { provider: "gemini", key: settings.agents.gemini.key }
  return null
}

// ── Robust JSON extraction ────────────────────────────────────────────
// Finds the first balanced { ... } in the text. Strips markdown fences.
function extractJson(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  // Find first '{' and walk forward tracking depth to find the matching '}'
  const start = cleaned.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
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

// ── Call the orchestrator model ───────────────────────────────────────
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
        body: JSON.stringify({
          messages: [{ role: "user", content: `${system}\n\n${prompt}` }],
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { decision: null, raw: data, error: `claude_${res.status}` }
      raw = data.content?.[0]?.text || ""
    }

    else if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
      })
      raw = await streamToText(res, "gpt")
    }

    else if (modelConfig.provider === "gemini") {
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

// ── Build the orchestrator prompt ─────────────────────────────────────
function buildOrchestratorPrompt({
  userMessage,
  agentSummary,
  toolList,
  memorySummary,
  enabledAgents,
  activeProject,
  isCorrection,
  isBuildSignal,
  hasPriorDiscussion,
  voiceMode,
  previousRoleAssignments,
}) {
  const roleCatalog = Object.entries(ROLE_POOL)
    .map(([id, r]) => `  - "${id}" (${r.name}): ${r.purpose.split('.')[0]}.`)
    .join("\n")

  const previousAssignmentsLine = previousRoleAssignments && Object.keys(previousRoleAssignments).length
    ? Object.entries(previousRoleAssignments).map(([a, r]) => `${a}=${r}`).join(", ")
    : "(none — this is the first turn or roles weren't assigned last turn)"

  return `
You are the DISPATCHER for a panel of specialist AIs. You are NOT a fifth voice in the rotation.
Your job: read the user's intent and the prior discussion, decide which specialist(s) should speak,
assign each one a ROLE for this turn, and decide when the panel has done its job.

INPUT
=====
USER MESSAGE: "${userMessage}"
PRIOR AGENT DISCUSSION: ${hasPriorDiscussion ? "yes" : "none"}
EXPLICIT BUILD APPROVAL DETECTED: ${isBuildSignal ? "yes" : "no"}
IS CORRECTION: ${isCorrection}
VOICE MODE: ${voiceMode}

AGENTS AVAILABLE: ${enabledAgents.join(", ") || "none"}
TOOLS AVAILABLE: ${toolList || "none"}
ACTIVE PROJECT: ${activeProject?.name || "none"}${activeProject?.description ? ` — ${activeProject.description}` : ""}

USER MEMORY:
${memorySummary || "none"}

WHAT AGENTS SAID JUST NOW:
${agentSummary || "(nothing yet — first message in this thread)"}

PREVIOUS TURN'S ROLE ASSIGNMENTS:
${previousAssignmentsLine}

ROLE POOL (assign one per responding agent):
${roleCatalog}

ROLE ASSIGNMENT RULES
=====================
- Roles are ASSIGNMENTS, not identities. The same agent can play different roles
  on different turns. The same role can be assigned to whichever agent fits best.
- Roles are STICKY by default. If an agent had a role last turn and the user is
  following up on what that role said, keep them in that role. Only reassign when
  the SHAPE of the conversation shifts (brainstorm → stress-test, debate → synthesis),
  not when the topic shifts.
- Pick 2-3 roles per turn from the pool. Not every role needs to appear. Silence
  from a role is a meaningful signal — "no skeptic was needed" means nothing was
  broken. Don't force everyone to speak.
- Match the role to the agent's actual strengths when possible:
    • claude  → strong at Skeptic, Synthesizer, Translator, Pattern Spotter
    • gpt     → strong at Builder, Numbers Person, Reality Checker
    • gemini  → strong at Reality Checker, Historian, Numbers Person
    • grok    → strong at Skeptic, Steel-Manner, Pattern Spotter, direct contrarian takes
  These are tendencies, not rules. Override when the moment calls for it.

DECISION TREE (apply in order — first match wins)
================================================
1. If TOOLS AVAILABLE includes a search tool AND the user asked a search question
   (e.g. "search for X", "what's the latest on Y", "find me Z right now"):
     → mode = "build"
     → plan = [{tool: <search tool>, prompt: <topic to search>}]
     → agents_to_respond = []
     → role_assignments = {}

2. If EXPLICIT BUILD APPROVAL DETECTED is yes AND PRIOR AGENT DISCUSSION is yes:
     → mode = "build"
     → plan = a real list of {tool, prompt, label} steps, synthesized from
       the agent discussion. Use only tools that appear in TOOLS AVAILABLE.
     → agents_to_respond = []
     → role_assignments = {}
     → Examples of what to put in plan:
       • image request → [{tool:"dalle", prompt:"<final detailed image prompt>", label:"Image"}]
         (prefer dalle, fall back to stability or ideogram if dalle unavailable)
       • 30-second ad → [
            {tool:"elevenlabs", prompt:"<final voiceover script>", label:"Voiceover"},
            {tool:"suno",       prompt:"<music vibe description>", label:"Music"},
            {tool:"runway",     prompt:"<shot-by-shot description>", label:"Video"}
         ]

3. Otherwise:
     → mode = "discuss"
     → plan = []
     → agents_to_respond = 2-3 agents from AGENTS AVAILABLE based on what the
       conversation needs right now (read the user message + prior discussion).
     → role_assignments = an object mapping each agent in agents_to_respond
       to a role_id from the ROLE POOL. Honor stickiness.
     → rounds = 1 for simple Q&A, 2 for back-and-forth, 3 only for genuine debate.
     → Voice mode: response_mode = "concise", rounds = 1, fewer agents.

OUTPUT (return EXACTLY this JSON shape — no preface, no fence, no trailing text):
{
  "mode": "discuss" | "build",
  "agents_to_respond": ["claude", "gpt"],
  "role_assignments": { "claude": "skeptic", "gpt": "builder" },
  "rounds": 1,
  "response_mode": "concise" | "balanced" | "detailed",
  "plan": [
    { "tool": "<tool_id>", "prompt": "<tool prompt>", "label": "<short label>" }
  ],
  "correction": {
    "detected": false,
    "what_was_wrong": null,
    "what_user_wants": null,
    "save_to_memory": false,
    "memory_entry": null
  },
  "voice_response_chars": 300,
  "reasoning": "one sentence: why this mode and these agents/tools"
}
`.trim()
}

// ── MAIN ORCHESTRATE ──────────────────────────────────────────────────
export async function orchestrate({
  userMessage,
  conversationHistory = [],
  agentResponses = [],
  enabledAgents = [],
  enabledTools = {},
  memory = [],
  activeProject = null,
  previousRoleAssignments = {},
  settings,
  voiceMode = false,
}) {
  const modelConfig = selectOrchestrationModel(settings)

  const agentSummary = agentResponses
    .map(r => `${r.agent?.toUpperCase()}: ${(r.text || "").slice(0, 400)}`)
    .join("\n\n")

  const toolList = Object.entries(enabledTools)
    .filter(([, v]) => v)
    .map(([id]) => id)
    .join(", ")

  const memorySummary = memory.slice(0, 5)
    .map(m => `[${m.title}]: ${(m.content || "").slice(0, 150)}`)
    .join("\n")

  const correctionPhrases = ["that's not what i meant", "no i wanted", "wrong", "not right", "try again", "that's not", "i said", "i meant", "actually"]
  const isCorrection = correctionPhrases.some(p => userMessage.toLowerCase().includes(p))

  const buildSignals = [
    "build it", "build this", "let's build", "go build",
    "ship it", "let's ship", "go for it", "let's go",
    "do it now", "yes do it", "yes build", "yes make it",
    "perfect, build", "great, build", "ok build", "let's make this",
    "go ahead and build", "fire the tools", "make it", "do it",
  ]
  const lower = userMessage.toLowerCase()
  const isBuildSignal = buildSignals.some(p => lower.includes(p))
  const hasPriorDiscussion = agentResponses.length > 0

  const prompt = buildOrchestratorPrompt({
    userMessage,
    agentSummary,
    toolList,
    memorySummary,
    enabledAgents,
    activeProject,
    isCorrection,
    isBuildSignal,
    hasPriorDiscussion,
    voiceMode,
    previousRoleAssignments,
  })

  if (!modelConfig) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: "No orchestrator model configured — defaulted to discuss." }
  }

  const { decision, raw, error } = await callOpenClaw(prompt, modelConfig)

  // Log raw output for debugging (visible in browser console)
  if (raw) console.log("[OpenClaw]", raw.slice(0, 600))
  if (error) console.warn("[OpenClaw error]", error)

  if (!decision) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: `OpenClaw fallback — ${error || "no decision"}.` }
  }

  // Filter agents_to_respond to enabled agents
  if (Array.isArray(decision.agents_to_respond)) {
    decision.agents_to_respond = decision.agents_to_respond.filter(a => enabledAgents.includes(a))
    if (decision.mode !== "build" && decision.agents_to_respond.length === 0) {
      decision.agents_to_respond = enabledAgents
    }
  }

  // Sanitize role_assignments: only known roles, only for agents that will actually respond
  const cleanRoles = {}
  if (decision.role_assignments && typeof decision.role_assignments === "object") {
    for (const [agent, role] of Object.entries(decision.role_assignments)) {
      if (decision.agents_to_respond?.includes(agent) && ROLE_IDS.includes(role)) {
        cleanRoles[agent] = role
      }
    }
  }
  decision.role_assignments = cleanRoles

  // Filter plan to enabled tools only
  if (Array.isArray(decision.plan)) {
    decision.plan = decision.plan.filter(step => step?.tool && enabledTools?.[step.tool])
  } else {
    decision.plan = []
  }

  // Sanity: if mode is "build" but plan is empty after filtering, fall back to discuss
  if (decision.mode === "build" && decision.plan.length === 0) {
    decision.mode = "discuss"
    decision.agents_to_respond = decision.agents_to_respond?.length ? decision.agents_to_respond : enabledAgents
    decision.reasoning = (decision.reasoning || "") + " (no usable tool in plan — switched to discuss)"
  }

  return decision
}

// ── Fallback decision ─────────────────────────────────────────────────
function defaultDecision(enabledAgents, voiceMode) {
  return {
    mode: "discuss",
    agents_to_respond: enabledAgents,
    role_assignments: {},
    skip_agents: [],
    rounds: 1,
    response_mode: voiceMode ? "concise" : "balanced",
    plan: [],
    correction: { detected: false },
    voice_response_chars: voiceMode ? 200 : 500,
    reasoning: "Default fallback",
  }
}

// ── Learn from correction ─────────────────────────────────────────────
export async function processCorrection(decision, settings, saveMemory) {
  if (!decision?.correction?.detected) return
  if (!decision.correction.save_to_memory) return
  if (!decision.correction.memory_entry) return

  try {
    await saveMemory(
      `Learned: ${decision.correction.what_was_wrong?.slice(0, 50) || "preference"}`,
      decision.correction.memory_entry,
      "learned"
    )
  } catch {}
}

// ── Memory inference: surface what OpenClaw is learning ──────────────
/**
 * Read recent conversation turns and produce candidate memory entries —
 * lightweight observations about the user that, once confirmed, make
 * future agent responses feel personalized. Avoids duplicating anything
 * already in `existingMemories`.
 *
 * Returns { candidates: [{title, content, confidence, evidence}], error }
 */
export async function inferMemoriesFromConversation({ turns, existingMemories = [], settings }) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { candidates: [], error: "no_model_key" }

  const transcript = turns
    .filter(t => t.text && (t.type === "user" || t.type === "agent"))
    .slice(-40)
    .map(t => `${t.type === "user" ? "USER" : `AGENT(${t.agent || "?"})`}: ${t.text.slice(0, 600)}`)
    .join("\n")

  if (!transcript.trim()) return { candidates: [], error: "empty_conversation" }

  const existingList = existingMemories.length
    ? existingMemories.slice(0, 30).map(m => `- ${m.title}: ${m.content?.slice(0, 200)}`).join("\n")
    : "(none yet)"

  const system = `You are OpenClaw's memory layer. Your job is to read a conversation between a user and AI agents and identify stable, useful facts about the user that would make future responses feel personalized.

EXTRACT memories that are:
- Durable (preferences, profession, projects, communication style, expertise, recurring topics)
- Specific enough to be useful ("prefers concise bullet points" not "likes good answers")
- Inferred from real evidence in the conversation (cite it)

DO NOT extract:
- One-off questions or transient curiosity
- Anything already in EXISTING MEMORIES
- Sensitive info (passwords, financial details, health diagnoses) unless the user explicitly asked you to remember it
- Anything you'd guess at — only what's actually evidenced

OUTPUT FORMAT — strict JSON, no prose before or after:
{
  "candidates": [
    {
      "title": "short label (2-5 words)",
      "content": "one or two sentences capturing the fact",
      "confidence": "high" | "medium" | "low",
      "evidence": "brief quote or paraphrase from the conversation"
    }
  ]
}

If nothing meaningful is new, return {"candidates": []}.
Maximum 6 candidates per pass — quality over quantity.`

  const prompt = `EXISTING MEMORIES (do not duplicate):
${existingList}

CONVERSATION:
${transcript}

Extract new memory candidates as JSON.`

  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { candidates: [], error: `claude_${res.status}` }
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

    const parsed = extractJson(raw)
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    return { candidates, error: null }
  } catch (e) {
    return { candidates: [], error: e?.message || "infer_failed" }
  }
}

// ── Setup guides ──────────────────────────────────────────────────────
export const SETUP_GUIDES = {
  anthropic:    { name:"Claude",          url:"https://console.anthropic.com/api-keys",         keyPrefix:"sk-ant-" },
  openai:       { name:"ChatGPT",         url:"https://platform.openai.com/api-keys",            keyPrefix:"sk-proj-" },
  google:       { name:"Gemini",          url:"https://aistudio.google.com/app/apikey",          keyPrefix:"AIza" },
  xai:          { name:"Grok",            url:"https://console.x.ai",                            keyPrefix:"xai-" },
  elevenlabs:   { name:"ElevenLabs",      url:"https://elevenlabs.io/app/settings/api-keys",     keyPrefix:null },
  stability:    { name:"Stability AI",    url:"https://platform.stability.ai/account/keys",      keyPrefix:"sk-" },
  perplexity:   { name:"Perplexity",      url:"https://www.perplexity.ai/settings/api",          keyPrefix:"pplx-" },
}

// ── Diagnose errors ───────────────────────────────────────────────────
export function diagnoseError(agentId, status) {
  const messages = {
    401: {
      claude:  { msg: "Your Anthropic key isn't working — looks like it expired or was revoked.", fix: "anthropic" },
      gpt:     { msg: "Your OpenAI key isn't working — create a fresh one.", fix: "openai" },
      gemini:  { msg: "Your Google AI key isn't working.", fix: "google" },
      grok:    { msg: "Your xAI key isn't working — may have been revoked.", fix: "xai" },
    },
    429: {
      claude:  { msg: "Claude is rate limited — wait a moment and try again.", fix: null },
      gpt:     { msg: "ChatGPT hit its rate limit — try again in a minute.", fix: null },
      gemini:  { msg: "Gemini's free tier is exhausted. Enable billing to continue.", fix: "google_billing", url: "https://aistudio.google.com/app/plan" },
      grok:    { msg: "Grok is rate limited — wait a moment.", fix: null },
    },
    402: {
      grok:    { msg: "Your xAI account has no credits. Add credits to use Grok.", fix: "xai" },
    },
  }
  return messages[status]?.[agentId] || { msg: `${agentId} returned an error. Check your API key in Settings.`, fix: null }
}

// ── Proactive notices ─────────────────────────────────────────────────
export function getProactiveNotices(settings) {
  const notices = []
  const agents = settings?.agents || {}
  const tools = settings?.tools || {}

  const connected = Object.values(agents).filter(a => a.key && a.enabled).length
  if (connected === 0) {
    notices.push({ priority:"critical", message:"No AI agents connected. Add at least one API key to get started.", fix:"anthropic" })
  }
  if (tools.dalle?.enabled && !agents.gpt?.key) {
    notices.push({ priority:"high", message:"DALL-E is enabled but needs an OpenAI key in Agents → ChatGPT.", fix:"openai" })
  }
  if (tools.elevenlabs?.enabled && !tools.elevenlabs?.key) {
    notices.push({ priority:"medium", message:"ElevenLabs is enabled but needs an API key in Tools → Voice.", fix:"elevenlabs" })
  }
  if (tools.perplexity?.enabled && !tools.perplexity?.key) {
    notices.push({ priority:"medium", message:"Perplexity search is enabled but needs an API key in Tools → Search.", fix:"perplexity" })
  }
  return notices.sort((a,b) => ({critical:0,high:1,medium:2,low:3})[a.priority] - ({critical:0,high:1,medium:2,low:3})[b.priority])
}
