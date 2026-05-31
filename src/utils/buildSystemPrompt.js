import { ROLE_POOL } from './openClaw'
import { TOOLS_BY_ID } from '../tools/registry'

export function buildSystemPrompt({ activeAgentIds=[], enabledTools={}, mode="concise", round=1, totalRounds=1, agentId="claude", voiceMode=false, memoryContext="", leadAgent=null, role=null, skills=null, useSkills=true }) {
  const AGENT_NAMES = { claude:"Claude (Anthropic)", gpt:"ChatGPT (OpenAI)", gemini:"Gemini (Google)", grok:"Grok (xAI)" }
  const otherAgents = activeAgentIds.filter(id => id !== agentId).map(id => AGENT_NAMES[id] || id)
  const lines = []
  lines.push(`You are ${AGENT_NAMES[agentId] || agentId} in a live multi-agent AI panel.`)

  const roleDef = role && ROLE_POOL[role]
  if (roleDef) {
    lines.push(`\nYOUR ROLE THIS TURN: ${roleDef.name.toUpperCase()}`)
    lines.push(roleDef.purpose)
    lines.push(`Stay in role. Do not drift into being a generally-helpful assistant — that's what the panel exists to avoid.`)
  }

  if (memoryContext) {
    lines.push(`\nWHAT YOU KNOW ABOUT THIS USER AND THEIR BUSINESS:`)
    lines.push(memoryContext)
    lines.push(`\nUse this context naturally in your responses. Don't announce that you have it — just use it.`)
  }

  // SKILLS — user-curated knowledge from Drive/Agent Interface/Skills/.
  // shared/ flows to every agent. <agentId>/ flows only to this one.
  // Per-agent toggle (settings.agents[agentId].useSkills) gates the
  // whole injection so users can save tokens for agents that don't
  // need the extra context.
  if (useSkills && skills && (skills.shared?.length || skills[agentId]?.length)) {
    const sharedActive = (skills.shared || []).filter(s => !s.skipped)
    const agentActive  = (skills[agentId] || []).filter(s => !s.skipped)
    const all = [...sharedActive, ...agentActive]
    if (all.length > 0) {
      lines.push(`\n--- EXPERTISE LOADED FROM YOUR SKILLS FOLDER ---`)
      lines.push(`The user has dropped these knowledge files into their Drive at Agent Interface/Skills/. Treat them as authoritative context about how they want you to think and what they know. Use the content naturally; don't quote the filenames at them.`)
      for (const s of all) {
        lines.push(`\n### ${s.name}`)
        if (s.description) lines.push(`(${s.description})`)
        lines.push(s.content)
      }
      lines.push(`\n--- END SKILLS ---\n`)
    }
  }

  if (otherAgents.length > 0) lines.push(`Also on the panel: ${otherAgents.join(", ")}.`)
  const tools = Object.entries(enabledTools)
    .filter(([,v]) => v)
    .map(([id]) => TOOLS_BY_ID[id]?.capability)
    .filter(Boolean)
  if (tools.length > 0) {
    lines.push(`\nAVAILABLE TOOLS — you have these right now:`)
    tools.forEach(t => lines.push(`- ${t}`))
    lines.push(`\nIMPORTANT: When asked for something these tools can do, USE THE TOOL. Never tell the user to go use another app. Never say you cannot generate images, video, or music — you can.`)
  }
  lines.push(`\nRULES:`)
  if (voiceMode) {
    lines.push("- VOICE MODE: Keep responses to 1-2 short sentences only. You are being spoken aloud. Be extremely concise.")
  } else {
    lines.push(mode === "concise" ? "- Keep responses to 2-3 sentences max. Be direct." : "- Give clear useful responses in 3-5 sentences.")
  }
  if (otherAgents.length > 0) {
    if (leadAgent && leadAgent === agentId) {
      lines.push("- You are the LEAD AGENT for this conversation. Take charge, synthesize the discussion, and give the definitive recommendation when the group disagrees.")
    } else if (leadAgent && leadAgent !== agentId) {
      lines.push(`- ${AGENT_NAMES[leadAgent] || leadAgent} is the lead agent. Support their direction, add your perspective, but defer to them on final decisions.`)
    }
    lines.push("- You are in a live conversation with other AIs. Read what they said carefully.")
    lines.push("- Respond DIRECTLY to the other agents — agree, disagree, build on their ideas or challenge them.")
    lines.push("- Reference what they said specifically: 'Claude made a good point about X' or 'I disagree with ChatGPT here because...'")
    lines.push("- This is a panel debate, not parallel monologues. Make it a real conversation.")
    lines.push(`- IDENTITY: You ARE ${AGENT_NAMES[agentId] || agentId}. Never refer to yourself in the third person. Never write phrases like "I agree with ${(AGENT_NAMES[agentId] || agentId).split(' ')[0]}'s suggestion" — that's you agreeing with yourself.`)
    lines.push("- NO HALLUCINATING OTHER AGENTS: Only reference what other agents actually said in this conversation. Do not invent quotes or imagine positions they didn't take.")
    lines.push("- DO NOT START WITH 'I agree' or 'That's a great point' or 'Building on that' — those are the patterns of a sycophantic assistant, not a panel specialist. Lead with your OWN original take on the question. Disagreement is welcome. Pure agreement adds nothing.")
  }
  if (totalRounds > 1) {
    if (round === 1) lines.push(`\nRound ${round} of ${totalRounds} — give your initial take.`)
    else if (round < totalRounds) lines.push(`\nRound ${round} of ${totalRounds} — respond to what others just said.`)
    else lines.push(`\nFinal round — wrap up in 1-2 sentences. Be decisive.`)
  }

  lines.push(`\nIf the user asks you to "write this up", "summarize", "create a document", or "turn this into a plan" — produce a clean structured response with clear headers and bullet points that captures the key insights from the conversation. Make it something they can copy and use directly.`)
  lines.push([
    "\nIMPORTANT formatting rule:",
    "- Do NOT prefix your response with \"[YourName]:\" or any \"[AgentName]:\" tag.",
    "  The system labels speakers automatically.",
    "- Do NOT include \"[OtherAgent]:\" blocks inside your response. Speak only as",
    "  yourself in plain prose. The conversation history may show other agents",
    "  with such tags — that is for context, not a format to imitate.",
  ].join("\n"))
  lines.push("\nCRITICAL IMAGE RULE: NEVER generate image URLs, markdown images, or use pollinations.ai or any external image service. NEVER write ![...](...) syntax. If an image is needed the tool system handles it automatically. Just describe concepts in text.")
  return lines.join("\n")
}

const TRIGGER_MAP = {
  dalle:      ["image","picture","photo","draw","design","logo","illustrat","render"],
  perplexity: ["search","latest","current","news","today","recent","find out","look up"],
}

export function detectToolIntents(prompt, enabledTools) {
  const p = prompt.toLowerCase()
  const intents = []
  const fired = new Set()
  Object.entries(enabledTools).forEach(([toolId, enabled]) => {
    if (!enabled) return
    const triggers = TRIGGER_MAP[toolId]
    if (!triggers) return
    const category = toolId === "dalle" ? "image" : toolId === "perplexity" ? "search" : toolId
    if (fired.has(category)) return
    if (triggers.some(t => p.includes(t))) {
      intents.push({ toolId, prompt, category })
      fired.add(category)
    }
  })
  return intents
}
