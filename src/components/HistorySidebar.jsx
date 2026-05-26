import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

export default function HistorySidebar({ onClose }) {
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
    if (diff < 60_000) return "just now"
    if (diff < 3_600_000) return `${Math.floor(diff/60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff/3_600_000)}h ago`
    if (diff < 604_800_000) return `${Math.floor(diff/86_400_000)}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="sidebar-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <div>
            <h2>History</h2>
            <div className="sidebar-sub">{conversations.length} conversation{conversations.length === 1 ? "" : "s"}</div>
          </div>
          <button className="ai-iconbtn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
        </header>

        <div className="sidebar-action">
          <button className="ai-btn ai-btn--primary sidebar-new" onClick={handleNew}>+ New conversation</button>
        </div>

        <div className="sidebar-body">
          {loading && <div className="sidebar-status">Loading…</div>}

          {!loading && conversations.length === 0 && (
            <div className="sidebar-empty">
              <div className="sidebar-empty-title">No saved conversations</div>
              <div className="sidebar-empty-sub">Conversations save automatically as you chat.</div>
            </div>
          )}

          {conversations.map(c => (
            <button key={c.id} className="sidebar-item" onClick={() => handleLoad(c.id)}>
              <div className="sidebar-item-title">{c.title}</div>
              {c.preview && <div className="sidebar-item-preview">{c.preview}</div>}
              <div className="sidebar-item-meta">{fmt(c.updated_at)} · {c.turn_count} turns</div>
              <button
                className="sidebar-item-delete"
                onClick={(e) => handleDelete(e, c.id)}
                aria-label="Delete"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5H11M5 6V10M8 6V10M3.5 3.5V11C3.5 11.5523 3.94772 12 4.5 12H8.5C9.05228 12 9.5 11.5523 9.5 11V3.5M5 3.5V2C5 1.44772 5.44772 1 6 1H7C7.55228 1 8 1.44772 8 2V3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
