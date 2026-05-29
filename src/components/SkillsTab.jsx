import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { ensureSkillsFolders } from '../utils/skillsLoader'

const AGENT_LABELS = {
  shared: 'Shared (all agents)',
  claude: 'Claude',
  gpt:    'ChatGPT',
  gemini: 'Gemini',
  grok:   'Grok',
}

export default function SkillsTab() {
  const { skills, loadSkills } = useStore()
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupResult, setSetupResult] = useState(null)
  const loading = skills?.loading

  // Refresh on mount so opening the tab always shows fresh state
  useEffect(() => { loadSkills() }, [])

  const handleRefresh = async () => {
    setSetupResult(null)
    await loadSkills()
  }

  const handleSetup = async () => {
    setSetupBusy(true)
    setSetupResult(null)
    const result = await ensureSkillsFolders()
    setSetupResult(result)
    setSetupBusy(false)
    if (result.ok) await loadSkills()
  }

  const agentOrder = ['shared', 'claude', 'gpt', 'gemini', 'grok']
  const allEmpty = agentOrder.every(k => !skills?.[k]?.length)

  return (
    <div>
      <p className="settings-intro">
        Skills are <code>.md</code> files you drop into your Drive that extend what each agent knows.
        Drop <code>accountant.md</code> into <code>Skills/claude/</code> and Claude will reason like an accountant on every conversation. <code>Skills/shared/</code> applies to all agents. Files auto-load on sign-in.
      </p>

      {/* Header actions */}
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">
              {loading ? 'Reading your Drive…' : skills?.loadedAt ? `Last refreshed ${new Date(skills.loadedAt).toLocaleTimeString()}` : 'Skills not loaded yet'}
            </div>
            {skills?.error === 'drive_not_connected' && (
              <div className="settings-row-sub">Drive isn't connected. Go to Storage and connect Google Drive first.</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button className="ai-btn" onClick={handleRefresh} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="ai-btn ai-btn--primary" onClick={handleSetup} disabled={setupBusy || loading}>
              {setupBusy ? 'Setting up…' : 'Set up Skills folders'}
            </button>
          </div>
        </div>
        {setupResult && (
          <div className="settings-helper" style={{ marginTop: 'var(--space-3)' }}>
            {setupResult.ok
              ? <>Folder structure ready. <a className="settings-link" href={setupResult.folderLink} target="_blank" rel="noreferrer">Open Skills folder in Drive ↗</a></>
              : setupResult.reason === 'no_drive'
                ? 'Drive isn\'t connected. Go to Storage and connect first.'
                : 'Couldn\'t set up folders. Check Drive permissions and try again.'
            }
          </div>
        )}
      </section>

      {allEmpty && !loading && !skills?.error && (
        <section className="settings-card settings-card--quiet">
          <p className="settings-helper">
            <strong>How to add skills:</strong><br/>
            1. Click <em>Set up Skills folders</em> above to create the structure in your Drive.<br/>
            2. Drop any <code>.md</code> file into the agent's folder (or shared/).<br/>
            3. Come back here and tap Refresh — you'll see it appear below.<br/><br/>
            <strong>Tip:</strong> Claude Skills files from anywhere on the web work as-is. Just drag them into the right folder.
          </p>
        </section>
      )}

      {/* Per-agent loaded skill lists */}
      {agentOrder.map(key => {
        const items = skills?.[key] || []
        if (items.length === 0) return null
        const active = items.filter(s => !s.skipped)
        const dropped = items.filter(s => s.skipped)
        const totalTokens = active.reduce((sum, s) => sum + (s.tokenEst || 0), 0)

        return (
          <section className="settings-card" key={key}>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">
                  {AGENT_LABELS[key]}
                  <span className="tool-status-badge" style={{ marginLeft: 'var(--space-3)' }}>
                    {active.length} skill{active.length === 1 ? '' : 's'} · ~{(totalTokens / 1000).toFixed(1)}K tokens
                  </span>
                </div>
              </div>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-3) 0 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {active.map((s, i) => (
                <li key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-bg-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--font-size-sm)',
                }}>
                  <div>
                    <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{s.name}</span>
                    {s.description && <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'var(--space-2)' }}>— {s.description}</span>}
                  </div>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-family-mono)' }}>
                    ~{s.tokenEst} tokens
                  </span>
                </li>
              ))}
              {dropped.length > 0 && (
                <li style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                  {dropped.length} older file{dropped.length === 1 ? '' : 's'} skipped (token cap reached). Newest files load first.
                </li>
              )}
            </ul>
          </section>
        )
      })}

      <section className="settings-card settings-card--quiet">
        <div className="settings-row-title">Skill file format</div>
        <p className="settings-helper">
          Skills are plain markdown. Optional YAML frontmatter for metadata:
        </p>
        <pre style={{
          padding: 'var(--space-3)', background: 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-secondary)', overflow: 'auto',
        }}>{`---
name: Tax Strategy
description: How I think about Q4 tax planning
---

When analyzing tax questions, prefer concrete numbers...
`}</pre>
      </section>
    </div>
  )
}
