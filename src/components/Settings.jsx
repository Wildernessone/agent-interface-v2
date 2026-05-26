import { useState } from 'react'
import MemoryTab from './MemoryTab'
import StorageTab from './StorageTab'
import { supabase } from '../utils/supabase'
import { useStore } from '../store/useStore'

const AGENTS = [
  { id:"claude",  name:"Claude",  provider:"Anthropic", color:"var(--color-agent-claude)", avatar:"C",  placeholder:"sk-ant-api03-...", docsUrl:"https://console.anthropic.com/" },
  { id:"gpt",     name:"ChatGPT", provider:"OpenAI",    color:"var(--color-agent-gpt)",    avatar:"G",  placeholder:"sk-proj-...",      docsUrl:"https://platform.openai.com/api-keys" },
  { id:"gemini",  name:"Gemini",  provider:"Google",    color:"var(--color-agent-gemini)", avatar:"X",  placeholder:"AIza...",          docsUrl:"https://aistudio.google.com/app/apikey" },
  { id:"grok",    name:"Grok",    provider:"xAI",       color:"var(--color-agent-grok)",   avatar:"GR", placeholder:"xai-...",          docsUrl:"https://console.x.ai/" },
]

const TOOLS = [
  { id:"dalle",      name:"DALL-E",           category:"Images", placeholder:"(uses OpenAI key)", desc:"OpenAI image generation" },
  { id:"stability",  name:"Stable Diffusion", category:"Images", placeholder:"sk-...",            desc:"Stable Diffusion 3" },
  { id:"ideogram",   name:"Ideogram",         category:"Images", placeholder:"ideo-...",          desc:"Best for images with text" },
  { id:"runway",     name:"Runway Gen-4",     category:"Video",  placeholder:"key-...",           desc:"AI video generation (async)" },
  { id:"suno",       name:"Suno",             category:"Music",  placeholder:"suno-...",          desc:"Full songs with vocals" },
  { id:"elevenlabs", name:"ElevenLabs",       category:"Voice",  placeholder:"sk_...",            desc:"Premium AI voice synthesis" },
  { id:"perplexity", name:"Perplexity",       category:"Search", placeholder:"pplx-...",          desc:"Real-time web search" },
  { id:"tavily",     name:"Tavily",           category:"Search", placeholder:"tvly-...",          desc:"AI-optimized search" },
]

const ELEVENLABS_VOICES = [
  { id:"ErXwobaYiN019PkySvjV", name:"Antoni",  desc:"Warm, thoughtful",     recommended:"claude" },
  { id:"VR6AewLTigWG4xSOukaG", name:"Arnold",  desc:"Clear, direct",        recommended:"gpt" },
  { id:"EXAVITQu4vr4xnSDxMaL", name:"Bella",   desc:"Bright, expressive",   recommended:"gemini" },
  { id:"onwK4e9ZLuTAKqWW03F9", name:"Daniel",  desc:"Authoritative, deep",  recommended:"grok" },
  { id:"pNInz6obpgDQGcFmaJgB", name:"Adam",    desc:"Calm, measured",       recommended:null },
  { id:"yoZ06aMxZJJ28mfd3POQ", name:"Sam",     desc:"Energetic, upbeat",    recommended:null },
  { id:"jBpfuIE2acCO8z3wKNLl", name:"Gigi",    desc:"Friendly, warm",       recommended:null },
  { id:"ThT5KcBeYPX3keUQqHPh", name:"Dorothy", desc:"Gentle, reassuring",   recommended:null },
]

const THEMES = [
  { id:"dark",     label:"Dark",     swatch:"#0E0F12" },
  { id:"light",    label:"Light",    swatch:"#FAFAF8" },
  { id:"midnight", label:"Midnight", swatch:"#04050A" },
  { id:"slate",    label:"Slate",    swatch:"#161A23" },
]

const ACCENTS = [
  "#2A6EF5", // cobalt (default)
  "#B96B3A", // terracotta
  "#2D7A50", // forest
  "#6B4FD8", // indigo
  "#B23A3A", // red
  "#B97400", // amber
  "#0E908E", // teal
  "#9333EA", // violet
]

const TABS = [
  { id: "agents",  label: "Agents"  },
  { id: "tools",   label: "Tools"   },
  { id: "voice",   label: "Voice"   },
  { id: "memory",  label: "Memory"  },
  { id: "storage", label: "Storage" },
  { id: "display", label: "Display" },
]

export default function Settings({ onClose }) {
  const { settings, updateSetting } = useStore()
  const [tab, setTab] = useState("agents")
  const [showKey, setShowKey] = useState({})

  const userEmail = useStore.getState().user?.email

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

  const categories = [...new Set(TOOLS.map(t => t.category))]

  return (
    <div className="settings-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="settings-dialog">
        <header className="settings-header">
          <div>
            <h2>Settings</h2>
            {userEmail && <div className="settings-email">{userEmail}</div>}
          </div>
          <div className="settings-header-actions">
            <button className="ai-btn" onClick={handleSignOut}>Sign out</button>
            <button className="ai-iconbtn" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
        </header>

        <nav className="settings-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`settings-tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>

        <div className="settings-body">

          {tab === "agents" && AGENTS.map(agent => (
            <section className="settings-card" key={agent.id}>
              <div className="settings-row">
                <div className="settings-row-main">
                  <div className="settings-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
                  <div>
                    <div className="settings-row-title">{agent.name}</div>
                    <div className="settings-row-sub">{agent.provider}</div>
                  </div>
                </div>
                <div className="settings-row-end">
                  <span className={`settings-status-dot${settings.agents[agent.id]?.key ? " is-on" : ""}`}/>
                  <Toggle value={settings.agents[agent.id]?.enabled||false} onChange={v => updateAgent(agent.id, "enabled", v)}/>
                </div>
              </div>
              <label className="settings-label">{agent.provider} API key</label>
              <div className="settings-input-wrap">
                <input
                  className="settings-input"
                  type={showKey[agent.id] ? "text" : "password"}
                  placeholder={agent.placeholder}
                  value={settings.agents[agent.id]?.key || ""}
                  onChange={e => updateAgent(agent.id, "key", e.target.value)}
                />
                <button
                  className="settings-input-toggle"
                  onClick={() => setShowKey(p => ({ ...p, [agent.id]: !p[agent.id] }))}
                >{showKey[agent.id] ? "hide" : "show"}</button>
              </div>
              <a className="settings-link" href={agent.docsUrl} target="_blank" rel="noreferrer">Get API key ↗</a>
            </section>
          ))}

          {tab === "tools" && categories.map(cat => (
            <div key={cat} className="settings-group">
              <div className="settings-group-label">{cat}</div>
              {TOOLS.filter(t => t.category === cat).map(tool => {
                const on = settings.tools[tool.id]?.enabled
                return (
                  <section className="settings-card settings-card--tight" key={tool.id}>
                    <div className="settings-row">
                      <div>
                        <div className="settings-row-title">{tool.name}</div>
                        <div className="settings-row-sub">{tool.desc}</div>
                      </div>
                      <Toggle value={on || false} onChange={v => updateTool(tool.id, "enabled", v)}/>
                    </div>
                    {on && tool.id !== "dalle" && (
                      <>
                        <label className="settings-label">API key</label>
                        <input
                          className="settings-input"
                          type="password"
                          placeholder={tool.placeholder}
                          value={settings.tools[tool.id]?.key || ""}
                          onChange={e => updateTool(tool.id, "key", e.target.value)}
                        />
                      </>
                    )}
                    {tool.id === "dalle" && on && (
                      <div className="settings-helper">Uses your OpenAI key from the Agents tab.</div>
                    )}
                  </section>
                )
              })}
            </div>
          ))}

          {tab === "voice" && (
            <>
              <p className="settings-intro">
                Choose distinct ElevenLabs voices for each agent. Add your ElevenLabs key in Tools → Voice first.
              </p>
              {AGENTS.map(agent => {
                const currentVoiceId = settings.agentVoices?.[agent.id]?.elevenLabsId
                  || ELEVENLABS_VOICES.find(v => v.recommended === agent.id)?.id
                  || ELEVENLABS_VOICES[0].id
                return (
                  <section className="settings-card" key={agent.id}>
                    <div className="settings-row">
                      <div className="settings-row-main">
                        <div className="settings-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
                        <div>
                          <div className="settings-row-title">{agent.name}</div>
                          <div className="settings-row-sub">{ELEVENLABS_VOICES.find(v => v.id === currentVoiceId)?.desc}</div>
                        </div>
                      </div>
                      <select
                        className="settings-select"
                        value={currentVoiceId}
                        onChange={(e) => {
                          const agentVoices = { ...(settings.agentVoices || {}) }
                          agentVoices[agent.id] = { elevenLabsId: e.target.value }
                          updateSetting("agentVoices", agentVoices)
                        }}
                      >
                        {ELEVENLABS_VOICES.map(voice => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}{voice.recommended === agent.id ? " (recommended)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>
                )
              })}
            </>
          )}

          {tab === "memory" && <MemoryTab/>}
          {tab === "storage" && <StorageTab/>}

          {tab === "display" && (
            <>
              <section className="settings-card">
                <label className="settings-label">Theme</label>
                <div className="settings-theme-grid">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      className={`settings-theme${settings.themeId === t.id ? " is-active" : ""}`}
                      onClick={() => updateSetting("themeId", t.id)}
                    >
                      <span className="settings-theme-swatch" style={{ background: t.swatch }}/>
                      <span>{t.label}</span>
                      {settings.themeId === t.id && <span className="settings-theme-check">✓</span>}
                    </button>
                  ))}
                </div>
              </section>
              <section className="settings-card">
                <label className="settings-label">Accent</label>
                <div className="settings-accents">
                  {ACCENTS.map(c => (
                    <button
                      key={c}
                      className={`settings-accent${settings.accent === c ? " is-active" : ""}`}
                      onClick={() => updateSetting("accent", c)}
                      style={{ background: c }}
                      aria-label={`Accent ${c}`}
                    />
                  ))}
                </div>
              </section>
              <section className="settings-card">
                <label className="settings-label">Font size</label>
                <div className="settings-fontsize">
                  {["Small","Medium","Large"].map(sz => (
                    <button
                      key={sz}
                      className={`settings-size${settings.fontSize === sz ? " is-active" : ""}`}
                      onClick={() => updateSetting("fontSize", sz)}
                    >{sz}</button>
                  ))}
                </div>
              </section>
            </>
          )}

        </div>
      </div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      className={`settings-toggle${value ? " is-on" : ""}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="settings-toggle-thumb"/>
    </button>
  )
}
