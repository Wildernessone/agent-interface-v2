
export function buildSystemPrompt({ activeAgentIds=[], enabledTools={}, mode="concise", round=1, totalRounds=1, agentId="claude" }) {
  const AGENT_NAMES = { claude:"Claude (Anthropic)", gpt:"ChatGPT (OpenAI)", gemini:"Gemini (Google)", grok:"Grok (xAI)" }
  const TOOL_CAPS = {
    dalle:       "generate images from text prompts",
    midjourney:  "generate cinematic AI images",
    stability:   "generate images with Stable Diffusion",
    flux:        "generate ultra-fast AI images",
    ideogram:    "generate images especially with text in them",
    runway:      "generate and edit AI video",
    kling:       "generate realistic video with motion",
    veo:         "generate cinematic video",
    pika:        "generate creative short video",
    seedance:    "generate high-quality video",
    suno:        "generate full songs with vocals",
    udio:        "generate high-quality AI music",
    elevenlabs_music: "generate realistic AI music",
    mubert:      "generate ambient background music",
    soundraw:    "generate customizable music tracks",
    elevenlabs:  "synthesize realistic AI voices",
    playht:      "clone and synthesize voices",
    whisper:     "transcribe speech to text",
    perplexity:  "search the web for real-time information",
    tavily:      "search the web with AI-optimized results",
    brave:       "search the web privately",
  }
  const otherAgents = activeAgentIds.filter(id => id !== agentId).map(id => AGENT_NAMES[id] || id)
  const lines = []
  lines.push(`You are ${AGENT_NAMES[agentId] || agentId} in a live multi-agent AI roundtable.`)
  if (otherAgents.length > 0) lines.push(`Also here: ${otherAgents.join(", ")}.`)
  const tools = Object.entries(enabledTools).filter(([,v])=>v).map(([id])=>TOOL_CAPS[id]).filter(Boolean)
  if (tools.length > 0) {
    lines.push(`\nAVAILABLE TOOLS — you have these right now:`)
    tools.forEach(t => lines.push(`- ${t}`))
    lines.push(`\nIMPORTANT: When asked for something these tools can do, USE THE TOOL. Never tell the user to go use another app. Never say you cannot generate images, video, or music — you can.`)
  }
  lines.push(`\nRULES:`)
  lines.push(mode === "concise" ? "- Keep responses to 2-3 sentences max. Be direct." : "- Give clear useful responses in 3-5 sentences.")
  if (otherAgents.length > 0) {
    lines.push("- You are in a live conversation with other AIs. Read what they said carefully.")
    lines.push("- Respond DIRECTLY to the other agents — agree, disagree, build on their ideas or challenge them.")
    lines.push("- Reference what they said specifically: 'Claude made a good point about X' or 'I disagree with ChatGPT here because...'")
    lines.push("- This is a roundtable debate, not parallel monologues. Make it a real conversation.")
  }
  if (totalRounds > 1) {
    if (round === 1) lines.push(`\nRound ${round} of ${totalRounds} — give your initial take.`)
    else if (round < totalRounds) lines.push(`\nRound ${round} of ${totalRounds} — respond to what others just said.`)
    else lines.push(`\nFinal round — wrap up in 1-2 sentences. Be decisive.`)
  }
  lines.push("\nNever start with your name like [Claude]: or [ChatGPT]:. Just respond directly.")
  return lines.join("\n")
}

const TRIGGER_MAP = {
  dalle:      ["image","picture","photo","draw","design","logo","illustrat","render"],
  midjourney: ["image","picture","photo","draw","design","logo","illustrat","render"],
  stability:  ["image","picture","photo","draw","design","logo","illustrat","render"],
  flux:       ["image","picture","photo","draw","design","logo","illustrat","render"],
  ideogram:   ["image","picture","photo","draw","design","logo","illustrat","render"],
  runway:     ["video","animate","animation","clip","film","movie","reel"],
  kling:      ["video","animate","animation","clip","film","movie","reel"],
  veo:        ["video","animate","animation","clip","film","movie","reel"],
  pika:       ["video","animate","animation","clip","film","movie","reel"],
  seedance:   ["video","animate","animation","clip","film","movie","reel"],
  suno:       ["song","music","jingle","melody","track","beat","compose"],
  udio:       ["song","music","jingle","melody","track","beat","compose"],
  perplexity: ["search","latest","current","news","today","recent","find out","look up"],
  tavily:     ["search","latest","current","news","today","recent","find out","look up"],
  brave:      ["search","latest","current","news","today","recent","find out","look up"],
}

export function detectToolIntents(prompt, enabledTools) {
  const p = prompt.toLowerCase()
  const intents = []
  const fired = new Set()
  Object.entries(enabledTools).forEach(([toolId, enabled]) => {
    if (!enabled) return
    const triggers = TRIGGER_MAP[toolId]
    if (!triggers) return
    const category = ["dalle","midjourney","stability","flux","ideogram"].includes(toolId) ? "image"
      : ["runway","kling","veo","pika","seedance"].includes(toolId) ? "video"
      : ["suno","udio","mubert","soundraw","elevenlabs_music"].includes(toolId) ? "music"
      : ["perplexity","tavily","brave"].includes(toolId) ? "search" : toolId
    if (fired.has(category)) return
    if (triggers.some(t => p.includes(t))) {
      intents.push({ toolId, prompt, category })
      fired.add(category)
    }
  })
  return intents
}
