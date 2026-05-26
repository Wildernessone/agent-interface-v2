import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

/**
 * Slim project picker that lives in the header next to the brand.
 * Shows the current project name; clicking opens a small dropdown to
 * switch project, create a new one, or clear the active project.
 */
export default function ProjectPicker() {
  const { activeProject, projects, loadProjects, createProject, setActiveProject } = useStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  const handleSelect = (project) => {
    setActiveProject(project)
    setOpen(false)
  }

  const handleClear = () => {
    setActiveProject(null)
    setOpen(false)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    const project = await createProject(newName.trim(), newDesc.trim())
    setBusy(false)
    if (project) {
      setNewName(""); setNewDesc(""); setCreating(false); setOpen(false)
    }
  }

  return (
    <div className="proj-picker">
      <button
        className={`proj-trigger${activeProject ? " is-active" : ""}`}
        onClick={() => setOpen(o => !o)}
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
          <div className="proj-overlay" onClick={() => { setOpen(false); setCreating(false) }}/>
          <div className="proj-menu">
            {!creating && (
              <>
                <button className="proj-item" onClick={handleClear}>
                  <span className="proj-item-name">No project</span>
                  <span className="proj-item-sub">Outputs save flat to Drive</span>
                </button>
                {projects.map(p => (
                  <button
                    key={p.id}
                    className={`proj-item${activeProject?.id === p.id ? " is-active" : ""}`}
                    onClick={() => handleSelect(p)}
                  >
                    <span className="proj-item-name">{p.name}</span>
                    {p.description && <span className="proj-item-sub">{p.description}</span>}
                  </button>
                ))}
                <button className="proj-create-trigger" onClick={() => setCreating(true)}>
                  + New project
                </button>
              </>
            )}

            {creating && (
              <div className="proj-create">
                <label className="settings-label">New project</label>
                <input
                  className="settings-input"
                  placeholder="Name (e.g. Salt+Pine Coffee launch)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreate() }}
                  autoFocus
                />
                <input
                  className="settings-input"
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                />
                <div className="proj-create-actions">
                  <button className="ai-btn" onClick={() => { setCreating(false); setNewName(""); setNewDesc("") }}>Cancel</button>
                  <button
                    className="ai-btn ai-btn--primary"
                    onClick={handleCreate}
                    disabled={!newName.trim() || busy}
                  >{busy ? "Creating…" : "Create"}</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
