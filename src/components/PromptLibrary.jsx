import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'
import { useStore } from '../store/useStore'
import { useModalDismiss } from '../utils/useModalDismiss'

const BUILT_IN_TEMPLATES = [
  { id:"brainstorm",   name:"Brainstorm Session", category:"Creative",  prompt:"I want to brainstorm [TOPIC]. Give me diverse perspectives, challenge assumptions, and build on each other's ideas.", mode:"balanced" },
  { id:"debate",       name:"Devil's Advocate",   category:"Strategy",  prompt:"I believe [YOUR IDEA]. Challenge this thinking — find the strongest counterarguments and risks I haven't considered.", mode:"balanced" },
  { id:"explain",      name:"Explain Simply",     category:"Learning",  prompt:"Explain [CONCEPT] like I'm smart but not an expert. Use a real-world analogy. Tell me the one thing most people get wrong about it.", mode:"concise" },
  { id:"product",      name:"Product Feedback",   category:"Product",   prompt:"Here's my product idea: [DESCRIBE IT]. Give honest feedback — what's strong, what's weak, who the real customer is, and the biggest risk.", mode:"balanced" },
  { id:"code-review",  name:"Code Review",        category:"Technical", prompt:"Please review this code: [PASTE CODE]. Look for bugs, performance issues, security concerns, and suggest improvements.", mode:"balanced" },
  { id:"market",       name:"Market Research",    category:"Strategy",  prompt:"Research [COMPANY/MARKET]. I need: key players, market size, recent trends, and where the opportunities are.", mode:"balanced" },
  { id:"launch",       name:"Launch Plan",        category:"Product",   prompt:"Help me build a launch plan for [PRODUCT]. I need: target audience, messaging, channels, timeline, and the one metric that matters most.", mode:"balanced" },
  { id:"email",        name:"Email Drafter",      category:"Writing",   prompt:"Write a professional email for: [DESCRIBE SITUATION]. Tone: [professional/friendly/firm]. Key points: [LIST POINTS].", mode:"concise" },
  { id:"debate-this",  name:"Debate This",        category:"Creative",  prompt:"Debate this topic from multiple angles: [TOPIC]. I want to see genuine disagreement and pushback between you.", mode:"balanced" },
  { id:"build-ad",     name:"Build an Ad",        category:"Creative",  prompt:"I want to build a 30-second ad for [PRODUCT/BRAND]. Target audience: [WHO]. Tone: [VIBE]. Let's discuss script, music, and visuals, then say 'build it' to fire the tools.", mode:"balanced" },
]

const CATEGORIES = ["All", "Creative", "Strategy", "Product", "Technical", "Learning", "Writing"]

export default function PromptLibrary({ onUse, onClose }) {
  useModalDismiss(onClose)
  const [tab, setTab] = useState("templates")
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("All")
  const [showSave, setShowSave] = useState(false)
  const [saveTitle, setSaveTitle] = useState("")
  const [saveContent, setSaveContent] = useState("")
  const { turns } = useStore()

  useEffect(() => {
    if (tab === "saved") fetchSaved()
  }, [tab])

  const fetchSaved = async () => {
    setLoading(true)
    const { data } = await supabase.from("prompt_library").select("*").order("created_at", { ascending: false })
    setSaved(data || [])
    setLoading(false)
  }

  const handleSave = async () => {
    if (!saveTitle.trim() || !saveContent.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from("prompt_library").insert({
      user_id: user.id, title: saveTitle, content: saveContent, created_at: new Date().toISOString(),
    }).select().single()
    if (data) setSaved(prev => [data, ...prev])
    setShowSave(false); setSaveTitle(""); setSaveContent("")
    setTab("saved")
  }

  const handleDelete = async (id) => {
    await supabase.from("prompt_library").delete().eq("id", id)
    setSaved(prev => prev.filter(p => p.id !== id))
  }

  const filtered = tab === "templates"
    ? BUILT_IN_TEMPLATES.filter(t => {
        const matchCat = category === "All" || t.category === category
        const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.prompt.toLowerCase().includes(search.toLowerCase())
        return matchCat && matchSearch
      })
    : saved.filter(p => !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.content.toLowerCase().includes(search.toLowerCase()))

  const lastUserMessage = turns.filter(t => t.type === "user").slice(-1)[0]?.text || ""

  return (
    <div className="sidebar-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="sidebar sidebar--wide" role="dialog" aria-modal="true" aria-labelledby="prompts-title">
        <header className="sidebar-header">
          <div>
            <h2 id="prompts-title">Prompts</h2>
            <div className="sidebar-sub">Templates and your saved prompts</div>
          </div>
          <div className="sidebar-header-actions">
            <button className="ai-btn" onClick={() => { setSaveContent(lastUserMessage); setShowSave(true) }}>+ Save</button>
            <button className="ai-iconbtn" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
        </header>

        <nav className="settings-tabs">
          {[{ id:"templates", label:"Templates" }, { id:"saved", label:"Saved" }].map(t => (
            <button
              key={t.id}
              className={`settings-tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>

        <div className="sidebar-filters">
          <input
            className="settings-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts…"
          />
          {tab === "templates" && (
            <div className="sidebar-cats">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  className={`ai-chip${category === c ? " is-active" : ""}`}
                  onClick={() => setCategory(c)}
                >{c}</button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-body">
          {loading && <div className="sidebar-status">Loading…</div>}

          {tab === "saved" && !loading && filtered.length === 0 && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-title">No saved prompts</div>
              <div className="sidebar-empty-sub">Click + Save above to keep a prompt for later.</div>
            </div>
          )}

          {filtered.map(item => (
            <section key={item.id} className="prompt-card">
              <div className="prompt-card-head">
                <div>
                  <div className="prompt-card-title">{item.name || item.title}</div>
                  {item.category && <div className="prompt-card-cat">{item.category}</div>}
                </div>
                <div className="prompt-card-actions">
                  {!item.name && (
                    <button className="prompt-card-icon" onClick={() => handleDelete(item.id)} aria-label="Delete">
                      <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M2 3.5H11M5 6V10M8 6V10M3.5 3.5V11C3.5 11.5523 3.94772 12 4.5 12H8.5C9.05228 12 9.5 11.5523 9.5 11V3.5M5 3.5V2C5 1.44772 5.44772 1 6 1H7C7.55228 1 8 1.44772 8 2V3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  )}
                  <button
                    className="ai-btn ai-btn--primary"
                    onClick={() => { onUse(item.prompt || item.content, item.mode); onClose() }}
                  >Use →</button>
                </div>
              </div>
              <div className="prompt-card-body">{item.prompt || item.content}</div>
            </section>
          ))}
        </div>

        {showSave && (
          <div className="prompt-save-backdrop">
            <div className="prompt-save-dialog">
              <h3>Save prompt</h3>
              <input
                className="settings-input"
                value={saveTitle}
                onChange={e => setSaveTitle(e.target.value)}
                placeholder="Name it…"
              />
              <textarea
                className="settings-input"
                value={saveContent}
                onChange={e => setSaveContent(e.target.value)}
                placeholder="Prompt text…"
                rows={5}
              />
              <div className="prompt-save-actions">
                <button className="ai-btn" onClick={() => setShowSave(false)}>Cancel</button>
                <button
                  className="ai-btn ai-btn--primary"
                  onClick={handleSave}
                  disabled={!saveTitle.trim() || !saveContent.trim()}
                >Save prompt</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
