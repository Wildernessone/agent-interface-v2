import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { buildSystemPrompt } from '../utils/buildSystemPrompt'
import { VoiceEngine } from '../utils/voiceEngine'
import Settings from './Settings'
import { exportConversation } from '../utils/exportConversation'
import HistorySidebar from './HistorySidebar'
import { orchestrate, getProactiveNotices, processCorrection } from '../utils/openClaw'
import { logUsage, logError, checkTierLimits } from '../utils/telemetry'
import { saveToDrive } from '../utils/driveStorage'
import { supabase } from '../utils/supabase'
import PromptLibrary from './PromptLibrary'
import ToolOutput from './ToolOutput'
import OnboardingPanel from './OnboardingPanel'
import ProjectPicker from './ProjectPicker'
import MemoryPanel from './MemoryPanel'

const AGENTS = [
  { id:"claude",  name:"Claude",  color:"var(--color-agent-claude)", avatar:"C" },
  { id:"gpt",     name:"ChatGPT", color:"var(--color-agent-gpt)",    avatar:"G" },
  { id:"gemini",  name:"Gemini",  color:"var(--color-agent-gemini)", avatar:"X" },
  { id:"grok",    name:"Grok",    color:"var(--color-agent-grok)",   avatar:"GR" },
]

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

function classifyError(status, text) {
  if (status === 401 || status === 403) return "invalid_key"
  if (status === 429) return "rate_limited"
  if (status === 402) return "out_of_credits"
  if (status >= 500) return "service_down"
  if (status === 0) return "network"
  return "unknown"
}

async function streamClaude(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const data = await res.json()
    if (data.error) { onError?.(0, data.error?.message || "Claude error"); onDone(); return }
    const text = data.content?.[0]?.text || ""
    if (!text) { onError?.(0, "Empty response from Claude"); onDone(); return }
    const words = text.split(" ")
    let i = 0
    const iv = setInterval(() => {
      if (i >= words.length) { clearInterval(iv); onDone(); return }
      onChunk((i === 0 ? "" : " ") + words[i])
      i++
    }, 40)
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamOpenAI(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/gpt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamGemini(key, messages, onChunk, onDone, onError) {
  try {
    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
    const res = await fetch(`${PROXY}/gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, ...(await authHeader()) },
      body: JSON.stringify({ contents }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ")) continue
        try {
          const d = JSON.parse(l.slice(6))
          const t = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (t) onChunk(t)
        } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamGrok(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
}

export default function TheInterface() {
  const { settings, turns, activeAgentId, voiceMode, addTurn, addToolTurn, updateToolTurn, appendChunk, finishTurn, addErrorTurn, addToolErrorTurn, clearTurns, setVoiceMode, saveConversation, conversationId, loadMemory, saveMemory, activeProject, projects, loadProjects, createProject, setActiveProject } = useStore()
  
  const handleVoiceToggle = () => {
    // Recreate VoiceEngine with latest settings when toggling on
    if (!voiceMode) {
      voiceRef.current = new VoiceEngine(settings)
    } else {
      voiceRef.current?.stopSpeaking()
      voiceRef.current?.stopListening()
    }
    setVoiceMode(!voiceMode)
  }
  const [input, setInput] = useState("")
  const [targets, setTargets] = useState(["all"])
  const [responseMode, setResponseMode] = useState("concise")
  const [toolsWorking, setToolsWorking] = useState(false)
  const [listening, setListening] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showPrompts, setShowPrompts] = useState(false)
  const [agentMemory, setAgentMemory] = useState([])
  const [setupNotices, setSetupNotices] = useState([])
  const [skippedOnboarding, setSkippedOnboarding] = useState(false)
  const scrollRef = useRef(null)
  const voiceRef = useRef(null)
  const conversationRef = useRef([])

  const activeAgents = AGENTS.filter(a => settings.agents[a.id]?.enabled && settings.agents[a.id]?.key)
  // Auto-enable DALL-E when GPT key is present
  const rawEnabledTools = Object.fromEntries(Object.entries(settings.tools || {}).filter(([,v]) => v.enabled))
  const enabledTools = settings.agents?.gpt?.key
    ? { ...rawEnabledTools, dalle: true }
    : rawEnabledTools
  const busy = !!activeAgentId || toolsWorking
  const canSend = !busy && (input.trim() || listening)

  useEffect(() => {
    if (voiceRef.current) {
      voiceRef.current.updateSettings(settings)
    } else {
      voiceRef.current = new VoiceEngine(settings)
    }
  }, [settings])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

  const sendMessage = async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || busy) return
    if (!overrideText) setInput("")

    const limit = await checkTierLimits()
    if (!limit.allowed) {
      addErrorTurn("orchestrator", "free_tier_limit")
      return
    }

    const userTurnId = "u-" + Date.now()
    addTurn({ id: userTurnId, type: "user", text })
    conversationRef.current = [...conversationRef.current, { role: "user", content: text }]

    const selected = targets.includes("all") ? activeAgents : activeAgents.filter(a => targets.includes(a.id))

    // Collect recent agent messages so OpenClaw can see prior discussion
    const recentAgentResponses = turns
      .filter(t => t.type === "agent" && t.text)
      .slice(-8)
      .map(t => ({ agent: t.agent, text: t.text }))

    let clawDecision = null
    try {
      clawDecision = await orchestrate({
        userMessage: text,
        conversationHistory: conversationRef.current,
        agentResponses: recentAgentResponses,
        enabledAgents: selected.map(a => a.id),
        enabledTools,
        memory: agentMemory,
        activeProject,
        settings,
        voiceMode,
      })
    } catch(e) {
      logError("orchestrate", e)
      addErrorTurn("orchestrator", "orchestrator_down")
      return
    }

    // Surface OpenClaw's decision in the thread so the user sees what it's doing
    if (clawDecision?.reasoning || clawDecision?.mode) {
      addTurn({
        id: `claw-${Date.now()}`,
        type: "claw",
        mode: clawDecision.mode || "discuss",
        reasoning: clawDecision.reasoning || "",
        plan: clawDecision.plan || [],
      })
    }

    const isBuildMode = clawDecision?.mode === "build"
    const respondingAgents = isBuildMode
      ? []
      : (clawDecision?.agents_to_respond?.length
        ? selected.filter(a => clawDecision.agents_to_respond.includes(a.id))
        : selected)
    const totalRounds = clawDecision?.rounds || 1
    const activeResponseMode = clawDecision?.response_mode || responseMode

    if (clawDecision?.correction?.detected && clawDecision?.correction?.save_to_memory) {
      processCorrection(clawDecision, settings, saveMemory)
    }

    for (let round = 0; round < totalRounds; round++) {
      if (round > 0) {
        const roundMsg = round < totalRounds - 1
          ? "Continue the discussion — respond to what the other agents said."
          : "Final round — wrap up your position in 1-2 sentences."
        conversationRef.current = [...conversationRef.current, { role: "user", content: roundMsg }]
      }

      for (const agent of respondingAgents) {
        await new Promise((resolve) => {
          const id = `${agent.id}-${Date.now()}`
          addTurn({ id, type: "agent", agent: agent.id, text: "", directed: !targets.includes("all") })

          // Build memory context string
          const memoryContext = agentMemory.length > 0
            ? agentMemory.slice(0, 8).map(m => `[${m.title}]: ${m.content.slice(0, 300)}`).join("\n")
            : ""

          const systemPrompt = buildSystemPrompt({
            activeAgentIds: selected.map(a => a.id),
            enabledTools,
            mode: activeResponseMode,
            round: round + 1,
            totalRounds,
            agentId: agent.id,
            voiceMode,
            memoryContext,
          })

          const messages = [
            { role: "user", content: systemPrompt },
            ...conversationRef.current,
          ]

          let fullText = ""
          const onChunk = (c) => { fullText += c; appendChunk(id, c) }
          const onDone = () => {
            conversationRef.current = [...conversationRef.current, { role: "assistant", content: fullText }]
            finishTurn()
            if (fullText) {
              logUsage({ kind: "agent_message", provider: agent.id, model: agent.id, tokensOut: fullText.length / 4 | 0, success: true })
            }
            if (voiceMode && voiceRef.current && fullText) {
              voiceRef.current.speak(fullText.slice(0, 400), agent.id, resolve)
            } else {
              resolve()
            }
          }
          const onError = (status, msg) => {
            const errorType = classifyError(status, msg)
            addErrorTurn(agent.id, errorType)
            logUsage({ kind: "agent_message", provider: agent.id, model: agent.id, success: false, errorType })
            resolve()
          }

          const key = settings.agents[agent.id]?.key
          if (agent.id === "claude") streamClaude(key, messages, onChunk, onDone, onError)
          else if (agent.id === "gpt") streamOpenAI(key, messages, onChunk, onDone, onError)
          else if (agent.id === "gemini") streamGemini(key, messages, onChunk, onDone, onError)
          else if (agent.id === "grok") streamGrok(key, messages, onChunk, onDone, onError)
        })
      }
    }

    // OpenClaw tool plan — fire each step in the plan
    const plan = Array.isArray(clawDecision?.plan) ? clawDecision.plan : []
    if (plan.length > 0) {
      setToolsWorking(true)
      const agentContext = conversationRef.current
        .filter(m => m.role === "assistant")
        .map(m => m.content).join(" ")
      const fallback = (agentContext.length > 20 ? `${text}. ${agentContext}`.slice(0, 900) : text)

      for (const step of plan) {
        if (!step?.tool) continue
        const turnId = `tool-${step.tool}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`
        try {
          const output = await runTool(step.tool, step.prompt || fallback, settings)
          if (step.label) output.label = step.label
          addToolTurn({ id: turnId, type: "tool", output })
          logUsage({ kind: "tool_call", provider: step.tool, success: true })

          // Fire-and-forget save to Drive
          saveToDrive(output, activeProject).then(drive => {
            if (drive?.webViewLink) updateToolTurn(turnId, { driveUrl: drive.webViewLink })
          })
        } catch(e) {
          const errorType = e.errorType || "unknown"
          addToolErrorTurn(step.tool, errorType, e.message)
          logUsage({ kind: "tool_call", provider: step.tool, success: false, errorType })
          if (errorType === "unknown" || errorType === "bad_response") logError("runTool", e, { tool: step.tool })
        }
      }
      setToolsWorking(false)
    }
  }

  const toggleTarget = (id) => {
    if (id === "all") { setTargets(["all"]); return }
    setTargets(prev => {
      const without = prev.filter(t => t !== "all" && t !== id)
      if (prev.includes(id)) return without.length ? without : ["all"]
      return [...without, id]
    })
  }

  const toggleVoiceListening = () => {
    if (!voiceRef.current) return
    if (listening) {
      voiceRef.current.stopListening()
      setListening(false)
      return
    }
    voiceRef.current.startListening(
      (transcript) => {
        setListening(false)
        if (transcript.trim()) sendMessage(transcript)
      },
      (state) => setListening(state === "listening")
    )
  }


  // Rams: single accent. Theme accent overrides for users who customized.
  const accent = settings.accent || "var(--color-accent)"

  return (
    <div className="ai-app">
      {/* ───────── Header ───────── */}
      <header className="ai-header">
        <div className="ai-brand">
          <Logo/>
          <h1>Agent Interface</h1>
          <ProjectPicker/>
        </div>
        <nav className="ai-toolbar">
          <IconButton title="Prompt library" onClick={() => setShowPrompts(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2.5C3 2.22386 3.22386 2 3.5 2H12.5C12.7761 2 13 2.22386 13 2.5V13.5C13 13.7761 12.7761 14 12.5 14H3.5C3.22386 14 3 13.7761 3 13.5V2.5Z" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 5.5H10.5M5.5 8H10.5M5.5 10.5H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
          <IconButton title="History" onClick={() => setShowHistory(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.2"/><path d="M8 5V8L10 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
          <IconButton title="Memory" onClick={() => setShowMemory(true)} active={agentMemory.length > 0}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2C5.79086 2 4 3.79086 4 6V7.5C3.17157 7.5 2.5 8.17157 2.5 9V12C2.5 12.8284 3.17157 13.5 4 13.5H12C12.8284 13.5 13.5 12.8284 13.5 12V9C13.5 8.17157 12.8284 7.5 12 7.5V6C12 3.79086 10.2091 2 8 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="6" cy="10.5" r="0.7" fill="currentColor"/>
              <circle cx="8" cy="10.5" r="0.7" fill="currentColor"/>
              <circle cx="10" cy="10.5" r="0.7" fill="currentColor"/>
            </svg>
          </IconButton>
          {turns.length > 0 && (
            <div style={{ position:"relative" }}>
              <IconButton title="Export" onClick={() => setShowExport(!showExport)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5V10.5M8 10.5L5 7.5M8 10.5L11 7.5M3 13H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </IconButton>
              {showExport && (
                <div className="ai-menu">
                  {[["txt","Plain text"],["md","Markdown"],["html","HTML"]].map(([fmt, label]) => (
                    <button key={fmt} className="ai-menu-item" onClick={() => { exportConversation(turns, fmt); setShowExport(false) }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <IconButton title={voiceMode ? "Voice mode on" : "Voice mode off"} onClick={handleVoiceToggle} active={voiceMode}>
            {voiceMode
              ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 5.5C12.5 6.5 12.5 9.5 11.5 10.5M13 4C14.5 5.5 14.5 10.5 13 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 6L14 8.5M14 6L11.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            }
          </IconButton>
          <IconButton title="Settings" onClick={() => setShowSettings(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
        </nav>
      </header>

      {/* ───────── Setup notices ───────── */}
      {setupNotices.length > 0 && (
        <div className="ai-notice">
          {setupNotices.slice(0,1).map((n, i) => (
            <div key={i}>
              <span>{n.message}</span>
              <button onClick={() => setSetupNotices([])} aria-label="dismiss">×</button>
            </div>
          ))}
        </div>
      )}

      {/* ───────── Thread ───────── */}
      <main ref={scrollRef} className="ai-thread">
        {turns.length === 0 && activeAgents.length === 0 && !skippedOnboarding && (
          <OnboardingPanel onSkip={() => setSkippedOnboarding(true)} />
        )}

        {turns.length === 0 && (activeAgents.length > 0 || skippedOnboarding) && (
          <div className="ai-empty">
            <div className="ai-empty-logo"><Logo size={48}/></div>
            <h2>One interface. All your AI.</h2>
            <p>{activeAgents.length} agent{activeAgents.length!==1?"s":""} ready · OpenClaw orchestrating</p>
            {activeAgents.length === 0 && (
              <button className="ai-btn" onClick={() => setSkippedOnboarding(false)} style={{ marginTop: "var(--space-4)" }}>
                Connect an agent to start
              </button>
            )}
            <div className="ai-suggestions">
              {[
                "Help me brainstorm features",
                "Debate the best approach to this",
                "Plan a 30 second ad",
                "What are you all good at?",
              ].map(q => (
                <button key={q} onClick={() => setInput(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {turns.map(turn => {
          if (turn.type === "user") return (
            <div key={turn.id} className="ai-turn ai-turn--user">
              <div className="ai-user-bubble">{turn.text}</div>
            </div>
          )
          if (turn.type === "claw") return (
            <div key={turn.id} className="ai-claw">
              <span className={`ai-claw-tag ai-claw-tag--${turn.mode}`}>OpenClaw · {turn.mode}</span>
              <span className="ai-claw-text">{turn.reasoning}</span>
              {turn.plan?.length > 0 && (
                <span className="ai-claw-plan">
                  → firing {turn.plan.map(s => s.label || s.tool).join(", ")}
                </span>
              )}
            </div>
          )
          if (turn.type === "tool") return (
            <div key={turn.id} className="ai-turn ai-tool-card">
              <div className="ai-tool-label">{turn.output?.tool || "tool"}</div>
              <ToolOutput output={turn.output} />
            </div>
          )
          if (turn.type === "error") {
            const agent = AGENTS.find(a => a.id === turn.agent)
            const isOrchestrator = turn.agent === "orchestrator"
            const label = isOrchestrator ? "OpenClaw" : agent?.name
            const message = (
              turn.errorType === "rate_limited" ? `${label} hit its rate limit. Wait a moment and retry.` :
              turn.errorType === "out_of_credits" ? `Your ${label} account is out of credits.` :
              turn.errorType === "invalid_key" ? `Your ${label} API key isn't working — it may have expired.` :
              turn.errorType === "service_down" ? `${label} is having a service issue. Try again in a moment.` :
              turn.errorType === "network" ? `Couldn't reach ${label}. Check your connection and retry.` :
              turn.errorType === "orchestrator_down" ? `OpenClaw couldn't process this message. Retry, or verify your agent keys.` :
              turn.errorType === "free_tier_limit" ? `You've reached the free-tier daily limit. Upgrade to Pro for unlimited messages.` :
              `${label} returned an unexpected error. Retry, or check Settings.`
            )
            const billingUrl = agent?.id==="claude"?"https://console.anthropic.com":agent?.id==="gpt"?"https://platform.openai.com/account/billing":agent?.id==="gemini"?"https://aistudio.google.com/app/plan":"https://console.x.ai"
            return (
              <div key={turn.id} className="ai-turn ai-turn--agent">
                {agent
                  ? <div className="ai-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
                  : <div className="ai-avatar ai-avatar--error">!</div>
                }
                <div className="ai-error">
                  <div className="ai-error-title">{label} isn't responding</div>
                  <div className="ai-error-msg">{message}</div>
                  <div className="ai-actions">
                    <button className="ai-btn ai-btn--primary" onClick={() => sendMessage(turns.filter(t=>t.type==="user").slice(-1)[0]?.text||"")}>Retry</button>
                    {turn.errorType === "out_of_credits" && agent && (
                      <a className="ai-btn" href={billingUrl} target="_blank" rel="noreferrer">Add credits</a>
                    )}
                    {turn.errorType === "invalid_key" && (
                      <button className="ai-btn" onClick={() => setShowSettings(true)}>Fix key</button>
                    )}
                    {turn.errorType === "free_tier_limit" && (
                      <button className="ai-btn ai-btn--primary" onClick={() => setShowSettings(true)}>Upgrade</button>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          if (turn.type === "tool_error") return (
            <div key={turn.id} className="ai-tool-error">
              <div className="ai-tool-error-title">{turn.tool} failed</div>
              <div className="ai-tool-error-msg">{turn.message}</div>
              {turn.errorType === "missing_key" && (
                <button className="ai-btn" onClick={() => setShowSettings(true)}>Open settings</button>
              )}
            </div>
          )
          const agent = AGENTS.find(a => a.id === turn.agent)
          const isActive = activeAgentId === turn.id
          if (!agent) return null
          return (
            <div key={turn.id} className="ai-turn ai-turn--agent">
              <div className="ai-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
              <div className="ai-agent-msg">
                <div className="ai-agent-name" style={{ color: agent.color }}>{agent.name}</div>
                <div className={`ai-agent-text${isActive ? " is-streaming" : ""}`}>
                  {turn.text || (isActive ? <span className="ai-typing">thinking…</span> : "")}
                </div>
              </div>
            </div>
          )
        })}
      </main>

      {/* ───────── Composer ───────── */}
      <footer className="ai-composer">
        <div className="ai-targets">
          <span className="ai-targets-label">To</span>
          <button
            className={`ai-chip${targets.includes("all") ? " is-active" : ""}`}
            onClick={() => toggleTarget("all")}
          >All</button>
          {activeAgents.map(ag => {
            const sel = !targets.includes("all") && targets.includes(ag.id)
            return (
              <button
                key={ag.id}
                className={`ai-chip${sel ? " is-active" : ""}`}
                onClick={() => toggleTarget(ag.id)}
                style={sel ? { color: ag.color, borderColor: ag.color } : {}}
              >{ag.name}</button>
            )
          })}
          {turns.length > 0 && (
            <button className="ai-chip ai-chip--clear" onClick={() => { clearTurns(); conversationRef.current = [] }}>Clear</button>
          )}
        </div>
        <div className="ai-input-row">
          <textarea
            className="ai-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()} }}
            placeholder={targets.includes("all")?"Message all agents…":activeAgents.filter(a=>targets.includes(a.id)).map(a=>a.name).join(" + ")+"…"}
            rows={1}
          />
          {voiceMode && (
            <button
              className={`ai-iconbtn ai-iconbtn--lg${listening ? " is-listening" : ""}`}
              onClick={toggleVoiceListening}
              aria-label={listening ? "Stop listening" : "Start listening"}
            >
              {listening
                ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" fill="currentColor"/></svg>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="6.5" y="2" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M3.5 8.5C3.5 11.5 6 13.5 9 13.5C12 13.5 14.5 11.5 14.5 8.5M9 13.5V16M6 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              }
            </button>
          )}
          <button
            className="ai-iconbtn ai-iconbtn--lg ai-iconbtn--send"
            onClick={() => sendMessage()}
            disabled={!input.trim()||busy}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 14V4M9 4L5 8M9 4L13 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="ai-composer-hint">
          Enter to send · {activeAgents.length} agent{activeAgents.length!==1?"s":""} live · say "build it" to trigger tools
        </div>
      </footer>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHistory && <HistorySidebar onClose={() => setShowHistory(false)} accent={accent} />}
      <MemoryPanel
        open={showMemory}
        onClose={() => { setShowMemory(false); loadMemory().then(setAgentMemory) }}
        turns={turns}
        settings={settings}
      />
      {showPrompts && <PromptLibrary accent={accent} onClose={() => setShowPrompts(false)} onUse={(prompt, mode) => { setInput(prompt); if(mode) setResponseMode(mode); setShowPrompts(false); setTimeout(() => document.querySelector("textarea")?.focus(), 100) }}/>}
    </div>
  )
}

function Logo({ size = 32 }) {
  // 5-pointed orbit mark — agents around the OpenClaw core.
  // Restored & lightly polished: cleaner lines, design-token colors, consistent dot sizing.
  const points = [0, 72, 144, 216, 288]
  const r1 = 9.5, r2 = 12
  const dotColors = [
    "var(--color-agent-claude)",
    "var(--color-agent-gpt)",
    "var(--color-agent-gemini)",
    "var(--color-agent-grok)",
    "var(--color-accent)",
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
      <rect width="36" height="36" rx="9" fill="var(--color-bg-tertiary)"/>
      {points.map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180
        const x1 = 18 + r1 * Math.cos(rad)
        const y1 = 18 + r1 * Math.sin(rad)
        const x2 = 18 + r2 * Math.cos(rad)
        const y2 = 18 + r2 * Math.sin(rad)
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-text-secondary)" strokeWidth="0.8" opacity="0.5"/>
            <circle cx={x2} cy={y2} r="2" fill={dotColors[i]}/>
          </g>
        )
      })}
      <circle cx="18" cy="18" r="10.5" stroke="var(--color-text-tertiary)" strokeWidth="0.6" fill="none" strokeDasharray="2 2.5"/>
      <circle cx="18" cy="18" r="3" fill="var(--color-text-primary)"/>
      <circle cx="18" cy="18" r="1.1" fill="var(--color-accent)"/>
    </svg>
  )
}

function IconButton({ children, onClick, title, active }) {
  return (
    <button className={`ai-iconbtn${active ? " is-active" : ""}`} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  )
}

function toolError(toolId, errorType, message) {
  const e = new Error(message || `${toolId} failed`)
  e.errorType = errorType
  e.toolId = toolId
  return e
}

async function proxyFetch(path, body, extraHeaders = {}) {
  return fetch(`${PROXY}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()), ...extraHeaders },
    body: JSON.stringify(body),
  })
}

async function runTool(toolId, prompt, settings) {
  const gptKey = settings?.agents?.gpt?.key || ''

  if (toolId === "dalle") {
    if (!gptKey) throw toolError("dalle", "missing_key", "DALL-E needs an OpenAI key — add it in Settings → Agents → ChatGPT.")
    const res = await proxyFetch("dalle", { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${gptKey}` })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("dalle", classifyError(res.status, t), t || `DALL-E returned ${res.status}`)
    }
    let data
    try { data = await res.json() } catch { throw toolError("dalle", "bad_response", "DALL-E returned a malformed response.") }
    if (data.error) throw toolError("dalle", classifyError(0, data.error), data.error?.message || "DALL-E error")
    const b64 = data.data?.[0]?.b64_json
    const imgUrl = data.data?.[0]?.url
    if (b64) return { type: "image", url: `data:image/png;base64,${b64}`, prompt, tool: "dalle" }
    if (imgUrl) return { type: "image", url: imgUrl, prompt, tool: "dalle" }
    throw toolError("dalle", "bad_response", "DALL-E returned no image.")
  }

  if (toolId === "stability") {
    const key = settings?.tools?.stability?.key
    if (!key) throw toolError("stability", "missing_key", "Stable Diffusion needs an API key — add it in Settings → Tools → Images.")
    const res = await proxyFetch("stability", { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("stability", classifyError(res.status, t), t || `Stability returned ${res.status}`)
    }
    const data = await res.json()
    if (data.error) throw toolError("stability", "bad_response", data.error)
    const b64 = data.image
    if (!b64) throw toolError("stability", "bad_response", "Stability returned no image.")
    return { type: "image", url: `data:image/png;base64,${b64}`, prompt, tool: "stability" }
  }

  if (toolId === "ideogram") {
    const key = settings?.tools?.ideogram?.key
    if (!key) throw toolError("ideogram", "missing_key", "Ideogram needs an API key — add it in Settings → Tools → Images.")
    const res = await proxyFetch("ideogram", { prompt: prompt.slice(0, 900) }, { "x-api-key": key })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("ideogram", classifyError(res.status, t), t || `Ideogram returned ${res.status}`)
    }
    const data = await res.json()
    const imgUrl = data.data?.[0]?.url
    if (!imgUrl) throw toolError("ideogram", "bad_response", "Ideogram returned no image.")
    return { type: "image", url: imgUrl, prompt, tool: "ideogram" }
  }

  if (toolId === "elevenlabs") {
    const key = settings?.tools?.elevenlabs?.key
    if (!key) throw toolError("elevenlabs", "missing_key", "ElevenLabs needs an API key — add it in Settings → Tools → Voice.")
    const voiceId = "21m00Tcm4TlvDq8ikWAM" // Rachel — default English voice
    const res = await proxyFetch("elevenlabs", { text: prompt.slice(0, 2500), voice_id: voiceId }, { "x-api-key": key })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("elevenlabs", classifyError(res.status, t), t || `ElevenLabs returned ${res.status}`)
    }
    const data = await res.json()
    if (!data.audio) throw toolError("elevenlabs", "bad_response", "ElevenLabs returned no audio.")
    return { type: "audio", url: `data:audio/mpeg;base64,${data.audio}`, title: prompt.slice(0, 60), prompt, tool: "elevenlabs" }
  }

  if (toolId === "perplexity") {
    const key = settings?.tools?.perplexity?.key
    if (!key) throw toolError("perplexity", "missing_key", "Perplexity needs an API key — add it in Settings → Tools → Search.")
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "llama-3.1-sonar-small-128k-online", messages: [{ role: "user", content: prompt }] }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("perplexity", classifyError(res.status, t), t || `Perplexity returned ${res.status}`)
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) throw toolError("perplexity", "bad_response", "Perplexity returned no content.")
    return { type: "search", text, citations: data.citations || [], tool: "perplexity" }
  }

  if (toolId === "tavily") {
    const key = settings?.tools?.tavily?.key
    if (!key) throw toolError("tavily", "missing_key", "Tavily needs an API key — add it in Settings → Tools → Search.")
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: prompt, search_depth: "advanced", max_results: 5, include_answer: true }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("tavily", classifyError(res.status, t), t || `Tavily returned ${res.status}`)
    }
    const data = await res.json()
    const text = data.answer || data.results?.map(r => `${r.title}: ${r.content}`).join('\n\n')
    if (!text) throw toolError("tavily", "bad_response", "Tavily returned no results.")
    return { type: "search", text, citations: (data.results || []).map(r => ({ title: r.title, url: r.url })), tool: "tavily" }
  }

  if (toolId === "runway") {
    const key = settings?.tools?.runway?.key
    if (!key) throw toolError("runway", "missing_key", "Runway needs an API key — add it in Settings → Tools → Video.")
    const res = await proxyFetch("runway", { prompt: prompt.slice(0, 900) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("runway", classifyError(res.status, t), t || `Runway returned ${res.status}`)
    }
    const data = await res.json()
    if (!data.url) throw toolError("runway", "bad_response", "Runway returned no video URL.")
    return { type: "video", url: data.url, prompt, tool: "runway", duration: data.duration }
  }

  if (toolId === "suno") {
    const key = settings?.tools?.suno?.key
    if (!key) throw toolError("suno", "missing_key", "Suno needs an API key — add it in Settings → Tools → Music.")
    const res = await proxyFetch("suno", { prompt: prompt.slice(0, 500) }, { Authorization: `Bearer ${key}` })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      throw toolError("suno", classifyError(res.status, t), t || `Suno returned ${res.status}`)
    }
    const data = await res.json()
    if (!data.url) throw toolError("suno", "bad_response", "Suno returned no audio URL.")
    return { type: "audio", url: data.url, title: data.title || prompt.slice(0, 60), prompt, tool: "suno" }
  }

  throw toolError(toolId, "not_implemented", `The ${toolId} tool isn't available yet.`)
}
