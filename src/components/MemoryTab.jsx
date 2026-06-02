import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { supabase } from '../utils/supabase'
import { SkeletonList } from './Skeleton'

const MEMORY_TYPES = [
  { id:"about",    label:"About Me",     hint:"Who you are, what you do, your role" },
  { id:"business", label:"Business",     hint:"Company overview, target customer, industry" },
  { id:"brand",    label:"Brand & Style", hint:"Voice, colors, design preferences, tone" },
  { id:"prefs",    label:"Preferences",  hint:"How you like things done, formats you prefer" },
  { id:"context",  label:"Background",   hint:"Past AI exports, trained context, history" },
  { id:"links",    label:"Resources",    hint:"Websites, docs, references agents should know" },
]

export default function MemoryTab() {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
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
    setSaving(true)
    if (editing) {
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

  return (
    <div>
      <p className="settings-intro">
        Everything here gets injected into every agent conversation. They know your business from day one.
      </p>

      {!adding && (
        <div className="memory-quick">
          {MEMORY_TYPES.map(t => (
            <button key={t.id} className="memory-chip" onClick={() => { setTitle(t.label); setAdding(true) }} title={t.hint}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!adding && (
        <div className="memory-actions">
          <button className="ai-btn ai-btn--primary" onClick={() => setAdding(true)}>Write a note</button>
          <button className="ai-btn" onClick={() => fileRef.current?.click()}>Upload file</button>
          <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} style={{ display:"none" }}/>
        </div>
      )}

      {adding && (
        <section className="settings-card memory-form">
          <label className="settings-label">{editing ? "Editing memory" : "New memory"}</label>
          <input
            className="settings-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title (e.g. About Me, Brand Voice…)"
          />
          <textarea
            className="settings-input memory-textarea"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="What should agents always know?"
            rows={6}
          />
          <div className="memory-form-actions">
            <button className="ai-btn" onClick={cancelEdit}>Cancel</button>
            <button
              className="ai-btn ai-btn--primary"
              onClick={handleSave}
              disabled={!title.trim() || !content.trim() || saving}
            >{saving ? "Saving…" : editing ? "Save changes" : "Save to memory"}</button>
          </div>
        </section>
      )}

      {saving && !adding && <div className="memory-status">Saving…</div>}

      {loading && <SkeletonList rows={5} />}

      {!loading && memories.length === 0 && (
        <div className="memory-empty">
          <div className="memory-empty-title">No memory yet</div>
          <div className="memory-empty-sub">Add notes or upload files — agents will know this in every conversation.</div>
        </div>
      )}

      {memories.map(m => (
        <section key={m.id} className="memory-item">
          <div className="memory-item-head">
            <div className="memory-item-title">{m.title}</div>
            <div className="memory-item-actions">
              <button className="memory-item-btn" onClick={() => handleAppend(m)} title="Append">+</button>
              <button className="memory-item-btn" onClick={() => handleEdit(m)} title="Edit">edit</button>
              <button className="memory-item-btn" onClick={() => handleDelete(m.id)} title="Delete">delete</button>
            </div>
          </div>
          <div className="memory-item-body">{m.content}</div>
          <div className="memory-item-meta">
            {m.source === "learned" ? "learned" : m.source === "upload" ? "uploaded" : "written"} · {new Date(m.created_at).toLocaleDateString()}
          </div>
        </section>
      ))}

      {memories.length > 0 && (
        <div className="memory-footer">
          {memories.length} item{memories.length!==1?"s":""} in memory · injected into every conversation
        </div>
      )}
    </div>
  )
}
