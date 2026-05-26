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

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

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
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key },
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
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key },
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
          if (!l.startsWith("data: ")) continue
          try { const d = JSON.parse(l.slice(6)); const t = d.candidates?.[0]?.content?.parts?.[0]?.text; if (t) full += t } catch {}
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

  const prompt = `
USER MESSAGE: "${userMessage}"
IS CORRECTION: ${isCorrection}
VOICE MODE: ${voiceMode}

WHAT AGENTS SAID:
${agentSummary || "No agent responses yet — this is the first message"}

AVAILABLE AGENTS: ${enabledAgents.join(", ")}
AVAILABLE TOOLS: ${toolList}
ACTIVE PROJECT: ${activeProject?.name || "none"}

USER MEMORY CONTEXT:
${memorySummary}

AGENT CAPABILITIES:
- claude: reasoning, writing, strategy, analysis, ethics
- gpt: code, technical, structured output, image generation
- gemini: research, multimodal, real-time data, Google data
- grok: current events, contrarian views, direct opinions

TOOL CAPABILITIES:
- dalle: generates images from text
- perplexity: searches web for current info
- elevenlabs: text to speech

YOUR JOB:
1. Decide which agents should respond (based on topic and capabilities)
2. Decide how many rounds (1=simple, 2=needs expansion, 3=needs debate)
3. Decide if a tool should fire (ONLY if explicitly requested or clearly implied)
4. Build the best tool prompt by synthesizing ALL agent input
5. Decide where output goes
6. If this is a correction, note what to learn
7. In voice mode keep everything SHORT

TOOL FIRING RULES:
- Only fire if user EXPLICITLY asked for image/video/music/search
- "paint a picture of" = metaphor, do NOT fire image tool
- "make me an image of" = fire image tool
- "what does X look like" = do NOT fire, just describe
- "search for X" or "find out about X" = fire search tool

OUTPUT THIS EXACT JSON (no other text):
{
  "agents_to_respond": ["claude"],
  "skip_agents": ["gpt", "gemini", "grok"],
  "skip_reason": "why skipped",
  "rounds": 1,
  "response_mode": "concise",
  "tool": {
    "should_fire": false,
    "tool_id": null,
    "prompt": null,
    "destination": "chat"
  },
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
    agents_to_respond: enabledAgents,
    skip_agents: [],
    rounds: 1,
    response_mode: voiceMode ? "concise" : "balanced",
    tool: { should_fire: false, tool_id: null, prompt: null, destination: "chat" },
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
