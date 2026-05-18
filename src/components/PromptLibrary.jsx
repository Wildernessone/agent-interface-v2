import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'
import { useStore } from '../store/useStore'

const BUILT_IN_TEMPLATES = [
  { id:"brainstorm", name:"Brainstorm Session", icon:"💡", category:"Creative", prompt:"I want to brainstorm [TOPIC]. Give me diverse perspectives, challenge assumptions, and build on each other's ideas.", mode:"balanced" },
  { id:"debate", name:"Devil's Advocate", icon:"⚖️", category:"Strategy", prompt:"I believe [YOUR IDEA]. Challenge this thinking — find the strongest counterarguments and risks I haven't considered.", mode:"balanced" },
  { id:"explain", name:"Explain Simply", icon:"🎓", category:"Learning", prompt:"Explain [CONCEPT] like I'm smart but not an expert. Use a real-world analogy. Tell me the one thing most people get wrong about it.", mode:"concise" },
  { id:"product", name:"Product Feedback", icon:"📱", category:"Product", prompt:"Here's my product idea: [DESCRIBE IT]. Give honest feedback — what's strong, what's weak, who the real customer is, and the biggest risk.", mode:"balanced" },
  { id:"code-review", name:"Code Review", icon:"🔍", category:"Technical", prompt:"Please review this code: [PASTE CODE]. Look for bugs, performance issues, security concerns, and suggest improvements.", mode:"balanced" },
  { id:"market", name:"Market Research", icon:"📊", category:"Strategy", prompt:"Research [COMPANY/MARKET]. I need: key players, market size, recent trends, and where the opportunities are.", mode:"balanced" },
  { id:"launch", name:"Launch Plan", icon:"🚀", category:"Product", prompt:"Help me build a launch plan for [PRODUCT]. I need: target audience, messaging, channels, timeline, and the one metric that matters most.", mode:"balanced" },
  { id:"email", name:"Email Drafter", icon:"✉️", category:"Writing", prompt:"Write a professional email for: [DESCRIBE SITUATION]. Tone: [professional/friendly/firm]. Key points: [LIST POINTS].", mode:"concise" },
  { id:"debate-this", name:"Debate This", icon:"🗣️", category:"Creative", prompt:"Debate this topic from multiple angles: [TOPIC]. I want to see genuine disagreement and pushback between you.", mode:"balanced" },
]

const CATEGORIES = ["All", "Creative", "Strategy", "Product", "Technical", "Learning", "Writing"]

export default function PromptLibrary({ onUse, onClose, accent }) {
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
      user_id: user.id, title: saveTitle, content: saveContent, created_at: new Date().toISOString()
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

  // Get last user message for save prompt
  const lastUserMessage = turns.filter(t => t.type === "user").slice(-1)[0]?.text || ""

  return (
    <div style={{ position:"fixed", inset:0, zIndex:150, display:"flex" }}>
      <div onClick={onClose} style={{ flex:1, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}/>
      <div style={{ width:340, background:"#0E1117", borderLeft:"1px solid rgba(99,102,241,0.2)", display:"flex", flexDirection:"column", boxShadow:"-20px 0 60px rgba(0,0,0,0.4)" }}>
        
        {/* Header */}
        <div style={{ padding:"18px 18px 0", borderBottom:"1px solid rgba(99,102,241,0.15)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.9)" }}>Prompts</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:"monospace", marginTop:2 }}>Templates & saved prompts</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={() => { setSaveContent(lastUserMessage); setShowSave(true) }} style={{ padding:"4px 10px", borderRadius:8, background:`rgba(99,102,241,0.15)`, border:`1px solid rgba(99,102,241,0.35)`, color:"#a5b4fc", fontSize:10, cursor:"pointer", fontFamily:"monospace" }}>+ Save</button>
              <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
            </div>
          </div>
          {/* Tabs */}
          <div style={{ display:"flex" }}>
            {["templates","saved"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding:"8px 14px", border:"none", background:"transparent", cursor:"pointer", fontSize:11, fontFamily:"monospace", textTransform:"capitalize", color:tab===t?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)", borderBottom:tab===t?`2px solid ${accent}`:"2px solid transparent" }}>{t}</button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={{ padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prompts..." style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"7px 12px", fontSize:12, color:"rgba(255,255,255,0.8)", fontFamily:"monospace", outline:"none" }}/>
        </div>

        {/* Category filter (templates only) */}
        {tab === "templates" && (
          <div style={{ padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", gap:5, overflowX:"auto" }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)} style={{ padding:"3px 10px", borderRadius:20, border:`1px solid ${category===c?accent:"rgba(255,255,255,0.1)"}`, background:category===c?`${accent}18`:"transparent", color:category===c?accent:"rgba(255,255,255,0.3)", fontSize:10, cursor:"pointer", fontFamily:"monospace", whiteSpace:"nowrap", flexShrink:0 }}>{c}</button>
            ))}
          </div>
        )}

        {/* List */}
        <div style={{ flex:1, overflowY:"auto", padding:"8px 14px" }}>
          {loading && <div style={{ textAlign:"center", padding:20, fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>Loading...</div>}
          
          {tab === "saved" && !loading && filtered.length === 0 && (
            <div style={{ textAlign:"center", padding:32 }}>
              <div style={{ fontSize:28, opacity:0.15, marginBottom:8 }}>📚</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>No saved prompts yet</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginTop:4 }}>Click + Save to save your prompts</div>
            </div>
          )}

          {filtered.map(item => (
            <div key={item.id} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = `${accent}44`}
              onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"}
            >
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:6 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  {item.icon && <span style={{ fontSize:16 }}>{item.icon}</span>}
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.85)" }}>{item.name || item.title}</div>
                    {item.category && <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:"monospace", marginTop:1 }}>{item.category}</div>}
                  </div>
                </div>
                <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                  {!item.icon && <button onClick={() => handleDelete(item.id)} style={{ padding:"3px 7px", borderRadius:6, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.3)", fontSize:10, cursor:"pointer" }}>🗑</button>}
                  <button onClick={() => { onUse(item.prompt || item.content, item.mode); onClose() }} style={{ padding:"3px 10px", borderRadius:6, border:`1px solid ${accent}44`, background:`${accent}18`, color:accent, fontSize:10, cursor:"pointer", fontFamily:"monospace" }}>Use →</button>
                </div>
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{item.prompt || item.content}</div>
            </div>
          ))}
        </div>

        {/* Save modal */}
        {showSave && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, zIndex:10 }}>
            <div style={{ width:"100%", background:"#0E1117", border:"1px solid rgba(99,102,241,0.3)", borderRadius:16, padding:20 }}>
              <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.9)", marginBottom:14 }}>Save Prompt</div>
              <input value={saveTitle} onChange={e => setSaveTitle(e.target.value)} placeholder="Give it a name..." style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.8)", fontFamily:"monospace", outline:"none", marginBottom:10 }}/>
              <textarea value={saveContent} onChange={e => setSaveContent(e.target.value)} placeholder="Prompt text..." rows={4} style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.8)", fontFamily:"monospace", outline:"none", resize:"vertical", marginBottom:12 }}/>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => setShowSave(false)} style={{ flex:1, padding:"9px 0", borderRadius:9, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.5)", fontSize:12, cursor:"pointer" }}>Cancel</button>
                <button onClick={handleSave} disabled={!saveTitle.trim()||!saveContent.trim()} style={{ flex:2, padding:"9px 0", borderRadius:9, border:`1px solid ${accent}44`, background:`${accent}18`, color:accent, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>Save Prompt →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
