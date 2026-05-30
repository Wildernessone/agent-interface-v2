import { useState } from 'react'
import MemoryTab from './MemoryTab'
import StorageTab from './StorageTab'
import SkillsTab from './SkillsTab'
import { supabase } from '../utils/supabase'
import { useStore } from '../store/useStore'
import { TOOL_REGISTRY, ROADMAP_TOOLS, CATEGORY_LABELS } from '../tools/registry'
import { AGENT_SETUP } from '../config/agentSetup'
import SetupLinks from './SetupLinks'

// ElevenLabs setup links, pulled from the tool registry so the Voice tab stays
// in sync with the Tools tab (one verified source).
const ELEVENLABS_SETUP = TOOL_REGISTRY.find(t => t.id === 'elevenlabs')?.setup

const AGENTS = [
  { id:"claude",  name:"Claude",  provider:"Anthropic", color:"var(--color-agent-claude)", avatar:"C",  placeholder:"sk-ant-api03-..." },
  { id:"gpt",     name:"ChatGPT", provider:"OpenAI",    color:"var(--color-agent-gpt)",    avatar:"G",  placeholder:"sk-proj-..." },
  { id:"gemini",  name:"Gemini",  provider:"Google",    color:"var(--color-agent-gemini)", avatar:"X",  placeholder:"AIza..." },
  { id:"grok",    name:"Grok",    provider:"xAI",       color:"var(--color-agent-grok)",   avatar:"GR", placeholder:"xai-..." },
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
  { id:"dark",     label:"Dark",     desc:"Neutral slate, warm text",     bg:"#0E0F12",  bgAlt:"#16181D", border:"#25272D", text:"#F2F1ED", muted:"#A8A9AD" },
  { id:"light",    label:"Light",    desc:"Warm off-white, easy daytime", bg:"#FAFAF8",  bgAlt:"#FFFFFF", border:"#E5E4E0", text:"#0E0F12", muted:"#54565B" },
  { id:"midnight", label:"Midnight", desc:"True black, OLED-friendly",    bg:"#04050A",  bgAlt:"#0A0C14", border:"#1A1E2A", text:"#EAEDF5", muted:"#9499A8" },
  { id:"slate",    label:"Slate",    desc:"Desaturated cool blue",        bg:"#161A23",  bgAlt:"#1E232E", border:"#2D3340", text:"#E8EAEF", muted:"#9CA1AD" },
]

const ACCENTS = [
  { hex:"#6FA1FF", name:"Cobalt" }, { hex:"#E8A87C", name:"Terracotta" },
  { hex:"#7DC9A5", name:"Forest" }, { hex:"#B3A1F2", name:"Indigo" },
  { hex:"#F08585", name:"Ember" },  { hex:"#E0B36A", name:"Amber" },
  { hex:"#7FCFCB", name:"Teal" },   { hex:"#D89BE8", name:"Orchid" },
]

const FONT_SIZES = [
  { id:"Small",  label:"Small",  px:"13px", desc:"Denser, more on screen" },
  { id:"Medium", label:"Medium", px:"15px", desc:"Default balance" },
  { id:"Large",  label:"Large",  px:"17px", desc:"Easier on the eyes" },
]

const BUBBLE_STYLES = [
  { id:"Rounded", label:"Rounded", radius:"12px" },
  { id:"Square",  label:"Square",  radius:"4px" },
  { id:"Pill",    label:"Pill",    radius:"20px" },
]

const TABS = [
  { id: "agents",  label: "Agents"  },
  { id: "tools",   label: "Tools"   },
  { id: "skills",  label: "Skills"  },
  { id: "voice",   label: "Voice"   },
  { id: "memory",  label: "Memory"  },
  { id: "storage", label: "Storage" },
  { id: "display", label: "Display" },
]

export default function Settings({ onClose }) {
  const { settings, updateSetting } = useStore()
  const [tab, setTab] = useState("agents")
  const [showKey, setShowKey] = useState({})
  const [toolQuery, setToolQuery] = useState("")

  const userEmail = useStore.getState().user?.email

  const updateAgent = (agentId, field, value) => {
    updateSetting("agents", { ...settings.agents, [agentId]: { ...settings.agents[agentId], [field]: value } })
  }

  const updateToolEnabled = (toolId, enabled) => {
    updateSetting("tools", { ...settings.tools, [toolId]: { enabled } })
  }

  const updateToolKey = (toolId, key) => {
    updateSetting("toolKeys", { ...(settings.toolKeys || {}), [toolId]: key })
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onClose()
  }

  const visibleTools = TOOL_REGISTRY.filter(t => !t.hidden)
  const toolCategories = [...new Set(visibleTools.map(t => t.category))]
  const roadmapByCategory = ROADMAP_TOOLS.reduce((acc, t) => {
    (acc[t.category] = acc[t.category] || []).push(t)
    return acc
  }, {})

  // Tools tab search: match against name, description, id, and category label.
  const toolMatch = (t) => {
    const q = toolQuery.trim().toLowerCase()
    if (!q) return true
    return `${t.name} ${t.desc || ''} ${t.id} ${CATEGORY_LABELS[t.category] || t.category}`.toLowerCase().includes(q)
  }
  const liveInCat = (cat) => visibleTools.filter(t => t.category === cat && toolMatch(t))
  const roadInCat = (cat) => (roadmapByCategory[cat] || []).filter(toolMatch)
  const orphanRoadmapCats = Object.keys(roadmapByCategory).filter(cat => !toolCategories.includes(cat))
  const anyToolMatch =
    toolCategories.some(c => liveInCat(c).length || roadInCat(c).length) ||
    orphanRoadmapCats.some(c => roadInCat(c).length)

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
            <button key={t.id} className={`settings-tab${tab === t.id ? " is-active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
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
                <input className="settings-input" type={showKey[agent.id] ? "text" : "password"} placeholder={agent.placeholder} value={settings.agents[agent.id]?.key || ""} onChange={e => updateAgent(agent.id, "key", e.target.value)}/>
                <button className="settings-input-toggle" onClick={() => setShowKey(p => ({ ...p, [agent.id]: !p[agent.id] }))}>{showKey[agent.id] ? "hide" : "show"}</button>
              </div>
              <SetupLinks setup={AGENT_SETUP[agent.id]} />
            </section>
          ))}

          {tab === "tools" && (
            <>
              <input
                className="settings-input settings-search"
                placeholder="Search tools — name, provider, or category…"
                value={toolQuery}
                onChange={e => setToolQuery(e.target.value)}
              />
              {toolCategories.filter(cat => liveInCat(cat).length || roadInCat(cat).length).map(cat => (
                <div key={cat} className="settings-group">
                  <div className="settings-group-label">{CATEGORY_LABELS[cat] || cat}</div>
                  {liveInCat(cat).map(tool => {
                    const on = settings.tools?.[tool.id]?.enabled
                    const usesAgentKey = tool.keySource?.startsWith('agent.')
                    const isStubbed = tool.status === 'needs_proxy_route' || tool.status === 'beta'
                    // Ready when: enabled AND (uses agent key OR has its own key set)
                    const hasKey = usesAgentKey
                      ? !!settings.agents?.gpt?.key
                      : !!settings.toolKeys?.[tool.id]
                    const isReady = on && hasKey && !isStubbed
                    const needsKey = on && !hasKey && !isStubbed
                    return (
                      <section className={`settings-card settings-card--tight${isStubbed ? " settings-card--quiet" : ""}`} key={tool.id}>
                        <div className="settings-row">
                          <div>
                            <div className="settings-row-title">
                              {tool.name}
                              <InfoTip text={tool.capability || tool.desc} />
                              {tool.status === 'needs_proxy_route' && <span className="tool-status-badge">Worker route pending</span>}
                              {tool.status === 'beta' && <span className="tool-status-badge">beta</span>}
                              {isReady && <span className="tool-status-badge tool-status-badge--ready">ready</span>}
                              {needsKey && <span className="tool-status-badge tool-status-badge--warn">needs key</span>}
                            </div>
                            <div className="settings-row-sub">{tool.desc}</div>
                          </div>
                          <Toggle value={on || false} onChange={v => updateToolEnabled(tool.id, v)}/>
                        </div>
                        {on && !usesAgentKey && (
                          <>
                            <label className="settings-label">API key</label>
                            <input className="settings-input" type="password" placeholder={tool.keyPrefix ? `${tool.keyPrefix}...` : "paste key"} value={settings.toolKeys?.[tool.id] || ""} onChange={e => updateToolKey(tool.id, e.target.value)}/>
                            <SetupLinks setup={tool.setup} />
                            {tool.setupHint && (<div className="settings-helper">{tool.setupHint}</div>)}
                          </>
                        )}
                        {on && usesAgentKey && (
                          <div className="settings-helper">Uses your OpenAI key from the Agents tab — no separate key needed.</div>
                        )}
                      </section>
                    )
                  })}
                  {roadInCat(cat).map(tool => (
                    <section className="settings-card settings-card--tight settings-card--quiet" key={tool.id}>
                      <div className="settings-row">
                        <div>
                          <div className="settings-row-title">{tool.name}<InfoTip text={tool.capability || tool.desc} /><span className="tool-status-badge">coming soon</span></div>
                          <div className="settings-row-sub">{tool.desc}</div>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ))}
              {orphanRoadmapCats.filter(cat => roadInCat(cat).length).map(cat => (
                <div key={cat} className="settings-group">
                  <div className="settings-group-label">{CATEGORY_LABELS[cat] || cat}</div>
                  {roadInCat(cat).map(tool => (
                    <section className="settings-card settings-card--tight settings-card--quiet" key={tool.id}>
                      <div className="settings-row">
                        <div>
                          <div className="settings-row-title">{tool.name}<InfoTip text={tool.capability || tool.desc} /><span className="tool-status-badge">coming soon</span></div>
                          <div className="settings-row-sub">{tool.desc}</div>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ))}
              {!anyToolMatch && (
                <div className="settings-helper">No tools match “{toolQuery.trim()}”.</div>
              )}
            </>
          )}

          {tab === "skills" && <SkillsTab/>}

          {tab === "voice" && (
            <>
              <p className="settings-intro">Choose distinct ElevenLabs voices for each agent. ElevenLabs powers the high-quality voices — without a key the app falls back to your browser voice.</p>

              <section className="settings-card settings-card--tight">
                <label className="settings-label">ElevenLabs API key</label>
                <input
                  className="settings-input"
                  type="password"
                  placeholder={settings.toolKeys?.elevenlabs ? "key saved" : "paste key"}
                  value={settings.toolKeys?.elevenlabs || ""}
                  onChange={e => updateToolKey("elevenlabs", e.target.value)}
                />
                <SetupLinks setup={ELEVENLABS_SETUP} />
              </section>

              {/* Narrator voice — used by per-slide narration in builds.
                  Defaults to Rachel; users can pick or paste their own
                  cloned ElevenLabs voice ID. */}
              <section className="settings-card">
                <div className="settings-row">
                  <div>
                    <div className="settings-row-title">Narrator voice</div>
                    <div className="settings-row-sub">Used when builds narrate slides or generate standalone audio. Paste your own cloned voice ID for personalized narration.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.narratorVoiceId || '21m00Tcm4TlvDq8ikWAM'}
                    onChange={(e) => updateSetting("narratorVoiceId", e.target.value)}
                  >
                    {ELEVENLABS_VOICES.map(voice => (<option key={voice.id} value={voice.id}>{voice.name}</option>))}
                  </select>
                </div>
                <label className="settings-label" style={{ marginTop: 'var(--space-3)' }}>Or paste a custom voice ID (cloned voices)</label>
                <input
                  className="settings-input"
                  placeholder="e.g. abc123xyz... (from ElevenLabs Voice Library)"
                  value={settings.narratorVoiceId && !ELEVENLABS_VOICES.find(v => v.id === settings.narratorVoiceId) ? settings.narratorVoiceId : ''}
                  onChange={(e) => updateSetting("narratorVoiceId", e.target.value.trim() || '21m00Tcm4TlvDq8ikWAM')}
                />
              </section>

              {AGENTS.map(agent => {
                const currentVoiceId = settings.agentVoices?.[agent.id]?.elevenLabsId || ELEVENLABS_VOICES.find(v => v.recommended === agent.id)?.id || ELEVENLABS_VOICES[0].id
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
                      <select className="settings-select" value={currentVoiceId} onChange={(e) => {
                        const agentVoices = { ...(settings.agentVoices || {}) }
                        agentVoices[agent.id] = { elevenLabsId: e.target.value }
                        updateSetting("agentVoices", agentVoices)
                      }}>
                        {ELEVENLABS_VOICES.map(voice => (<option key={voice.id} value={voice.id}>{voice.name}{voice.recommended === agent.id ? " (recommended)" : ""}</option>))}
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
                <p className="settings-help">Sets the whole color palette. Tap to preview live.</p>
                <div className="display-theme-grid">
                  {THEMES.map(t => {
                    const active = settings.themeId === t.id
                    return (
                      <button key={t.id} className={`display-theme${active ? " is-active" : ""}`} onClick={() => updateSetting("themeId", t.id)} style={{ background: t.bg, borderColor: active ? settings.accent : t.border }}>
                        <div className="display-theme-preview" style={{ background: t.bgAlt, borderColor: t.border }}>
                          <div className="display-theme-line" style={{ background: t.muted, width: "65%" }}/>
                          <div className="display-theme-line" style={{ background: t.muted, width: "40%", opacity: 0.6 }}/>
                          <div className="display-theme-bubble" style={{ background: settings.accent, color: t.bg }}>Aa</div>
                        </div>
                        <div className="display-theme-foot">
                          <span className="display-theme-name" style={{ color: t.text }}>{t.label}</span>
                          <span className="display-theme-desc" style={{ color: t.muted }}>{t.desc}</span>
                        </div>
                        {active && <span className="display-theme-check" style={{ background: settings.accent }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="settings-card">
                <label className="settings-label">Accent</label>
                <p className="settings-help">The single color used for highlights, links, and active states.</p>
                <div className="display-accents">
                  {ACCENTS.map(c => {
                    const active = settings.accent === c.hex
                    return (
                      <button key={c.hex} className={`display-accent${active ? " is-active" : ""}`} onClick={() => updateSetting("accent", c.hex)} title={c.name} aria-label={c.name} style={{ "--swatch": c.hex }}>
                        <span className="display-accent-swatch" style={{ background: c.hex }}/>
                        <span className="display-accent-name">{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="settings-card">
                <label className="settings-label">Font size</label>
                <p className="settings-help">Affects every chat message and the input field.</p>
                <div className="display-fontsize">
                  {FONT_SIZES.map(sz => (
                    <button key={sz.id} className={`display-fontsize-opt${settings.fontSize === sz.id ? " is-active" : ""}`} onClick={() => updateSetting("fontSize", sz.id)}>
                      <span className="display-fontsize-sample" style={{ fontSize: sz.px }}>Aa</span>
                      <span className="display-fontsize-name">{sz.label}</span>
                      <span className="display-fontsize-desc">{sz.desc}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-card">
                <label className="settings-label">Bubble style</label>
                <p className="settings-help">Corner shape of message bubbles.</p>
                <div className="display-bubble-grid">
                  {BUBBLE_STYLES.map(b => (
                    <button key={b.id} className={`display-bubble-opt${settings.bubbleStyle === b.id ? " is-active" : ""}`} onClick={() => updateSetting("bubbleStyle", b.id)}>
                      <span className="display-bubble-sample" style={{ borderRadius: b.radius, background: settings.accent }}/>
                      <span className="display-bubble-name">{b.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-card display-preview-card">
                <label className="settings-label">Preview</label>
                <div className="display-preview">
                  <div className="display-preview-user" style={{ borderRadius: `var(--bubble-radius)`, fontSize: `var(--chat-font-size)` }}>What does the studio actually do?</div>
                  <div className="display-preview-agent">
                    <div className="display-preview-name" style={{ color: settings.accent }}>Claude</div>
                    <div className="display-preview-text" style={{ fontSize: `var(--chat-font-size)` }}>It's the orchestration layer. You bring your own keys, your own storage. OpenClaw routes everything intelligently and learns how you work over time.</div>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Small "ⓘ" affordance whose native tooltip explains what a tool does. Native
// title is used deliberately: a CSS tooltip would clip inside the scrollable
// settings body, whereas title never clips and is keyboard/screen-reader friendly.
function InfoTip({ text }) {
  if (!text) return null
  return <span className="tool-info" title={text} aria-label={text}>ⓘ</span>
}

function Toggle({ value, onChange }) {
  return (
    <button className={`settings-toggle${value ? " is-on" : ""}`} onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="settings-toggle-thumb"/>
    </button>
  )
}
