import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { buildSystemPrompt } from '../utils/buildSystemPrompt'
import { VoiceEngine } from '../utils/voiceEngine'
import Settings from './Settings'
import { exportConversation } from '../utils/exportConversation'
import HistorySidebar from './HistorySidebar'
import { orchestrate, getProactiveNotices, diagnoseIssue, processCorrection } from '../utils/openClaw'
import PromptLibrary from './PromptLibrary'
import ToolOutput from './ToolOutput'

const AGENTS = [
  { id:"claude",  name:"Claude",  color:"#E8A87C", bg:"rgba(232,168,124,0.1)", border:"rgba(232,168,124,0.25)", avatar:"C" },
  { id:"gpt",     name:"ChatGPT", color:"#74C69D", bg:"rgba(116,198,157,0.1)", border:"rgba(116,198,157,0.25)", avatar:"G" },
  { id:"gemini",  name:"Gemini",  color:"#7EB8F7", bg:"rgba(126,184,247,0.1)", border:"rgba(126,184,247,0.25)", avatar:"X" },
  { id:"grok",    name:"Grok",    color:"#E879F9", bg:"rgba(232,121,249,0.1)", border:"rgba(232,121,249,0.25)", avatar:"GR" },
]

const CLAUDE_PROXY = import.meta.env.VITE_CLAUDE_PROXY || "https://claude-proxy.jamesreed.workers.dev"

async function streamClaude(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch("https://claude-proxy.jamesreed.workers.dev/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); console.error("Claude proxy error:", res.status, t); onError?.(res.status, t); onDone(); return }
    const data = await res.json()
    console.log("Claude response:", JSON.stringify(data).slice(0,200))
    if (data.error) { console.error("Claude error:", data.error); onError?.(0, data.error?.message || "Claude error"); onDone(); return }
    const text = data.content?.[0]?.text || ""
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
    const res = await fetch("https://claude-proxy.jamesreed.workers.dev/gpt", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
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
    const res = await fetch("https://claude-proxy.jamesreed.workers.dev/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
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
    const res = await fetch("https://claude-proxy.jamesreed.workers.dev/grok", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
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
  const { settings, turns, activeAgentId, voiceMode, addTurn, addToolTurn, appendChunk, finishTurn, addErrorTurn, clearTurns, setVoiceMode, saveConversation, conversationId, loadMemory, saveMemory } = useStore()
  
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
  const [showPrompts, setShowPrompts] = useState(false)
  const [agentMemory, setAgentMemory] = useState([])
  const [setupNotices, setSetupNotices] = useState([])
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

    const userTurnId = "u-" + Date.now()
    addTurn({ id: userTurnId, type: "user", text })
    conversationRef.current = [...conversationRef.current, { role: "user", content: text }]

    const selected = targets.includes("all") ? activeAgents : activeAgents.filter(a => targets.includes(a.id))

    // OpenClaw makes all decisions
    const clawDecision = await orchestrate({
      userMessage: text,
      conversationHistory: conversationRef.current,
      agentResponses: [],
      enabledAgents: selected.map(a => a.id),
      enabledTools,
      memory: agentMemory,
      settings,
      voiceMode,
    })

    const respondingAgents = clawDecision?.agents_to_respond?.length
      ? selected.filter(a => clawDecision.agents_to_respond.includes(a.id))
      : selected
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
            if (voiceMode && voiceRef.current && fullText) {
              voiceRef.current.speak(fullText.slice(0, 400), agent.id, resolve)
            } else {
              resolve()
            }
          }
          const onError = (status, msg) => {
            addErrorTurn(agent.id, status === 429 ? "rate_limited" : status === 402 ? "out_of_credits" : "unknown")
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

    // OpenClaw tool firing — uses clawDecision from above
    if (clawDecision?.tool?.should_fire && clawDecision?.tool?.tool_id) {
      setToolsWorking(true)
      try {
        // Build prompt from OpenClaw decision or agent context
        const agentContext = conversationRef.current
          .filter(m => m.role === "assistant")
          .map(m => m.content).join(" ")
        const imagePrompt = clawDecision.tool.prompt ||
          (agentContext.length > 20 ? `${text}. ${agentContext}`.slice(0, 900) : text)
        const output = await runTool(clawDecision.tool.tool_id, imagePrompt, settings)
        addToolTurn({ id: `tool-${clawDecision.tool.tool_id}-${Date.now()}`, type: "tool", output })
      } catch(e) {
        console.error("Tool error:", e)
      } finally {
        setToolsWorking(false)
      }
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


  const accent = settings.accent || "#6366f1"

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#080A0F", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"12px 18px", borderBottom:"1px solid rgba(99,102,241,0.15)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(8,10,15,0.95)", backdropFilter:"blur(16px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="9" fill="#1C1F28"/>
            <rect width="36" height="36" rx="9" fill={accent} fillOpacity="0.12"/>
            {[0,72,144,216,288].map((deg,i) => {
              const r1=9.5,r2=12,rad=(deg-90)*Math.PI/180
              const x1=18+r1*Math.cos(rad),y1=18+r1*Math.sin(rad)
              const x2=18+r2*Math.cos(rad),y2=18+r2*Math.sin(rad)
              return <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="0.9" opacity="0.35"/>
                <circle cx={x2} cy={y2} r="2.2" fill={["#E8A87C","#74C69D","#7EB8F7","#C084FC","#FBBF24"][i]} opacity="0.95"/>
              </g>
            })}
            <circle cx="18" cy="18" r="10.5" stroke="white" strokeWidth="0.8" fill="none" opacity="0.25" strokeDasharray="2 2"/>
            <circle cx="18" cy="18" r="3.2" fill="white" opacity="0.98"/>
            <circle cx="18" cy="18" r="1.2" fill={accent}/>
          </svg>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.92)" }}>Agent Interface</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:"monospace" }}>One interface. All your AI.</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {/* Voice toggle */}
          <button onClick={() => setShowPrompts(true)} title="Prompt library" style={{ width:32, height:32, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:13 }}>📚</button>
          <button onClick={() => setShowHistory(true)} title="Conversation history" style={{ width:32, height:32, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:13 }}>☰</button>
          {turns.length > 0 && (
            <div style={{ position:"relative" }}>
              <button onClick={() => setShowExport(!showExport)} title="Export conversation" style={{ width:32, height:32, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:13 }}>⬇</button>
              {showExport && (
                <div style={{ position:"absolute", top:38, right:0, background:"#0E1117", border:"1px solid rgba(99,102,241,0.3)", borderRadius:10, padding:6, zIndex:100, minWidth:140, boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
                  {[["txt","📄 Plain Text"],["md","📝 Markdown"],["html","🌐 HTML"]].map(([fmt, label]) => (
                    <button key={fmt} onClick={() => { exportConversation(turns, fmt); setShowExport(false) }} style={{ display:"block", width:"100%", padding:"7px 12px", background:"transparent", border:"none", color:"rgba(255,255,255,0.7)", fontSize:12, cursor:"pointer", textAlign:"left", fontFamily:"monospace", borderRadius:6 }}
                      onMouseEnter={e=>e.target.style.background="rgba(99,102,241,0.15)"}
                      onMouseLeave={e=>e.target.style.background="transparent"}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={handleVoiceToggle} style={{ width:32, height:32, borderRadius:8, background:voiceMode?`${accent}22`:"transparent", border:`1px solid ${voiceMode?accent:"rgba(255,255,255,0.1)"}`, color:voiceMode?accent:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:14 }}>
            {voiceMode ? "🔊" : "🔇"}
          </button>
          {/* Settings */}
          <button onClick={() => setShowSettings(true)} style={{ width:32, height:32, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:14 }}>⚙</button>
        </div>
      </div>

      {/* Setup notices */}
      {setupNotices.length > 0 && (
        <div style={{ padding:"8px 18px", background:"rgba(248,113,113,0.08)", borderBottom:"1px solid rgba(248,113,113,0.15)" }}>
          {setupNotices.slice(0,1).map((n, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:11, color:"#F87171", fontFamily:"monospace" }}>⚠ {n.message}</span>
              <button onClick={() => setSetupNotices([])} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", cursor:"pointer", fontSize:12 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Thread */}
      <div ref={scrollRef} style={{ flex:1, overflowY:"auto", padding:"20px 18px", display:"flex", flexDirection:"column", gap:14 }}>
        {turns.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flex:1, gap:16, paddingTop:60, opacity:0.6 }}>
            <svg width="64" height="64" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="9" fill="#1C1F28"/>
              <rect width="36" height="36" rx="9" fill={accent} fillOpacity="0.12"/>
              {[0,72,144,216,288].map((deg,i) => {
                const r1=9.5,r2=12,rad=(deg-90)*Math.PI/180
                const x1=18+r1*Math.cos(rad),y1=18+r1*Math.sin(rad)
                const x2=18+r2*Math.cos(rad),y2=18+r2*Math.sin(rad)
                return <g key={i}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="0.9" opacity="0.35"/>
                  <circle cx={x2} cy={y2} r="2.2" fill={["#E8A87C","#74C69D","#7EB8F7","#C084FC","#FBBF24"][i]} opacity="0.95"/>
                </g>
              })}
              <circle cx="18" cy="18" r="10.5" stroke="white" strokeWidth="0.8" fill="none" opacity="0.25" strokeDasharray="2 2"/>
              <circle cx="18" cy="18" r="3.2" fill="white" opacity="0.98"/>
              <circle cx="18" cy="18" r="1.2" fill={accent}/>
            </svg>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:16, fontWeight:600, color:"rgba(255,255,255,0.7)", marginBottom:4 }}>One interface. All your AI.</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>{activeAgents.length} agent{activeAgents.length!==1?"s":""} ready</div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", maxWidth:340 }}>
              {["Help me brainstorm features","Debate the best approach to this","Expand on that idea","What are you all good at?"].map(q => (
                <button key={q} onClick={() => setInput(q)} style={{ padding:"6px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,0.1)", background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.4)", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {turns.map(turn => {
          if (turn.type === "user") return (
            <div key={turn.id} style={{ display:"flex", justifyContent:"flex-end" }}>
              <div style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"16px 4px 16px 16px", padding:"10px 14px", maxWidth:"75%", fontSize:14, color:"rgba(255,255,255,0.9)", lineHeight:1.6 }}>{turn.text}</div>
            </div>
          )
          if (turn.type === "tool") return (
            <div key={turn.id} style={{ padding:"12px 14px", background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:12 }}>
              <div style={{ fontSize:10, color:"#6366f1", fontFamily:"monospace", marginBottom:4, letterSpacing:"0.07em" }}>⚡ {(turn.output?.tool || "TOOL").toUpperCase()} OUTPUT</div>
              <ToolOutput output={turn.output} />
            </div>
          )
          if (turn.type === "error") {
            const agent = AGENTS.find(a => a.id === turn.agent)
            return (
              <div key={turn.id} style={{ display:"flex", gap:10 }}>
                <div style={{ width:32, height:32, borderRadius:"50%", background:agent?.bg, border:`1px solid ${agent?.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:agent?.color, flexShrink:0 }}>{agent?.avatar}</div>
                <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:"4px 12px 12px 12px", padding:"10px 14px" }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"#F87171", fontFamily:"monospace", marginBottom:4 }}>
                      {agent?.name} isn't responding
                    </div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", marginBottom:10, lineHeight:1.5 }}>
                      {turn.errorType === "rate_limited" && `${agent?.name} hit its rate limit. Wait a moment and retry.`}
                      {turn.errorType === "out_of_credits" && `Your ${agent?.name} account is out of credits. Add credits to continue.`}
                      {turn.errorType === "invalid_key" && `Your ${agent?.name} API key isn't working — it may have expired.`}
                      {turn.errorType === "unknown" && `${agent?.name} returned an unexpected error. Check your API key in Settings.`}
                    </div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <button onClick={() => sendMessage(turns.filter(t=>t.type==="user").slice(-1)[0]?.text||"")} style={{ padding:"5px 12px", borderRadius:8, background:"rgba(99,102,241,0.15)", border:"1px solid rgba(99,102,241,0.35)", color:"#a5b4fc", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>↩ Retry</button>
                      {turn.errorType === "out_of_credits" && (
                        <a href={agent?.id==="claude"?"https://console.anthropic.com":agent?.id==="gpt"?"https://platform.openai.com/account/billing":agent?.id==="gemini"?"https://aistudio.google.com/app/plan":"https://console.x.ai"} target="_blank" rel="noreferrer" style={{ padding:"5px 12px", borderRadius:8, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.6)", fontSize:11, cursor:"pointer", fontFamily:"monospace", textDecoration:"none" }}>Add Credits →</a>
                      )}
                      {turn.errorType === "invalid_key" && (
                        <button onClick={() => setShowSettings(true)} style={{ padding:"5px 12px", borderRadius:8, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.6)", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>Fix Key in Settings →</button>
                      )}
                      {turn.errorType === "rate_limited" && (
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"monospace", alignSelf:"center" }}>Usually clears in 60 seconds</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          }
          const agent = AGENTS.find(a => a.id === turn.agent)
          const isActive = activeAgentId === turn.id
          if (!agent) return null
          return (
            <div key={turn.id} style={{ display:"flex", gap:10 }}>
              <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0, background:agent.bg, border:`1.5px solid ${isActive?agent.color:agent.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:agent.color, fontFamily:"monospace", boxShadow:isActive?`0 0 12px ${agent.color}44`:"none", transition:"box-shadow 0.3s" }}>{agent.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, fontWeight:600, color:agent.color, fontFamily:"monospace", letterSpacing:"0.07em", marginBottom:4 }}>{agent.name.toUpperCase()}</div>
                <div style={{ background:agent.bg, border:`1px solid ${agent.border}`, borderRadius:"4px 14px 14px 14px", padding:"10px 14px", fontSize:14, lineHeight:1.7, color:"rgba(255,255,255,0.88)", position:"relative", overflow:"hidden" }}>
                  {turn.text || ""}
                  {isActive && !turn.text && <span style={{ opacity:0.4 }}>...</span>}
                  {isActive && <div style={{ position:"absolute", top:0, left:0, right:0, height:"1.5px", background:`linear-gradient(90deg,transparent,${agent.color},transparent)`, animation:"shimmer 1.4s infinite" }}/>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div style={{ padding:"12px 18px 20px", borderTop:"1px solid rgba(99,102,241,0.15)", background:"rgba(8,10,15,0.95)", backdropFilter:"blur(16px)" }}>
        <div style={{ display:"flex", gap:5, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginRight:3 }}>TO</span>
          <button onClick={() => toggleTarget("all")} style={{ padding:"3px 10px", borderRadius:20, border:`1px solid ${targets.includes("all")?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.1)"}`, background:targets.includes("all")?"rgba(99,102,241,0.15)":"transparent", color:targets.includes("all")?"#a5b4fc":"rgba(255,255,255,0.3)", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>⊕ All</button>
          {activeAgents.map(ag => {
            const sel = !targets.includes("all") && targets.includes(ag.id)
            return <button key={ag.id} onClick={() => toggleTarget(ag.id)} style={{ padding:"3px 10px", borderRadius:20, border:`1px solid ${sel?ag.border:"rgba(255,255,255,0.1)"}`, background:sel?ag.bg:"transparent", color:sel?ag.color:"rgba(255,255,255,0.3)", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>{ag.name}</button>
          })}
          {turns.length > 0 && <button onClick={() => { clearTurns(); conversationRef.current = [] }} style={{ marginLeft:"auto", padding:"3px 10px", borderRadius:20, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.3)", fontSize:10, cursor:"pointer", fontFamily:"monospace" }}>Clear</button>}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()} }}
            placeholder={targets.includes("all")?"Message all agents...":activeAgents.filter(a=>targets.includes(a.id)).map(a=>a.name).join(" + ")+"..."}
            rows={1} style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"10px 14px", color:"rgba(255,255,255,0.9)", fontSize:14, resize:"none", outline:"none", lineHeight:1.55, fontFamily:"inherit" }}/>
          {voiceMode && (
            <button
              onClick={toggleVoiceListening}
              style={{
                width:42, height:42, borderRadius:11,
                border:`1px solid ${listening?"#F87171":"rgba(99,102,241,0.4)"}`,
                background:listening?"rgba(248,113,113,0.25)":"rgba(99,102,241,0.15)",
                color:listening?"#F87171":"#a5b4fc",
                fontSize:16, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
                flexShrink:0,
                animation:listening?"pulse 1s infinite":"none",
                boxShadow:listening?"0 0 12px rgba(248,113,113,0.4)":"none",
              }}
            >{listening ? "⏹️" : "🎙️"}</button>
          )}
          <button onClick={() => sendMessage()} disabled={!input.trim()||busy} style={{ width:42, height:42, borderRadius:11, border:`1px solid ${input.trim()&&!busy?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.1)"}`, background:input.trim()&&!busy?"rgba(99,102,241,0.2)":"transparent", color:input.trim()&&!busy?"#a5b4fc":"rgba(255,255,255,0.2)", fontSize:17, cursor:input.trim()&&!busy?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>↑</button>
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginTop:6, fontFamily:"monospace" }}>
          Enter to send · {activeAgents.length} agent{activeAgents.length!==1?"s":""} live · say "debate this" for 3 rounds
        </div>
      </div>
      <style>{`
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHistory && <HistorySidebar onClose={() => setShowHistory(false)} accent={accent} />}
      {showPrompts && <PromptLibrary accent={accent} onClose={() => setShowPrompts(false)} onUse={(prompt, mode) => { setInput(prompt); if(mode) setResponseMode(mode); setShowPrompts(false); setTimeout(() => document.querySelector("textarea")?.focus(), 100) }}/>}
    </div>
  )
}
}

async function runTool(toolId, prompt, settings) {
  const gptKey = settings?.agents?.gpt?.key || ''
  const claudeKey = settings?.agents?.claude?.key || ''

  console.log('runTool called:', toolId, 'gptKey length:', gptKey.length, 'first 8:', gptKey.slice(0,8))

  if (toolId === "dalle") {
    if (!gptKey) return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true }
    try {
      // Route through Cloudflare proxy to avoid CORS
      const stabilityKey = settings?.tools?.stability?.key || ""
      const headers = { "Content-Type":"application/json" }
      if (gptKey) headers["Authorization"] = `Bearer ${gptKey}`
      if (stabilityKey) headers["x-stability-key"] = stabilityKey
      const res = await fetch("https://claude-proxy.jamesreed.workers.dev/dalle", {
        method:"POST",
        headers,
        body: JSON.stringify({ prompt: prompt.slice(0,900) }),
      })
      const rawText = await res.text()
      console.log("DALL-E raw:", rawText.slice(0,500))
      let data
      try { data = JSON.parse(rawText) } catch(e) { console.error("Parse error:", e); return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true } }
      if (data.error || data.details) { console.error("Image failed:", JSON.stringify(data)); return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true } }
      const b64 = data.data?.[0]?.b64_json
      const imgUrl = data.data?.[0]?.url
      console.log("model used:", data.model_used, "b64:", !!b64, "url:", !!imgUrl)
      if (b64) return { type:"image", url:`data:image/png;base64,${b64}`, prompt, tool:"dalle" }
      if (imgUrl) return { type:"image", url:imgUrl, prompt, tool:"dalle" }
      return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true }
    } catch(e) {
      console.error("DALL-E fetch error:", e)
      return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true }
    }
  }

  if (toolId === "perplexity") {
    const key = settings?.tools?.perplexity?.key || ''
    if (!key) return { type:"search", text:`Search results for: "${prompt}" — add Perplexity key in Settings → Tools`, citations:[], tool:"perplexity", mock:true }
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
        body: JSON.stringify({ model:"llama-3.1-sonar-small-128k-online", messages:[{role:"user",content:prompt}] }),
      })
      const data = await res.json()
      return { type:"search", text:data.choices?.[0]?.message?.content, citations:data.citations||[], tool:"perplexity" }
    } catch(e) { return { type:"search", text:"Search failed", citations:[], tool:"perplexity", mock:true } }
  }

  return { type:"text", text:`Tool: ${toolId}`, mock:true, tool:toolId }
}
