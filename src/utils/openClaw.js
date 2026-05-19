/**
 * AGENT INTERFACE — OpenClaw
 * ===========================
 * The orchestration intelligence built into Agent Interface.
 * Runs invisibly on whatever tokens the user already has.
 * Two roles:
 *   1. Orchestrator — routes agents, tools, outputs
 *   2. Setup Assistant — guides users, troubleshoots issues
 *
 * Drop into: src/utils/openClaw.js
 */

const PROXY = "https://claude-proxy.jamesreed.workers.dev"

// ── Model selection ───────────────────────────────────────
// Uses whatever tokens the user already has
// Priority: GPT-4o-mini → Haiku → Gemini Flash → Grok

export function selectOrchestrationModel(settings) {
  if (settings?.agents?.gpt?.key) return { provider: "gpt", model: "gpt-4o-mini", key: settings.agents.gpt.key }
  if (settings?.agents?.claude?.key) return { provider: "claude", model: "claude-haiku-4-5-20251001", key: settings.agents.claude.key }
  if (settings?.agents?.gemini?.key) return { provider: "gemini", model: "gemini-2.0-flash", key: settings.agents.gemini.key }
  if (settings?.agents?.grok?.key) return { provider: "grok", model: "grok-4", key: settings.agents.grok.key }
  return null
}

// ── Core orchestration call ───────────────────────────────

async function callOrchestrator(prompt, modelConfig) {
  if (!modelConfig) return null

  const systemPrompt = `You are OpenClaw — the orchestration intelligence built into Agent Interface.
Your job is to make the roundtable work perfectly. You are fast, precise, and invisible.
You ALWAYS output valid JSON and nothing else. No explanation. No preamble. Just JSON.`

  try {
    if (modelConfig.provider === "gpt") {
      const res = await fetch(`${PROXY}/gpt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}` },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
        }),
      })
      // Collect full SSE stream
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
          try { 
            const d = JSON.parse(l.slice(6))
            const c = d.choices?.[0]?.delta?.content
            if (c) full += c 
          } catch {}
        }
      }
      if (!full.trim()) throw new Error("Empty response from GPT")
      const cleaned = full.replace(/```json|```/g, "").trim()
      return JSON.parse(cleaned)
    }

    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key },
        body: JSON.stringify({
          messages: [{ role: "user", content: `${systemPrompt}\n\n${prompt}` }],
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
        body: JSON.stringify({
          messages: [
            { role: "user", content: `${systemPrompt}\n\n${prompt}` }
          ],
        }),
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
    console.error("OpenClaw orchestration error:", e)
    return null
  }
}

// ── ROLE 1: Orchestrator ──────────────────────────────────

/**
 * orchestrate(options) → OrchestrateDecision
 *
 * Called after agents respond, before tools fire.
 * Returns a routing decision for the current message.
 */
export async function orchestrate({
  userMessage,
  agentResponses = [],  // [{ agent: "claude", text: "..." }]
  enabledTools = {},
  enabledAgents = [],
  memory = [],
  activeProject = null,
  settings,
}) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return defaultDecision(userMessage, enabledAgents, enabledTools)

  const agentSummary = agentResponses
    .map(r => `${r.agent.toUpperCase()}: ${r.text?.slice(0, 300)}`)
    .join("\n\n")

  const toolList = Object.entries(enabledTools)
    .filter(([, v]) => v)
    .map(([id]) => id)
    .join(", ") || "none"

  const memorySummary = memory.slice(0, 5)
    .map(m => `- ${m.title}: ${m.content?.slice(0, 100)}`)
    .join("\n") || "none"

  const prompt = `
You are a synthesis engine. Your only job is to read what the AI agents said and build the best possible tool prompt from their combined input.

USER REQUEST: "${userMessage}"

WHAT THE AGENTS SAID:
${agentSummary || "No agent responses yet"}

AVAILABLE TOOLS: ${toolList}

YOUR ONLY JOB:
Look at what ALL the agents described. Combine their best ideas into one rich, detailed tool prompt.
Do NOT add your own creative ideas. Only synthesize what the agents already said.
If no tool should fire, set should_fire to false.

Tool types:
- dalle/stability = image generation
- perplexity/tavily/brave = web search  
- runway/kling/pika = video generation
- suno/udio = music generation

OUTPUT THIS EXACT JSON:
{
  "tool": {
    "should_fire": true,
    "tool_id": "dalle",
    "prompt": "synthesized prompt from ALL agent descriptions combined",
    "destination": "chat"
  },
  "reasoning": "one line"
}
`

  const decision = await callOrchestrator(prompt, modelConfig)
  if (!decision) return defaultDecision(userMessage, enabledAgents, enabledTools)
  return decision
}

// ── Default decision (when OpenClaw unavailable) ──────────

function defaultDecision(userMessage, enabledAgents, enabledTools) {
  return {
    agents_to_respond: enabledAgents,
    skip_agents: [],
    tool: { should_fire: false, tool_id: null, prompt: null, destination: "chat" },
    memory_context: "",
    setup_notice: null,
    reasoning: "No orchestration model available — using defaults",
  }
}

// ── ROLE 2: Setup Assistant ───────────────────────────────

// Known setup issues and their fixes
export const SETUP_GUIDES = {
  anthropic: {
    name: "Claude (Anthropic)",
    url: "https://console.anthropic.com/api-keys",
    steps: ["Go to console.anthropic.com", "Click API Keys in the left sidebar", "Click Create Key", "Copy and paste it here"],
    keyFormat: "sk-ant-api03-",
  },
  openai: {
    name: "ChatGPT (OpenAI)",
    url: "https://platform.openai.com/api-keys",
    steps: ["Go to platform.openai.com/api-keys", "Click Create new secret key", "Copy and paste it here"],
    keyFormat: "sk-proj-",
  },
  openai_images: {
    name: "OpenAI Image Generation",
    url: "https://platform.openai.com/settings/organization/general",
    steps: ["Go to platform.openai.com/settings/organization/general", "Click Verify Organization", "Complete verification (takes ~30 min)", "Create a new API key after verification"],
    keyFormat: null,
  },
  google: {
    name: "Gemini (Google)",
    url: "https://aistudio.google.com/app/apikey",
    steps: ["Go to aistudio.google.com/app/apikey", "Click Create API Key", "Copy and paste it here"],
    keyFormat: "AIza",
  },
  google_billing: {
    name: "Gemini Billing",
    url: "https://aistudio.google.com/app/plan",
    steps: ["Go to aistudio.google.com/app/plan", "Click Upgrade to pay-as-you-go", "Add payment method", "Gemini Flash costs ~$0.10 per million tokens"],
    keyFormat: null,
  },
  xai: {
    name: "Grok (xAI)",
    url: "https://console.x.ai",
    steps: ["Go to console.x.ai", "Create an API key", "Add credits to your account", "Copy and paste the key here"],
    keyFormat: "xai-",
  },
  elevenlabs: {
    name: "ElevenLabs Voice",
    url: "https://elevenlabs.io/app/settings/api-keys",
    steps: ["Go to elevenlabs.io", "Click your profile → API Keys", "Create a key", "Copy and paste it here"],
    keyFormat: null,
  },
  stability: {
    name: "Stability AI",
    url: "https://platform.stability.ai/account/keys",
    steps: ["Go to platform.stability.ai", "Click API Keys", "Create a key", "Copy and paste it here"],
    keyFormat: "sk-",
  },
  perplexity: {
    name: "Perplexity Search",
    url: "https://www.perplexity.ai/settings/api",
    steps: ["Go to perplexity.ai/settings/api", "Generate an API key", "Copy and paste it here"],
    keyFormat: "pplx-",
  },
}

// ── Diagnose issues ───────────────────────────────────────

export function diagnoseIssue(agentId, errorStatus, errorMessage) {
  const diagnoses = {
    401: {
      claude: { issue: "Claude key is invalid or expired", fix: "anthropic", message: "Your Anthropic key isn't working. Create a fresh one →" },
      gpt: { issue: "OpenAI key is invalid or expired", fix: "openai", message: "Your OpenAI key isn't working. Create a fresh one →" },
      gemini: { issue: "Gemini key is invalid", fix: "google", message: "Your Google AI key isn't working. Get a new one →" },
      grok: { issue: "Grok key is invalid", fix: "xai", message: "Your xAI key isn't working. Check console.x.ai →" },
    },
    429: {
      claude: { issue: "Claude rate limited", fix: null, message: "Claude is rate limited. Wait a minute and try again." },
      gpt: { issue: "OpenAI rate limited", fix: null, message: "ChatGPT is rate limited. Wait a moment and try again." },
      gemini: { issue: "Gemini free tier exhausted", fix: "google_billing", message: "Gemini's free tier is used up. Enable billing to continue →" },
      grok: { issue: "Grok rate limited", fix: null, message: "Grok is rate limited. Wait a moment." },
    },
    402: {
      grok: { issue: "Grok has no credits", fix: "xai", message: "Your xAI account needs credits. Add them at console.x.ai →" },
    },
    403: {
      gpt: { issue: "OpenAI image generation not verified", fix: "openai_images", message: "Image generation needs org verification. Takes ~30 min →" },
    },
  }

  return diagnoses[errorStatus]?.[agentId] || {
    issue: `${agentId} returned error ${errorStatus}`,
    fix: null,
    message: `Something went wrong with ${agentId}. Try again or check your API key in Settings.`,
  }
}

// ── Proactive notices ─────────────────────────────────────
// Checks settings and returns notices to show the user

export function getProactiveNotices(settings) {
  const notices = []

  // Tool enabled but no key
  if (settings?.tools?.dalle?.enabled && !settings?.agents?.gpt?.key) {
    notices.push({ type: "missing_key", message: "DALL-E is enabled but needs an OpenAI key", fix: "openai", priority: "high" })
  }
  if (settings?.tools?.perplexity?.enabled && !settings?.tools?.perplexity?.key) {
    notices.push({ type: "missing_key", message: "Perplexity search is enabled but needs an API key", fix: "perplexity", priority: "medium" })
  }
  if (settings?.tools?.elevenlabs?.enabled && !settings?.tools?.elevenlabs?.key) {
    notices.push({ type: "missing_key", message: "ElevenLabs is enabled but needs an API key", fix: "elevenlabs", priority: "medium" })
  }
  if (settings?.tools?.stability?.enabled && !settings?.tools?.stability?.key) {
    notices.push({ type: "missing_key", message: "Stable Diffusion is enabled but needs an API key", fix: "stability", priority: "medium" })
  }

  // Voice on but no ElevenLabs
  if (settings?.voiceModeEnabled && !settings?.tools?.elevenlabs?.key) {
    notices.push({ type: "info", message: "Voice mode is on using browser voices. Add ElevenLabs for premium agent voices.", fix: "elevenlabs", priority: "low" })
  }

  // No agents connected
  const connectedAgents = Object.values(settings?.agents || {}).filter(a => a.key && a.enabled)
  if (connectedAgents.length === 0) {
    notices.push({ type: "critical", message: "No AI agents connected. Add at least one API key to get started.", fix: "anthropic", priority: "critical" })
  }

  return notices.sort((a, b) => {
    const p = { critical: 0, high: 1, medium: 2, low: 3 }
    return p[a.priority] - p[b.priority]
  })
}

// ── Onboarding flow ───────────────────────────────────────

export const ONBOARDING_STEPS = [
  {
    id: "welcome",
    message: "Welcome to Agent Interface. Let's get your AI team connected. Which AI services do you already have accounts with?",
    options: [
      { label: "Claude (Anthropic)", value: "claude" },
      { label: "ChatGPT (OpenAI)", value: "gpt" },
      { label: "Gemini (Google)", value: "gemini" },
      { label: "Grok (xAI)", value: "grok" },
      { label: "None yet — help me pick", value: "none" },
    ],
    type: "multi_select",
  },
  {
    id: "none_recommendation",
    condition: (answers) => answers.welcome?.includes("none"),
    message: "No problem. Claude is the best starting point — it's the most capable for reasoning and writing. Get a free API key at console.anthropic.com. Come back and paste it here when you're ready.",
    type: "info",
    link: "https://console.anthropic.com/api-keys",
  },
  {
    id: "first_key",
    message: "Great. Paste your first API key here and I'll verify it's working.",
    type: "key_input",
  },
  {
    id: "tools_intro",
    message: "Your agent is connected ✓ Do you want to enable any tools? These let your agents generate images, search the web, or create music.",
    options: [
      { label: "Image generation", value: "images" },
      { label: "Web search", value: "search" },
      { label: "Voice mode", value: "voice" },
      { label: "Skip for now", value: "skip" },
    ],
    type: "multi_select",
  },
  {
    id: "complete",
    message: "You're set up and ready to go. Start by asking your agents anything — or try one of the prompt templates in the library.",
    type: "complete",
  },
]
