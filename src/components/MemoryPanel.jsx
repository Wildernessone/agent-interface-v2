import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { inferMemoriesFromConversation } from '../utils/openClaw'
import { supabase } from '../utils/supabase'

/**
 * Memory panel — the visible personalization loop.
 *
 * Two stacked sections:
 *   1. "What I'm learning" — candidate memories OpenClaw inferred from the
 *      current conversation. User confirms, edits, or dismisses each.
 *   2. "What I know" — already-confirmed memories. Editable, deletable.
 *
 * The discovery action ("Learn from this conversation") triggers an LLM
 * pass over the live transcript. Confirmed candidates write to
 * agent_memory and flow back into every future agent + OpenClaw call.
 */
export default function MemoryPanel({ open, onClose, turns, settings }) {
  const { saveMemory, deleteMemory, loadMemory } = useStore()
  const [stored, setStored] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    if (!open) return
    loadMemory().then(setStored)
    setCandidates([])
    setError(null)
  }, [open])

  const handleDiscover = async () => {
    setLoading(true); setError(null)
    const { candidates: found, error: err } = await inferMemoriesFromConversation({
      turns,
      existingMemories: stored,
      settings,
    })
    setLoading(false)
    if (err) {
      setError(
        err === "no_model_key" ? "Add a Claude, ChatGPT, or Gemini key in Settings first." :
        err === "empty_conversation" ? "Start a conversation first — there's nothing to learn from yet." :
        "Couldn't reach the model. Try again in a moment."
      )
      return
    }
    if (found.length === 0) {
      setError("Nothing new to learn from this conversation yet.")
      return
    }
    setCandidates(found)
  }

  const handleConfirm = async (cand) => {
    const saved = await saveMemory(cand.title, cand.content, "learned")
    if (saved) {
      setStored(prev => [saved, ...prev])
      setCandidates(prev => prev.filter(c => c !== cand))
    }
  }

  const handleEditCandidate = (cand, field, value) => {
    setCandidates(prev => prev.map(c => c === cand ? { ...c, [field]: value } : c))
  }

  const handleDismiss = (cand) => {
    setCandidates(prev => prev.filter(c => c !== cand))
  }

  const handleDelete = async (id) => {
    await deleteMemory(id)
    setStored(prev => prev.filter(m => m.id !== id))
  }

  if (!open) return null

  return (
    <>
      <div className="mem-overlay" onClick={onClose}/>
      <aside className="mem-panel" role="dialog" aria-label="Memory">
        <header className="mem-header">
          <h2>Memory</h2>
          <button className="mem-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <p className="mem-sub">
          What OpenClaw remembers about you flows into every conversation.
          Confirm, edit, or remove anything — you're in control.
        </p>

        {/* Candidates section */}
        <section className="mem-section">
          <div className="mem-section-head">
            <h3>What I'm learning</h3>
            <button
              className="ai-btn ai-btn--primary"
              onClick={handleDiscover}
              disabled={loading || !turns?.length}
              title={!turns?.length ? "Start a conversation first" : "Pull learnings from this conversation"}
            >{loading ? "Reading…" : "Learn from this conversation"}</button>
          </div>

          {error && <div className="mem-error">{error}</div>}

          {candidates.length === 0 && !error && (
            <div className="mem-empty">
              Click <strong>Learn from this conversation</strong> to surface what I'm noticing about how you work.
            </div>
          )}

          {candidates.map((cand, i) => (
            <article key={i} className={`mem-card mem-card--candidate confidence-${cand.confidence || "medium"}`}>
              <input
                className="mem-title-input"
                value={cand.title || ""}
                onChange={e => handleEditCandidate(cand, "title", e.target.value)}
                placeholder="Title"
              />
              <textarea
                className="mem-content-input"
                value={cand.content || ""}
                onChange={e => handleEditCandidate(cand, "content", e.target.value)}
                rows={2}
              />
              {cand.evidence && (
                <p className="mem-evidence">From: <em>{cand.evidence}</em></p>
              )}
              <div className="mem-card-actions">
                <button className="ai-btn ai-btn--ghost" onClick={() => handleDismiss(cand)}>Dismiss</button>
                <button className="ai-btn ai-btn--primary" onClick={() => handleConfirm(cand)}>Confirm</button>
              </div>
            </article>
          ))}
        </section>

        {/* Stored memories */}
        <section className="mem-section">
          <div className="mem-section-head">
            <h3>What I know</h3>
            <span className="mem-count">{stored.length}</span>
          </div>

          {stored.length === 0 && (
            <div className="mem-empty">
              Nothing saved yet. As you confirm learnings, they show up here and shape every future response.
            </div>
          )}

          {stored.map(m => (
            <article key={m.id} className="mem-card mem-card--stored">
              {editing === m.id ? (
                <StoredEditor memory={m} onSaved={(updated) => {
                  setStored(prev => prev.map(x => x.id === updated.id ? updated : x))
                  setEditing(null)
                }} onCancel={() => setEditing(null)}/>
              ) : (
                <>
                  <h4>{m.title}</h4>
                  <p>{m.content}</p>
                  <div className="mem-card-meta">
                    <span className={`mem-source mem-source--${m.source}`}>{m.source}</span>
                    <div className="mem-card-actions">
                      <button className="ai-btn ai-btn--ghost" onClick={() => setEditing(m.id)}>Edit</button>
                      <button className="ai-btn ai-btn--ghost mem-danger" onClick={() => handleDelete(m.id)}>Delete</button>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
        </section>
      </aside>
    </>
  )
}

function StoredEditor({ memory, onSaved, onCancel }) {
  const [title, setTitle] = useState(memory.title || "")
  const [content, setContent] = useState(memory.content || "")
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('agent_memory')
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq('id', memory.id)
      .select().single()
    setBusy(false)
    if (!error && data) onSaved(data)
  }

  return (
    <>
      <input className="mem-title-input" value={title} onChange={e => setTitle(e.target.value)}/>
      <textarea className="mem-content-input" value={content} onChange={e => setContent(e.target.value)} rows={3}/>
      <div className="mem-card-actions">
        <button className="ai-btn ai-btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="ai-btn ai-btn--primary" onClick={save} disabled={busy || !title.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  )
}
