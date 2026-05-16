import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { buildSystemPrompt, detectToolIntents } from '../utils/buildSystemPrompt'
import { VoiceEngine } from '../utils/voiceEngine'
import Settings from './Settings'
import ToolOutput from './ToolOutput'

const AGENTS = [
  { id:"claude",  name:"Claude",  color:"#E8A87C", bg:"rgba(232,168,124,0.1)", border:"rgba(232,168,124,0.25)", avatar:"C" },
  { id:"gpt",     name:"ChatGPT", color:"#74C69D", bg:"rgba(116,198,157,0.1)", border:"rgba(116,198,157,0.25)", avatar:"G" },
  { id:"gemini",  name:"Gemini",  color:"#7EB8F7", bg:"rgba(126,184,247,0.1)", border:"rgba(126,184,247,0.25)", avatar:"X" },
]

const CLAUDE_PROXY = import.meta.env.VITE_CLAUDE_PROXY || "https://claude-proxy.jamesreed.workers.dev"

async function streamClaude(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(CLAUDE_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const data = await res.json()
    if (data.error) { onError?.(0, data.error.message || "Claude error"); onDone(); return }
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
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o", messages, stream: true, max_tokens: 600 }),
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
  const { settings, turns, activeAgentId, voiceMode, addTurn, appendChunk, finishTurn, addErrorTurn, clearTurns, setVoiceMode } = useStore()
  const [input, setInput] = useState("")
  const [targets, setTargets] = useState(["all"])
  const [responseMode, setResponseMode] = useState("concise")
  const [toolsWorking, setToolsWorking] = useState(false)
  const [listening, setListening] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
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

  useEffect(() => {
    voiceRef.current = new VoiceEngine(settings)
  }, [settings])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

  const detectRounds = (text) => {
    const t = text.toLowerCase()
    if (t.includes("debate") || t.includes("argue") || t.includes("disagree") || t.includes("challenge each other")) return 3
    if (t.includes("expand") || t.includes("go deeper") || t.includes("elaborate") || t.includes("dig into")) return 2
    return 1
  }

  const sendMessage = async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || busy) return
    if (!overrideText) setInput("")

    const userTurnId = "u-" + Date.now()
    addTurn({ id: userTurnId, type: "user", text })
    conversationRef.current = [...conversationRef.current, { role: "user", content: text }]

    const intents = detectToolIntents(text, enabledTools)
    const selected = targets.includes("all") ? activeAgents : activeAgents.filter(a => targets.includes(a.id))
    const totalRounds = detectRounds(text)

    // Track the last agent response for tool prompt refinement
    let lastAgentResponse = ""

    for (let round = 0; round < totalRounds; round++) {
      if (round > 0) {
        const roundMsg = round < totalRounds - 1
          ? "Continue the discussion — respond to what the other agents said."
          : "Final round — wrap up your position in 1-2 sentences."
        conversationRef.current = [...conversationRef.current, { role: "user", content: roundMsg }]
      }

      for (const agent of selected) {
        await new Promise((resolve) => {
          const id = `${agent.id}-${Date.now()}`
          addTurn({ id, type: "agent", agent: agent.id, text: "", directed: !targets.includes("all") })

          const systemPrompt = buildSystemPrompt({
            activeAgentIds: selected.map(a => a.id),
            enabledTools,
            mode: responseMode,
            round: round + 1,
            totalRounds,
            agentId: agent.id,
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
            if (voiceMode && voiceRef.current) {
              voiceRef.current.speak(fullText, agent.id, resolve)
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
        })
      }
    }

    // Run tools AFTER agents have discussed — use refined prompt from conversation
    if (intents.length > 0) {
      setToolsWorking(true)
      // Extract a refined prompt from the last agent response if available
      const lastTurn = conversationRef.current.filter(m => m.role === "assistant").slice(-1)[0]
      const refinedPrompt = lastTurn?.content || text
      for (const intent of intents) {
        const output = await runTool(intent.toolId, refinedPrompt, settings)
        addTurn({ id: `tool-${intent.toolId}-${Date.now()}`, type: "tool", output })
      }
      setToolsWorking(false)
    }
  }

  const toggleTarget = (id) => {
    if (id === "all") { setTargets(["all"]); return }
    if (targets.includes("all")) { setTargets([id]); return }
    const sel = targets.includes(id)
    if (sel) { const next = targets.filter(t => t !== id); setTargets(next.length ? next : ["all"]) }
    else setTargets([...targets, id])
  }

  const startVoice = () => {
    if (!voiceRef.current) return
    voiceRef.current.startListening(
      (transcript) => { setInput(transcript); setTimeout(() => sendMessage(transcript), 100) },
      (state) => setListening(state === "listening")
    )
  }

  const accent = settings.accent || "#6366f1"

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#080A0F", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"12px 18px", borderBottom:"1px solid rgba(99,102,241,0.15)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(8,10,15,0.95)", backdropFilter:"blur(16px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.92)" }}>Agent Interface</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:"monospace" }}>One interface. All your AI.</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {/* Mode toggle */}
          <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:8, padding:2, gap:1 }}>
            {[["concise","⚡"],["balanced","◎"]].map(([m,icon]) => (
              <button key={m} onClick={() => setResponseMode(m)} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:responseMode===m?`${accent}25`:"transparent", color:responseMode===m?accent:"rgba(255,255,255,0.3)", cursor:"pointer", fontSize:11, fontFamily:"monospace" }}>
                {icon} {m.charAt(0).toUpperCase()+m.slice(1)}
              </button>
            ))}
          </div>
          {/* Voice toggle */}
          <button onClick={() => setVoiceMode(!voiceMode)} style={{ width:32, height:32, borderRadius:8, background:voiceMode?`${accent}22`:"transparent", border:`1px solid ${voiceMode?accent:"rgba(255,255,255,0.1)"}`, color:voiceMode?accent:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:14 }}>
            {voiceMode ? "🔊" : "🔇"}
          </button>
          {/* Settings */}
          <button onClick={() => setShowSettings(true)} style={{ width:32, height:32, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:14 }}>⚙</button>
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} style={{ flex:1, overflowY:"auto", padding:"20px 18px", display:"flex", flexDirection:"column", gap:14 }}>
        {turns.length === 0 && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flex:1, gap:16, paddingTop:60, opacity:0.6 }}>
            <div style={{ fontSize:32 }}>◈</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:16, fontWeight:600, color:"rgba(255,255,255,0.7)", marginBottom:4 }}>The Interface</div>
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
                  <div style={{ fontSize:12, color:"#F87171", fontFamily:"monospace" }}>Something went wrong with {agent?.name}. <button onClick={() => sendMessage(turns.filter(t=>t.type==="user").slice(-1)[0]?.text||"")} style={{ background:"none", border:"none", color:"#6366f1", cursor:"pointer", fontSize:12, fontFamily:"monospace" }}>Retry</button></div>
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
            <button onMouseDown={startVoice} style={{ width:42, height:42, borderRadius:11, border:`1px solid ${listening?"#F87171":"rgba(99,102,241,0.4)"}`, background:listening?"rgba(248,113,113,0.15)":"rgba(99,102,241,0.15)", color:listening?"#F87171":"#a5b4fc", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>🎙️</button>
          )}
          <button onClick={() => sendMessage()} disabled={!input.trim()||busy} style={{ width:42, height:42, borderRadius:11, border:`1px solid ${input.trim()&&!busy?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.1)"}`, background:input.trim()&&!busy?"rgba(99,102,241,0.2)":"transparent", color:input.trim()&&!busy?"#a5b4fc":"rgba(255,255,255,0.2)", fontSize:17, cursor:input.trim()&&!busy?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>↑</button>
        </div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginTop:6, fontFamily:"monospace" }}>
          Enter to send · {activeAgents.length} agent{activeAgents.length!==1?"s":""} live · say "debate this" for 3 rounds
        </div>
      </div>
      <style>{`
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
      `}</style>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}

async function runTool(toolId, prompt, settings) {
  const gptKey = settings?.agents?.gpt?.key || ''
  const claudeKey = settings?.agents?.claude?.key || ''

  console.log('runTool called:', toolId, 'gptKey length:', gptKey.length, 'first 8:', gptKey.slice(0,8))

  if (toolId === "dalle") {
    if (!gptKey) return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true }
    try {
      // Route through Cloudflare proxy to avoid CORS
      const res = await fetch("https://claude-proxy.jamesreed.workers.dev/dalle", {
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${gptKey}`},
        body: JSON.stringify({ prompt: prompt.slice(0,900) }),
      })
      const data = await res.json()
      const url = data.data?.[0]?.url
      if (url) return { type:"image", url, prompt, tool:"dalle" }
      console.error("DALL-E error:", data.error)
      return { type:"image", url:"https://images.unsplash.com/photo-1524024973431-2ad916746881?w=800&q=80", prompt, tool:"dalle", mock:true }
    } catch(e) {
      console.error("DALL-E error:", e)
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
