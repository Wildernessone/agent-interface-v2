import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { useModalDismiss } from '../utils/useModalDismiss'
import { BRIEF_TEMPLATE } from '../utils/brandContext'

/**
 * Slim project picker that lives in the header next to the brand.
 * Shows the current project name; clicking opens a small dropdown to
 * switch project, create a new one, or EDIT an existing one's brand brief.
 *
 * The brief lives in project.description, which the dispatcher injects into
 * every agent's system prompt (project-context injection) — so a real brief
 * here is what keeps builds on-brand instead of hallucinating. The form offers
 * a labelled template to make a good brief easy to write; editing an existing
 * project is how a brief gets onto projects created before this existed.
 *
 * BRIEF_TEMPLATE is shared with the brand-context gate (utils/brandContext) so
 * the form and the gate agree on what an "unfilled template" looks like.
 */

export default function ProjectPicker() {
  const { activeProject, projects, loadProjects, createProject, updateProject, setActiveProject } = useStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)   // null = new project; id = editing that one
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [busy, setBusy] = useState(false)

  const resetForm = () => { setCreating(false); setEditingId(null); setNewName(""); setNewDesc("") }

  useModalDismiss(() => { setOpen(false); resetForm() }, { active: open })

  useEffect(() => {
    loadProjects()
  }, [])

  // The brand-context gate's notice ("Add a brand brief") dispatches this so the
  // user lands directly in the active project's brief editor instead of hunting
  // for the menu. No active project → just open the picker to create/select one.
  useEffect(() => {
    const handler = () => {
      const proj = useStore.getState().activeProject
      setOpen(true)
      setEditingId(proj?.id || null)
      setNewName(proj?.name || "")
      setNewDesc(proj?.description || "")
      setCreating(true)
    }
    window.addEventListener('openclaw:edit_project', handler)
    return () => window.removeEventListener('openclaw:edit_project', handler)
  }, [])

  const handleSelect = (project) => {
    setActiveProject(project)
    setOpen(false)
  }

  const handleClear = () => {
    setActiveProject(null)
    setOpen(false)
  }

  const startNew = () => { setEditingId(null); setNewName(""); setNewDesc(""); setCreating(true) }
  const startEdit = (p) => { setEditingId(p.id); setNewName(p.name || ""); setNewDesc(p.description || ""); setCreating(true) }

  const handleSave = async () => {
    if (!newName.trim()) return
    setBusy(true)
    const result = editingId
      ? await updateProject(editingId, { name: newName.trim(), description: newDesc.trim() })
      : await createProject(newName.trim(), newDesc.trim())
    setBusy(false)
    if (result) {
      if (!editingId) setActiveProject(result)  // creating: switch to it
      resetForm()
      setOpen(false)
    }
  }

  return (
    <div className="proj-picker">
      <button
        className={`proj-trigger${activeProject ? " is-active" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeProject ? `Project: ${activeProject.name}` : "No project — outputs save to your root Drive folder"}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M1.5 3.5L2.5 2.5H5L6 3.5H10.5V9.5C10.5 10.0523 10.0523 10.5 9.5 10.5H2.5C1.94772 10.5 1.5 10.0523 1.5 9.5V3.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
        </svg>
        <span className="proj-trigger-label">{activeProject?.name || "No project"}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <>
          <div className="proj-overlay" onClick={() => { setOpen(false); resetForm() }}/>
          <div className="proj-menu">
            {!creating && (
              <>
                <button className="proj-item" onClick={handleClear}>
                  <span className="proj-item-name">No project</span>
                  <span className="proj-item-sub">Outputs save flat to Drive</span>
                </button>
                {projects.map(p => (
                  <div key={p.id} className={`proj-item-row${activeProject?.id === p.id ? " is-active" : ""}`}>
                    <button
                      className="proj-item proj-item--select"
                      onClick={() => handleSelect(p)}
                    >
                      <span className="proj-item-name">{p.name}</span>
                      {p.description
                        ? <span className="proj-item-sub">{p.description.replace(/\s+/g, ' ').slice(0, 80)}</span>
                        : <span className="proj-item-sub proj-item-sub--empty">No brand brief — add one ↗</span>}
                    </button>
                    <button className="proj-item-edit" onClick={() => startEdit(p)} title={`Edit ${p.name} brand brief`} aria-label={`Edit ${p.name}`}>
                      Edit
                    </button>
                  </div>
                ))}
                <button className="proj-create-trigger" onClick={startNew}>
                  + New project
                </button>
              </>
            )}

            {creating && (
              <div className="proj-create">
                <label className="settings-label">{editingId ? "Edit project" : "New project"}</label>
                <input
                  className="settings-input"
                  placeholder="Name (e.g. Salt+Pine Coffee launch)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                />
                <textarea
                  className="settings-input proj-brief-input"
                  placeholder={"Brand brief — what it is, who it's for, the voice, what to avoid.\nThis is fed to the agents on every build, so a real brief keeps outputs on-brand."}
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={6}
                />
                <div className="proj-brief-hint">
                  <span>Injected into agent context on every build.</span>
                  {!newDesc.trim() && (
                    <button type="button" className="proj-brief-template" onClick={() => setNewDesc(BRIEF_TEMPLATE)}>
                      Insert template
                    </button>
                  )}
                </div>
                <div className="proj-create-actions">
                  <button className="ai-btn" onClick={resetForm}>Cancel</button>
                  <button
                    className="ai-btn ai-btn--primary"
                    onClick={handleSave}
                    disabled={!newName.trim() || busy}
                  >{busy ? "Saving…" : editingId ? "Save" : "Create"}</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
