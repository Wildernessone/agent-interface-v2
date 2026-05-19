import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

export default function MemoryTab({ accent, ss, theme }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()
  const { loadMemory, saveMemory, deleteMemory } = useStore()

  useEffect(() => {
    loadMemory().then(data => {
      setMemories(data || [])
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    setUploading(true)
    const saved = await saveMemory(title, content, "manual")
    if (saved) setMemories(prev => [saved, ...prev])
    setTitle(""); setContent(""); setAdding(false)
    setUploading(false)
  }

  const handleDelete = async (id) => {
    await deleteMemory(id)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target.result
      const saved = await saveMemory(file.name, text, "upload")
      if (saved) setMemories(prev => [saved, ...prev])
      setUploading(false)
    }
    reader.readAsText(file)
  }

  const sourceIcon = (source) => {
    if (source === "upload") return "📄"
    if (source === "chatgpt_export") return "🤖"
    if (source === "claude_export") return "🟠"
    return "✏️"
  }

  return (
    <div>
      <div style={{ fontSize:12, color:theme.textMuted, fontFamily:"monospace", marginBottom:14, lineHeight:1.6 }}>
        Upload documents, brand guides, or notes. Agents will read this context in every conversation and know your business from day one.
      </div>

      {/* Add buttons */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <button onClick={() => setAdding(!adding)} style={{ flex:1, padding:"9px 0", borderRadius:10, background:`${accent}15`, border:`1px solid ${accent}44`, color:accent, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
          ✏️ Write a note
        </button>
        <button onClick={() => fileRef.current?.click()} style={{ flex:1, padding:"9px 0", borderRadius:10, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.6)", fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
          📄 Upload file
        </button>
        <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.json,.docx" onChange={handleFileUpload} style={{ display:"none" }}/>
      </div>

      {/* Add note form */}
      {adding && (
        <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${accent}33`, borderRadius:12, padding:14, marginBottom:14 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (e.g. Brand Voice, Company Overview)" style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.9)", fontFamily:"monospace", outline:"none", marginBottom:8 }}/>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write what you want your agents to always know about you, your business, your preferences..." rows={5} style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"rgba(255,255,255,0.9)", fontFamily:"monospace", outline:"none", resize:"vertical", marginBottom:10 }}/>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setAdding(false)} style={{ flex:1, padding:"8px 0", borderRadius:8, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.4)", fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={!title.trim()||!content.trim()||uploading} style={{ flex:2, padding:"8px 0", borderRadius:8, border:`1px solid ${accent}44`, background:`${accent}18`, color:accent, fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
              {uploading ? "Saving..." : "Save to Memory →"}
            </button>
          </div>
        </div>
      )}

      {uploading && !adding && (
        <div style={{ textAlign:"center", padding:12, fontSize:12, color:accent, fontFamily:"monospace" }}>Saving to memory...</div>
      )}

      {/* Memory list */}
      {loading && <div style={{ textAlign:"center", padding:20, fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>Loading...</div>}

      {!loading && memories.length === 0 && (
        <div style={{ textAlign:"center", padding:32 }}>
          <div style={{ fontSize:32, opacity:0.15, marginBottom:8 }}>🧠</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>No memory yet</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginTop:4 }}>
            Add notes or upload documents — agents will know this in every conversation
          </div>
        </div>
      )}

      {memories.map(m => (
        <div key={m.id} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <span>{sourceIcon(m.source)}</span>
              <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.85)" }}>{m.title}</div>
            </div>
            <button onClick={() => handleDelete(m.id)} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.2)", cursor:"pointer", fontSize:13, padding:"0 4px" }}>🗑</button>
          </div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", lineHeight:1.5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{m.content}</div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginTop:6 }}>{new Date(m.created_at).toLocaleDateString()}</div>
        </div>
      ))}

      {memories.length > 0 && (
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", textAlign:"center", marginTop:8 }}>
          {memories.length} item{memories.length!==1?"s":""} in memory · injected into every conversation
        </div>
      )}
    </div>
  )
}
