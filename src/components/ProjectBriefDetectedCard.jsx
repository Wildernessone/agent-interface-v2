import { useState } from 'react'

/**
 * PROJECT BRIEF DETECTED CARD
 * ===========================
 * Non-intrusive callout (dashed accent border) shown below the panel's first
 * response when the classifier spots a real brand/product brief in a message
 * and no project is active. Offers to remember it as a project. Never pushy:
 * leads with what was detected, states the value plainly, and the easy out
 * ("Not now") sits right beside the primary action.
 *
 * onSave(extracted)  → Promise<project|null>  (parent creates + attaches convo)
 * onDismiss()        → parent suppresses for the rest of the conversation
 * onEdit(extracted)  → parent opens the project editor prefilled
 */
export default function ProjectBriefDetectedCard({ extracted, onSave, onDismiss, onEdit }) {
  const [status, setStatus] = useState('idle')   // idle | saving | saved | editing | gone
  const [savedName, setSavedName] = useState('')

  if (status === 'gone') return null

  if (status === 'saved') {
    return (
      <div className="ai-turn pbd-card pbd-card--done">
        <span className="pbd-icon" aria-hidden="true">✓</span>
        <span className="pbd-done-text">Saved to <strong>{savedName}</strong> — the panel will remember this next time.</span>
      </div>
    )
  }

  if (status === 'editing') {
    return (
      <div className="ai-turn pbd-card pbd-card--done">
        <span className="pbd-icon" aria-hidden="true">📝</span>
        <span className="pbd-done-text">Opened the project editor — tweak it and hit save there.</span>
      </div>
    )
  }

  const name = extracted?.name || 'this'
  const type = extracted?.type ? `, a ${extracted.type}` : ''

  const handleSave = async () => {
    setStatus('saving')
    const proj = await onSave?.(extracted)
    if (proj) { setSavedName(proj.name || name); setStatus('saved') }
    else setStatus('idle')   // failed — let them try again or dismiss
  }

  return (
    <div className="ai-turn pbd-card" role="note">
      <div className="pbd-head">
        <span className="pbd-icon" aria-hidden="true">📁</span>
        <span className="pbd-title">Looks like a real project</span>
      </div>
      <p className="pbd-msg">
        I caught a brand brief in your message — <strong>{name}</strong>{type}.
        Save it as a project so the panel remembers next time?
      </p>
      <div className="pbd-actions">
        <button className="ai-btn ai-btn--primary" disabled={status === 'saving'} onClick={handleSave}>
          {status === 'saving' ? 'Saving…' : 'Save as project'}
        </button>
        <button className="ai-btn ai-btn--ghost" disabled={status === 'saving'} onClick={() => { setStatus('gone'); onDismiss?.() }}>
          Not now
        </button>
        <button className="pbd-edit-link" disabled={status === 'saving'} onClick={() => { onEdit?.(extracted); setStatus('editing') }}>
          Edit before saving
        </button>
      </div>
    </div>
  )
}
