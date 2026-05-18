import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

export default function HistorySidebar({ onClose, accent }) {
  accent = accent || '#6366f1'
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const { loadConversations, loadConversation, deleteConversation, clearTurns } = useStore()

  useEffect(() => {
    loadConversations().then(data => {
      setConversations(data || [])
      setLoading(false)
    })
  }, [])

  const handleLoad = async (id) => {
    await loadConversation(id)
    onClose()
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await deleteConversation(id)
    setConversations(prev => prev.filter(c => c.id !== id))
  }

  const handleNew = () => {
    clearTurns()
    onClose()
  }

  const fmt = (dateStr) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return "just now"
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`
    if (diff < 604800000) return `${Math.floor(diff/86400000)}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:150, display:"flex", animation:"fadeIn 0.2s ease" }}>
      <div onClick={onClose} style={{ flex:1, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}/>
      <div style={{ width:300, background:"#0E1117", borderLeft:"1px solid rgba(99,102,241,0.2)", display:"flex", flexDirection:"column", boxShadow:"-20px 0 60px rgba(0,0,0,0.4)" }}>
        
        {/* Header */}
        <div style={{ padding:"18px 18px 14px", borderBottom:"1px solid rgba(99,102,241,0.15)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.9)" }}>History</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:"monospace", marginTop:2 }}>{conversations.length} conversations</div>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>

        {/* New conversation */}
        <div style={{ padding:"12px 14px", borderBottom:"1px solid rgba(99,102,241,0.1)" }}>
          <button onClick={handleNew} style={{ width:"100%", padding:"9px 0", borderRadius:10, background:`rgba(99,102,241,0.15)`, border:`1px solid rgba(99,102,241,0.35)`, color:"#a5b4fc", fontSize:12, cursor:"pointer", fontFamily:"monospace" }}>
            + New conversation
          </button>
        </div>

        {/* List */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {loading && (
            <div style={{ padding:24, textAlign:"center", fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>Loading...</div>
          )}
          {!loading && conversations.length === 0 && (
            <div style={{ padding:32, textAlign:"center" }}>
              <div style={{ fontSize:28, opacity:0.15, marginBottom:8 }}>◈</div>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>No saved conversations yet</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginTop:4 }}>Conversations save automatically</div>
            </div>
          )}
          {conversations.map(c => (
            <div key={c.id} onClick={() => handleLoad(c.id)}
              style={{ padding:"12px 16px", borderBottom:"1px solid rgba(255,255,255,0.05)", cursor:"pointer", position:"relative", transition:"background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.08)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", marginBottom:3, paddingRight:24, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.title}</div>
              {c.preview && <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", lineHeight:1.4 }}>{c.preview}</div>}
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>{fmt(c.updated_at)} · {c.turn_count} turns</div>
              <button onClick={(e) => handleDelete(e, c.id)}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"rgba(255,255,255,0.2)", cursor:"pointer", fontSize:14, padding:4, opacity:0 }}
                onMouseEnter={e => e.target.style.opacity = 1}
                onMouseLeave={e => e.target.style.opacity = 0}
              >🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
