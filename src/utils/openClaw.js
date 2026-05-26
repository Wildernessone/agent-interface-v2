/**
 * AGENT INTERFACE — OpenClaw v2
 * ================================
 * The compiler at the heart of Agent Interface.
 * Reads roundtable discussions and decides:
 * - Which agents should respond
 * - How many rounds
 * - What tools to fire and with what prompt
 * - Where outputs go (chat/project/storage)
 * - What the user is correcting
 * - What to learn and remember
 *
 * Runs on whatever tokens the user already has.
 * Claude preferred — returns clean JSON.
 */

import { supabase } from './supabase'

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

// ── Model selection ───────────────────────────────────────
export function selectOrchestrationModel(settings) {
  if (settings?.agents?.claude?.key) return { provider: "claude", key: settings.agents.claude.key }
  if (settings?.agents?.gpt?.key) return { provider: "gpt", key: settings.agents.gpt.key }
  if (settings?.agents?.gemini?.key) return { provider: "gemini", key: settings.agents.gemini.key }
  return null
}

// ── Core OpenClaw call ────────────────────────────────────
async function callOpenClaw(prompt, modelConfig) {
  if (!modelConfig) return null

  const system = `You are OpenClaw — the compiler intelligence inside Agent Interface.
You read roundtable discussions and decide what happens next.
You output ONLY valid JSON. No explanation. No markdown. Just JSON.
Be decisive. Be fast. Be accurate.`

  try {
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({
          messages: [{ role: "user", content: `${system}\n\n${prompt}` }]
        }),
      })
      const data = await res.json()
      const text = data.content?.[0]?.text || ""
      return JSON.parse(text.replace(/```json|```/g, "").trim())
    }

    if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }),
      })
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
          try { const d = JSON.parse(l.slice(6)); const t = d.candidates?.[0]?.content?.parts?.[0]?.text; if (t) full += t } catch {}
        }
      }
      return JSON.parse(full.replace(/```json|```/g, "").trim())
    }

    if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
      })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = "", full = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split("\n"); buf = lines.pop()
        for (const l of lines) {
          if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
          try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) full += c } catch {}
        }
      }
      return JSON.parse(full.replace(/```json|```/g, "").trim())
    }
  } catch(e) {
    return null
  }
}

// ── MAIN ORCHESTRATE ──────────────────────────────────────
export async function orchestrate({
  userMessage,
  conversationHistory = [],
  agentResponses = [],
  enabledAgents = [],
  enabledTools = {},
  memory = [],
  activeProject = null,
  settings,
  voiceMode = false,
}) {
  const modelConfig = selectOrchestrationModel(settings)

  const agentSummary = agentResponses
    .map(r => `${r.agent.toUpperCase()}: ${r.text?.slice(0, 400)}`)
    .join("\n\n")

  const toolList = Object.entries(enabledTools)
    .filter(([,v]) => v).map(([id]) => id).join(", ") || "none"

  const memorySummary = memory.slice(0, 5)
    .map(m => `[${m.title}]: ${m.content?.slice(0, 150)}`)
    .join("\n") || "none"

  // Detect if this is a correction
  const correctionPhrases = ["that's not what i meant", "no i wanted", "wrong", "not right", "try again", "that's not", "i said", "i meant", "actually"]
  const isCorrection = correctionPhrases.some(p => userMessage.toLowerCase().includes(p))

  // Detect build-mode signal — user is APPROVING / triggering execution
  // (kept narrow so 'make me an image of X' does NOT trigger; that's a discuss request)
  const buildSignals = [
    "build it", "build this", "let's build", "go build",
    "ship it", "let's ship", "go for it", "let's go",
    "do it now", "yes do it", "yes build", "yes make it",
    "perfect, build", "great, build", "ok build", "let's make this",
    "go ahead and build", "fire the tools",
  ]
  const isBuildSignal = buildSignals.some(p => userMessage.toLowerCase().includes(p))

  const prompt = `
USER MESSAGE: "${userMessage}"
IS CORRECTION: ${isCorrection}
IS BUILD SIGNAL: ${isBuildSignal}
VOICE MODE: ${voiceMode}

WHAT AGENTS SAID:
${agentSummary || "No agent responses yet — this is the first message"}

AVAILABLE AGENTS: ${enabledAgents.join(", ")}
AVAILABLE TOOLS: ${toolList}
ACTIVE PROJECT: ${activeProject?.name || "none"}

USER MEMORY CONTEXT:
${memorySummary}

AGENT CAPABILITIES (use strengths, skip weaknesses):
- claude: nuanced reasoning, careful writing, strategy, ethics, ambiguity, long-form thinking
- gpt: code, technical structure, structured output, image prompting
- gemini: research, real-time data, Google ecosystem, multimodal
- grok: current events, contrarian takes, direct opinions, internet culture

TOOL CAPABILITIES:
- dalle, stability, ideogram: generate images from text
- runway: generate video from text/image (async, takes 30-90s)
- suno: generate full songs with vocals (async, takes 30-90s)
- elevenlabs: text-to-speech narration / voiceover
- perplexity, tavily: search the web for current info

YOUR JOB:
1. Pick the agents whose STRENGTHS fit the topic. Skip the weak ones. Don't fire all four unless the topic genuinely needs all perspectives.
2. Decide how many rounds (1=simple Q&A, 2=needs back-and-forth, 3=full debate)
3. Decide if this is DISCUSSION mode (agents talk, no tools) or BUILD mode (agents already discussed, user is approving — fire tools).
4. If BUILD mode: produce a PLAN — an ordered list of tools to fire, with the right prompt for each. Multi-step is encouraged (e.g. ad = script → voice → music → video).
5. Use prior agent input to write better tool prompts. Synthesize what they agreed on.
6. If correction, note what to learn.
7. Voice mode = keep replies extremely short.

MODE RULES (when to talk vs. when to fire tools):

DEFAULT: mode="discuss" with plan=[]. Let the agents talk first.

Creative requests ("make me an image of X", "draw a logo", "write me a song about Y", "design a poster", "build me a 30s ad")
  → mode="discuss", plan=[]
  → Agents propose: composition, mood, style, script, music vibe, etc.
  → Wait for the user to approve before firing tools.

Search / lookup requests ("search for X", "find latest news about Y", "what is Z right now")
  → mode="build" with a single search tool in plan=[]
  → No discussion needed; user wants facts now.

Explicit build approval (IS BUILD SIGNAL is true) AND there has been prior discussion
  → mode="build" with a full plan based on what was discussed.
  → Synthesize the discussion into great tool prompts.

If IS BUILD SIGNAL is true but there's NO prior discussion
  → Still mode="discuss" so agents propose first. The user can then approve.

Metaphor guard: "paint a picture of life", "draw conclusions" — do NOT fire tools.

For a 30s ad after approval: plan = [
  {tool:"elevenlabs", prompt:"the voiceover script in plain text"},
  {tool:"suno",       prompt:"background music style description"},
  {tool:"runway",     prompt:"shot-by-shot video description"}
]

Only include tools that appear in AVAILABLE TOOLS.

OUTPUT EXACT JSON (no other text):
{
  "mode": "discuss",
  "agents_to_respond": ["claude"],
  "skip_agents": ["gpt", "gemini", "grok"],
  "skip_reason": "why skipped",
  "rounds": 1,
  "response_mode": "concise",
  "plan": [],
  "correction": {
    "detected": false,
    "what_was_wrong": null,
    "what_user_wants": null,
    "save_to_memory": false,
    "memory_entry": null
  },
  "voice_response_chars": 300,
  "reasoning": "one line"
}

Each plan entry is { "tool": "<tool_id>", "prompt": "<the prompt for that tool>", "label": "<short label like 'Voiceover' or 'Background music'>" }.
`

  if (!modelConfig) {
    return defaultDecision(enabledAgents, voiceMode)
  }

  const decision = await callOpenClaw(prompt, modelConfig)
  if (!decision) return defaultDecision(enabledAgents, voiceMode)

  // Ensure agents_to_respond only includes enabled agents
  if (decision.agents_to_respond) {
    decision.agents_to_respond = decision.agents_to_respond.filter(a => enabledAgents.includes(a))
    if (decision.agents_to_respond.length === 0) decision.agents_to_respond = enabledAgents
  }

  return decision
}

// ── Default when OpenClaw unavailable ─────────────────────
function defaultDecision(enabledAgents, voiceMode) {
  return {
    mode: "discuss",
    agents_to_respond: enabledAgents,
    skip_agents: [],
    rounds: 1,
    response_mode: voiceMode ? "concise" : "balanced",
    plan: [],
    correction: { detected: false },
    voice_response_chars: voiceMode ? 200 : 500,
    reasoning: "Default — OpenClaw unavailable",
  }
}

// ── Learn from correction ─────────────────────────────────
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

// ── Setup guides ──────────────────────────────────────────
export const SETUP_GUIDES = {
  anthropic:    { name:"Claude",          url:"https://console.anthropic.com/api-keys",         keyPrefix:"sk-ant-" },
  openai:       { name:"ChatGPT",         url:"https://platform.openai.com/api-keys",            keyPrefix:"sk-proj-" },
  google:       { name:"Gemini",          url:"https://aistudio.google.com/app/apikey",          keyPrefix:"AIza" },
  xai:          { name:"Grok",            url:"https://console.x.ai",                            keyPrefix:"xai-" },
  elevenlabs:   { name:"ElevenLabs",      url:"https://elevenlabs.io/app/settings/api-keys",     keyPrefix:null },
  stability:    { name:"Stability AI",    url:"https://platform.stability.ai/account/keys",      keyPrefix:"sk-" },
  perplexity:   { name:"Perplexity",      url:"https://www.perplexity.ai/settings/api",          keyPrefix:"pplx-" },
}

// ── Diagnose errors ───────────────────────────────────────
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

// ── Proactive notices ─────────────────────────────────────
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
