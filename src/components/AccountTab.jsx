import { useState } from 'react'
import { useStore } from '../store/useStore'

// Account & data controls: plan/trial status, GDPR data export, and account
// deletion. Deletion is gated behind a typed confirmation because it is
// irreversible (calls the delete_my_account RPC, then signs out).
export default function AccountTab() {
  const { settings, exportMyData, deleteMyAccount } = useStore()
  const email = useStore.getState().user?.email
  const [exporting, setExporting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const tier = settings.subscription_tier || settings.plan || 'free'

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const payload = await exportMyData()
      if (!payload) { setError('Could not export — are you signed in?'); return }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-interface-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return
    setDeleting(true)
    setError('')
    const ok = await deleteMyAccount()
    if (!ok) {
      setError('Deletion failed. Please try again or contact support.')
      setDeleting(false)
    }
    // On success the RPC signs the user out, which unmounts this view.
  }

  return (
    <>
      <section className="settings-card">
        <label className="settings-label">Account</label>
        <p className="settings-help">{email || 'Not signed in'}</p>
        <div className="settings-row">
          <div className="settings-row-main">
            <div>
              <div className="settings-row-title">Current plan</div>
              <div className="settings-row-sub" style={{ textTransform: 'capitalize' }}>{tier}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <label className="settings-label">Your data</label>
        <p className="settings-help">
          Download everything we store for you — conversations, projects, memory, prompts, and usage —
          as a JSON file. Encrypted API keys and connected-storage tokens are excluded for security.
        </p>
        <button className="ai-btn" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
      </section>

      <section className="settings-card">
        <label className="settings-label">Privacy &amp; terms</label>
        <p className="settings-help">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          {' · '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
        </p>
      </section>

      <section className="settings-card settings-card--danger">
        <label className="settings-label">Delete account</label>
        <p className="settings-help">
          Permanently deletes your account and all associated data. This cannot be undone.
          Type <strong>DELETE</strong> to confirm.
        </p>
        <input
          className="settings-input"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder="DELETE"
          aria-label="Type DELETE to confirm account deletion"
        />
        <button
          className="ai-btn ai-btn--danger"
          onClick={handleDelete}
          disabled={confirmText !== 'DELETE' || deleting}
          style={{ marginTop: 8 }}
        >
          {deleting ? 'Deleting…' : 'Permanently delete my account'}
        </button>
      </section>

      {error && <p className="settings-help" role="alert" style={{ color: 'var(--color-status-error)' }}>{error}</p>}
    </>
  )
}
