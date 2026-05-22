import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

const MEMORY_TYPES = [
  { id:"about",    icon:"👤", label:"About Me",        hint:"Who you are, what you do, your role" },
  { id:"business", icon:"🏢", label:"Business",         hint:"Company overview, target customer, industry" },
  { id:"brand",    icon:"🎨", label:"Brand & Style",    hint:"Voice, colors, design preferences, tone" },
  { id:"prefs",    icon:"⚙️", label:"Preferences",      hint:"How you like things done, formats you prefer" },
  { id:"context",  icon:"📚", label:"Background",       hint:"Past AI exports, trained context, history" },
  { id:"links",    icon:"🔗", label:"Resources",        hint:"Websites, docs, references agents should know" },
]

export default function MemoryTab({ accent, theme }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()
  const { loadMemory, saveMemory, deleteMemory } = useStore()

  const th = theme || {
    text: "rgba(255,255,255,0.88)",
    textMuted: "rgba(255,255,255,0.42)",
    textFaint: "rgba(255,255,255,0.18)",
    border: "rgba(99,102,241,0.15)",
    surface: "rgba(255,255,255,0.04)",
  }

  useEffect(() => {
    loadMemory().then(data => {
      setMemories(data || [])
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    if (editing) {
      // Update existing
      const { data: { user } } = await import('../utils/supabase').then(m => m.supabase.auth.getUser())
      const { supabase } = await import('../utils/supabase')
      const { data } = await supabase.from('agent_memory')
        .update({ title, content, updated_at: new Date().toISOString() })
        .eq('id', editing)
        .select().single()
      if (data) setMemories(prev => prev.map(m => m.id === editing ? data : m))
      setEditing(null)
    } else {
      const saved = await saveMemory(title, content, "upload")
      if (saved) setMemories(prev => [saved, ...prev])
    }
    setTitle(""); setContent(""); setAdding(false)
    setSaving(false)
  }

  const handleEdit = (memory) => {
    setEditing(memory.id)
    setTitle(memory.title)
    setContent(memory.content)
    setAdding(true)
  }

  const handleAppend = (memory) => {
    setEditing(memory.id)
    setTitle(memory.title)
    setContent(memory.content + "\n\n")
    setAdding(true)
    setTimeout(() => {
      const ta = document.querySelector(".memory-textarea")
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }
    }, 100)
  }

  const handleDelete = async (id) => {
    await deleteMemory(id)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSaving(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target.result
      const saved = await saveMemory(file.name.replace(/\.[^/.]+$/, ""), text.slice(0, 5000), "upload")
      if (saved) setMemories(prev => [saved, ...prev])
      setSaving(false)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const cancelEdit = () => {
    setEditing(null); setAdding(false)
    setTitle(""); setContent("")
  }

  const inp = { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:`1px solid ${accent}33`, borderRadius:8, padding:"8px 12px", fontSize:12, color:th.text, fontFamily:"monospace", outline:"none" }

  return (
    <div>
      <div style={{ fontSize:11, color:th.textMuted, fontFamily:"monospace", marginBottom:14, lineHeight:1.6 }}>
        Everything here gets injected into every agent conversation. They know your business from day one.
      </div>

      {/* Quick type buttons */}
      {!adding && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
          {MEMORY_TYPES.map(t => (
            <button key={t.id} onClick={() => { setTitle(t.label); setAdding(true) }} style={{ padding:"5px 10px", borderRadius:20, border:`1px solid rgba(255,255,255,0.1)`, background:"rgba(255,255,255,0.04)", color:th.textMuted, fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {!adding && (
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <button onClick={() => setAdding(true)} style={{ flex:1, padding:"9px 0", borderRadius:10, background:`${accent}15`, border:`1px solid ${accent}44`, color:accent, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
            ✏️ Write a note
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ flex:1, padding:"9px 0", borderRadius:10, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", color:th.textMuted, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
            📄 Upload file
          </button>
          <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} style={{ display:"none" }}/>
        </div>
      )}

      {/* Edit/Add form */}
      {adding && (
        <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${accent}33`, borderRadius:12, padding:14, marginBottom:14 }}>
          <div style={{ fontSize:11, color:accent, fontFamily:"monospace", marginBottom:8 }}>
            {editing ? "✏️ Editing memory" : "✏️ New memory"}
          </div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (e.g. About Me, Brand Voice...)" style={{...inp, marginBottom:8}}/>
          <textarea className="memory-textarea" value={content} onChange={e => setContent(e.target.value)}
            placeholder="Write what you want agents to always know..." rows={6}
            style={{...inp, resize:"vertical", lineHeight:1.6, marginBottom:10}}/>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={cancelEdit} style={{ flex:1, padding:"8px 0", borderRadius:8, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:th.textMuted, fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={!title.trim()||!content.trim()||saving} style={{ flex:2, padding:"8px 0", borderRadius:8, border:`1px solid ${accent}44`, background:`${accent}18`, color:accent, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
              {saving ? "Saving..." : editing ? "Save Changes →" : "Save to Memory →"}
            </button>
          </div>
        </div>
      )}

      {saving && !adding && <div style={{ textAlign:"center", padding:10, fontSize:11, color:accent, fontFamily:"monospace" }}>Saving...</div>}

      {/* Memory list */}
      {loading && <div style={{ textAlign:"center", padding:20, fontSize:12, color:th.textFaint, fontFamily:"monospace" }}>Loading...</div>}

      {!loading && memories.length === 0 && (
        <div style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:32, opacity:0.15, marginBottom:8 }}>🧠</div>
          <div style={{ fontSize:12, color:th.textFaint, fontFamily:"monospace" }}>No memory yet</div>
          <div style={{ fontSize:10, color:th.textFaint, fontFamily:"monospace", marginTop:4 }}>Add notes or upload files — agents will know this in every conversation</div>
        </div>
      )}

      {memories.map(m => (
        <div key={m.id} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4 }}>
            <div style={{ fontSize:12, fontWeight:600, color:th.text }}>{m.title}</div>
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <button onClick={() => handleAppend(m)} title="Add more" style={{ background:"none", border:"none", color:th.textFaint, cursor:"pointer", fontSize:12, padding:"0 3px" }}>+</button>
              <button onClick={() => handleEdit(m)} title="Edit" style={{ background:"none", border:"none", color:th.textFaint, cursor:"pointer", fontSize:12, padding:"0 3px" }}>✏️</button>
              <button onClick={() => handleDelete(m.id)} title="Delete" style={{ background:"none", border:"none", color:th.textFaint, cursor:"pointer", fontSize:12, padding:"0 3px" }}>🗑</button>
            </div>
          </div>
          <div style={{ fontSize:11, color:th.textMuted, lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{m.content}</div>
          <div style={{ fontSize:9, color:th.textFaint, fontFamily:"monospace", marginTop:6 }}>
            {m.source === "learned" ? "🤖 learned" : m.source === "upload" ? "📄 uploaded" : "✏️ written"} · {new Date(m.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}

      {memories.length > 0 && (
        <div style={{ fontSize:10, color:th.textFaint, fontFamily:"monospace", textAlign:"center", marginTop:8 }}>
          {memories.length} item{memories.length!==1?"s":""} in memory · injected into every conversation
        </div>
      )}
    </div>
  )
}
