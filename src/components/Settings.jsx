import { useState } from 'react'
import { supabase } from '../utils/supabase'
import { useStore } from '../store/useStore'

const AGENTS = [
  { id:"claude",  name:"Claude",  provider:"Anthropic", color:"#E8A87C", avatar:"C", placeholder:"sk-ant-api03-...", docsUrl:"https://console.anthropic.com/" },
  { id:"gpt",     name:"ChatGPT", provider:"OpenAI",    color:"#74C69D", avatar:"G", placeholder:"sk-proj-...",      docsUrl:"https://platform.openai.com/api-keys" },
  { id:"gemini",  name:"Gemini",  provider:"Google",    color:"#7EB8F7", avatar:"X", placeholder:"AIza...",          docsUrl:"https://aistudio.google.com/app/apikey" },
  { id:"grok",    name:"Grok",    provider:"xAI",       color:"#E879F9", avatar:"GR", placeholder:"xai-...",           docsUrl:"https://console.x.ai/" },
]

const TOOLS = [
  { id:"dalle",      name:"DALL-E",        category:"Images", placeholder:"sk-proj-...",  desc:"Generate images (uses OpenAI key)" },
  { id:"stability",  name:"Stable Diffusion", category:"Images", placeholder:"sk-...",   desc:"Open source image generation" },
  { id:"ideogram",   name:"Ideogram",      category:"Images", placeholder:"ideo-...",     desc:"Best for text in images" },
  { id:"flux",       name:"FLUX",          category:"Images", placeholder:"bf-...",       desc:"Ultra-fast image generation" },
  { id:"runway",     name:"Runway Gen-4",  category:"Video",  placeholder:"rw-...",       desc:"AI video generation" },
  { id:"kling",      name:"Kling",         category:"Video",  placeholder:"kling-...",    desc:"Realistic video with motion" },
  { id:"veo",        name:"Veo",           category:"Video",  placeholder:"AIza...",      desc:"Google cinematic video" },
  { id:"pika",       name:"Pika",          category:"Video",  placeholder:"pika-...",     desc:"Fast creative video" },
  { id:"suno",       name:"Suno",          category:"Music",  placeholder:"suno-...",     desc:"Full songs with vocals" },
  { id:"udio",       name:"Udio",          category:"Music",  placeholder:"udio-...",     desc:"High quality AI music" },
  { id:"elevenlabs_music", name:"ElevenLabs Music", category:"Music", placeholder:"el-...", desc:"Realistic AI music" },
  { id:"elevenlabs", name:"ElevenLabs",    category:"Voice",  placeholder:"el-...",       desc:"Premium AI voice synthesis" },
  { id:"playht",     name:"Play.ht",       category:"Voice",  placeholder:"play-...",     desc:"Voice cloning" },
  { id:"perplexity", name:"Perplexity",    category:"Search", placeholder:"pplx-...",     desc:"Real-time web search" },
  { id:"tavily",     name:"Tavily",        category:"Search", placeholder:"tvly-...",     desc:"AI-optimized search" },
  { id:"brave",      name:"Brave Search",  category:"Search", placeholder:"BSA-...",      desc:"Privacy-first search" },
]

// Popular ElevenLabs voices with distinct personalities
const ELEVENLABS_VOICES = [
  { id:"ErXwobaYiN019PkySvjV", name:"Antoni",   desc:"Warm, thoughtful",    recommended:"claude" },
  { id:"VR6AewLTigWG4xSOukaG", name:"Arnold",   desc:"Clear, direct",       recommended:"gpt" },
  { id:"EXAVITQu4vr4xnSDxMaL", name:"Bella",    desc:"Bright, expressive",  recommended:"gemini" },
  { id:"onwK4e9ZLuTAKqWW03F9", name:"Daniel",   desc:"Authoritative, deep", recommended:"grok" },
  { id:"pNInz6obpgDQGcFmaJgB", name:"Adam",     desc:"Calm, measured",      recommended:null },
  { id:"yoZ06aMxZJJ28mfd3POQ", name:"Sam",      desc:"Energetic, upbeat",   recommended:null },
  { id:"jBpfuIE2acCO8z3wKNLl", name:"Gigi",    desc:"Friendly, warm",      recommended:null },
  { id:"ThT5KcBeYPX3keUQqHPh", name:"Dorothy",  desc:"Gentle, reassuring",  recommended:null },
]

const THEMES = [
  { id:"dark",     label:"Dark",     bg:"#080A0F" },
  { id:"midnight", label:"Midnight", bg:"#04050A" },
  { id:"light",    label:"Light",    bg:"#F0EEF8" },
  { id:"slate",    label:"Slate",    bg:"#0A0C12" },
]

const ACCENTS = ["#6366f1","#E8A87C","#74C69D","#7EB8F7","#C084FC","#F87171","#FBBF24","#34D399"]

export default function Settings({ onClose }) {
  const { settings, updateSetting, saveSettings } = useStore()
  const [tab, setTab] = useState("agents")
  const [showKey, setShowKey] = useState({})
  const [saving, setSaving] = useState(false)

  const accent = settings.accent || "#6366f1"
  const theme = { text:"rgba(255,255,255,0.88)", textMuted:"rgba(255,255,255,0.42)", textFaint:"rgba(255,255,255,0.18)", border:"rgba(99,102,241,0.15)", borderStrong:"rgba(99,102,241,0.3)", surface:"rgba(255,255,255,0.04)", bg:"#080A0F" }

  const updateAgent = (agentId, field, value) => {
    updateSetting("agents", { ...settings.agents, [agentId]: { ...settings.agents[agentId], [field]: value } })
  }

  const updateTool = (toolId, field, value) => {
    updateSetting("tools", { ...settings.tools, [toolId]: { ...settings.tools[toolId], [field]: value } })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onClose()
  }

  const ss = {
    section: { background:theme.surface, border:`1px solid ${theme.border}`, borderRadius:14, padding:"16px 18px", marginBottom:12 },
    label: { fontSize:10, fontFamily:"monospace", color:theme.textMuted, letterSpacing:"0.09em", textTransform:"uppercase", marginBottom:8, display:"block" },
    input: { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.04)", border:`1px solid ${theme.border}`, borderRadius:8, padding:"8px 12px", fontSize:12, color:theme.text, fontFamily:"monospace", outline:"none" },
    toggle: (on) => ({ width:40, height:22, borderRadius:11, cursor:"pointer", background:on?accent:"rgba(255,255,255,0.12)", position:"relative", transition:"background 0.2s", flexShrink:0, border:"none" }),
  }

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)} style={ss.toggle(value)}>
      <div style={{ position:"absolute", top:3, left:value?21:3, width:16, height:16, borderRadius:"50%", background:"white", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/>
    </div>
  )

  const categories = [...new Set(TOOLS.map(t => t.category))]

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()} style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.65)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ width:"100%", maxWidth:500, maxHeight:"88vh", background:theme.bg, border:`1px solid ${theme.borderStrong}`, borderRadius:22, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 40px 100px rgba(0,0,0,0.5)" }}>

        {/* Header */}
        <div style={{ padding:"18px 22px 14px", borderBottom:`1px solid ${theme.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:theme.text }}>Settings</div>
            <div style={{ fontSize:11, color:theme.textMuted, fontFamily:"monospace", marginTop:2 }}>{useStore.getState().user?.email}</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={handleSignOut} style={{ padding:"5px 12px", borderRadius:8, background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.25)", color:"#F87171", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>Sign out</button>
            <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", background:theme.surface, border:`1px solid ${theme.border}`, color:theme.textMuted, cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:`1px solid ${theme.border}`, padding:"0 22px" }}>
          {["agents","tools","voice","display"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:"10px 14px 11px", border:"none", background:"transparent", cursor:"pointer", fontSize:11, fontFamily:"monospace", textTransform:"capitalize", color:tab===t?theme.text:theme.textMuted, borderBottom:tab===t?`2px solid ${accent}`:"2px solid transparent", transition:"all 0.15s" }}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"18px 22px" }}>

          {/* AGENTS */}
          {tab === "agents" && AGENTS.map(agent => (
            <div key={agent.id} style={ss.section}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:`${agent.color}18`, border:`1.5px solid ${agent.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:agent.color, fontFamily:"monospace" }}>{agent.avatar}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:theme.text, fontFamily:"monospace" }}>{agent.name}</div>
                  <div style={{ fontSize:10, color:theme.textMuted }}>{agent.provider}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:settings.agents[agent.id]?.key?"#74C69D":theme.textFaint }}/>
                  <Toggle value={settings.agents[agent.id]?.enabled||false} onChange={v => updateAgent(agent.id, "enabled", v)}/>
                </div>
              </div>
              <span style={ss.label}>{agent.provider} API Key</span>
              <div style={{ position:"relative" }}>
                <input type={showKey[agent.id]?"text":"password"} placeholder={agent.placeholder} value={settings.agents[agent.id]?.key||""} onChange={e => updateAgent(agent.id, "key", e.target.value)} style={{...ss.input, paddingRight:50}}/>
                <button onClick={() => setShowKey(p => ({...p,[agent.id]:!p[agent.id]}))} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:theme.textMuted, cursor:"pointer", fontSize:10, fontFamily:"monospace" }}>{showKey[agent.id]?"hide":"show"}</button>
              </div>
              <a href={agent.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, color:accent, fontFamily:"monospace", textDecoration:"none", display:"block", marginTop:8 }}>Get API key ↗</a>
            </div>
          ))}

          {/* TOOLS */}
          {tab === "tools" && categories.map(cat => (
            <div key={cat} style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:theme.textFaint, fontFamily:"monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>{cat}</div>
              {TOOLS.filter(t => t.category===cat).map(tool => (
                <div key={tool.id} style={{...ss.section, marginBottom:8}}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:theme.text, fontFamily:"monospace" }}>{tool.name}</div>
                      <div style={{ fontSize:10, color:theme.textMuted }}>{tool.desc}</div>
                    </div>
                    <Toggle value={settings.tools[tool.id]?.enabled||false} onChange={v => updateTool(tool.id, "enabled", v)}/>
                  </div>
                  {settings.tools[tool.id]?.enabled && tool.id !== "dalle" && (
                    <div style={{ marginTop:12 }}>
                      <span style={ss.label}>API Key</span>
                      <input type="password" placeholder={tool.placeholder} value={settings.tools[tool.id]?.key||""} onChange={e => updateTool(tool.id, "key", e.target.value)} style={ss.input}/>
                    </div>
                  )}
                  {tool.id === "dalle" && settings.tools[tool.id]?.enabled && (
                    <div style={{ fontSize:10, color:theme.textFaint, fontFamily:"monospace", marginTop:8 }}>Uses your OpenAI key from Agents tab</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* VOICE */}
          {tab === "voice" && <>
            <div style={{ fontSize:12, color:theme.textMuted, fontFamily:"monospace", marginBottom:14, lineHeight:1.6 }}>
              Choose distinct ElevenLabs voices for each agent. Add your ElevenLabs key in Tools → Voice first.
            </div>
            {AGENTS.map(agent => {
              const currentVoiceId = settings.agentVoices?.[agent.id]?.elevenLabsId || 
                ELEVENLABS_VOICES.find(v => v.recommended === agent.id)?.id || ELEVENLABS_VOICES[0].id
              const currentVoice = ELEVENLABS_VOICES.find(v => v.id === currentVoiceId)
              return (
                <div key={agent.id} style={ss.section}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                    <div style={{ width:32, height:32, borderRadius:"50%", background:`${agent.color}18`, border:`1.5px solid ${agent.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:agent.color, fontFamily:"monospace" }}>{agent.avatar}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:theme.text, fontFamily:"monospace" }}>{agent.name}</div>
                      <div style={{ fontSize:10, color:theme.textMuted }}>Current: {currentVoice?.name} — {currentVoice?.desc}</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {ELEVENLABS_VOICES.map(voice => (
                      <button key={voice.id} onClick={() => {
                        const agentVoices = { ...(settings.agentVoices || {}) }
                        agentVoices[agent.id] = { elevenLabsId: voice.id }
                        updateSetting("agentVoices", agentVoices)
                      }} style={{
                        display:"flex", alignItems:"center", justifyContent:"space-between",
                        padding:"8px 12px", borderRadius:9,
                        border:`1px solid ${currentVoiceId===voice.id?accent:theme.border}`,
                        background:currentVoiceId===voice.id?`${accent}15`:"transparent",
                        cursor:"pointer", textAlign:"left",
                      }}>
                        <div>
                          <span style={{ fontSize:12, color:currentVoiceId===voice.id?accent:theme.text, fontFamily:"monospace", fontWeight:currentVoiceId===voice.id?600:400 }}>{voice.name}</span>
                          <span style={{ fontSize:10, color:theme.textFaint, marginLeft:8 }}>{voice.desc}</span>
                          {voice.recommended === agent.id && <span style={{ fontSize:9, color:accent, marginLeft:8, fontFamily:"monospace" }}>recommended</span>}
                        </div>
                        {currentVoiceId===voice.id && <span style={{ color:accent, fontSize:12 }}>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </>}

          {/* DISPLAY */}
          {tab === "display" && <>
            <div style={ss.section}>
              <span style={ss.label}>Theme</span>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
                {THEMES.map(t => (
                  <button key={t.id} onClick={() => updateSetting("themeId", t.id)} style={{ padding:"10px 12px", borderRadius:9, border:`1.5px solid ${settings.themeId===t.id?accent:theme.border}`, background:settings.themeId===t.id?`${accent}12`:"transparent", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:18, height:18, borderRadius:"50%", background:t.bg, border:`2px solid rgba(255,255,255,0.2)`, flexShrink:0 }}/>
                    <span style={{ fontSize:12, color:theme.text, fontFamily:"monospace" }}>{t.label}</span>
                    {settings.themeId===t.id && <span style={{ marginLeft:"auto", color:accent }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>
            <div style={ss.section}>
              <span style={ss.label}>Accent Color</span>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {ACCENTS.map(c => (
                  <button key={c} onClick={() => updateSetting("accent", c)} style={{ width:28, height:28, borderRadius:"50%", background:c, border:settings.accent===c?`3px solid white`:"3px solid transparent", cursor:"pointer", padding:0, boxShadow:settings.accent===c?`0 0 0 2px ${theme.bg}`:"none" }}/>
                ))}
              </div>
            </div>
            <div style={ss.section}>
              <span style={ss.label}>Font Size</span>
              <div style={{ display:"flex", gap:7 }}>
                {["Small","Medium","Large"].map(sz => (
                  <button key={sz} onClick={() => updateSetting("fontSize", sz)} style={{ flex:1, padding:"8px 0", borderRadius:8, border:`1px solid ${settings.fontSize===sz?accent:theme.border}`, background:settings.fontSize===sz?`${accent}15`:"transparent", color:settings.fontSize===sz?theme.text:theme.textMuted, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>{sz}</button>
                ))}
              </div>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
