import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { ensureSkillsFolders, seedExampleSkills } from '../utils/skillsLoader'

const AGENT_LABELS = {
  shared: 'Shared (all agents)',
  claude: 'Claude',
  gpt:    'ChatGPT',
  gemini: 'Gemini',
  grok:   'Grok',
}

export default function SkillsTab() {
  const { skills, loadSkills, settings, updateSetting } = useStore()
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupResult, setSetupResult] = useState(null)
  const [seedBusy, setSeedBusy] = useState(false)
  const [seedResult, setSeedResult] = useState(null)
  const loading = skills?.loading

  useEffect(() => { loadSkills() }, [])

  const handleRefresh = async () => {
    setSetupResult(null)
    setSeedResult(null)
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

  const handleSeed = async () => {
    setSeedBusy(true)
    setSeedResult(null)
    const result = await seedExampleSkills()
    setSeedResult(result)
    setSeedBusy(false)
    if (result.ok) await loadSkills()
  }

  // Per-agent toggle: when off, that agent doesn't load shared/ or its own
  // folder. Saves tokens (and money) for agents that don't need the extra
  // context. Persisted via the existing enabled_agents jsonb column.
  const toggleAgentSkills = (agentId) => {
    const current = settings.agents?.[agentId] || {}
    updateSetting('agents', {
      ...settings.agents,
      [agentId]: { ...current, useSkills: current.useSkills === false ? true : false },
    })
  }

  const agentOrder = ['shared', 'claude', 'gpt', 'gemini', 'grok']
  const allEmpty = agentOrder.every(k => !skills?.[k]?.length)

  return (
    <div>
      <p className="settings-intro">
        Skills are <code>.md</code> files you drop into your Drive that extend what each agent knows.
        Drop <code>accountant.md</code> into <code>Skills/claude/</code> and Claude will reason like an accountant on every conversation. <code>Skills/shared/</code> applies to all agents. Files auto-load on sign-in.
      </p>

      {/* TOKEN COST WARNING */}
      <section className="settings-card" style={{ borderLeft: '2px solid var(--color-status-warning)' }}>
        <div className="settings-row-title">⚡ Skills cost tokens</div>
        <p className="settings-helper" style={{ marginTop: 'var(--space-2)' }}>
          Every loaded skill gets prepended to that agent's system prompt on <em>every</em> message. More skills = bigger prompts = more tokens billed to your API key. Rough cost per 10K tokens of skills:
        </p>
        <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          <li>Claude Sonnet — ~$0.03 per message</li>
          <li>GPT-4o — ~$0.05 per message</li>
          <li>Gemini Flash — ~$0.0008 per message (nearly free)</li>
          <li>Grok — ~$0.05 per message</li>
        </ul>
        <p className="settings-helper" style={{ marginTop: 'var(--space-3)' }}>
          <strong>Toggle the “Use skills” switch per agent below</strong> to disable skills for agents that don't need the extra context. Disabled agents read nothing — not shared, not their own folder.
        </p>
      </section>

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
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button className="ai-btn" onClick={handleSeed} disabled={seedBusy || loading}>
              {seedBusy ? 'Adding…' : 'Add 3 example skills'}
            </button>
            <span className="settings-helper" style={{ margin: 0, fontSize: 'var(--font-size-xs)' }}>
              Drops <code>be-direct.md</code>, <code>panel-etiquette.md</code>, and <code>project-context.md</code> into <code>Skills/shared/</code> to show you the format.
            </span>
          </div>
          {seedResult && (
            <div className="settings-helper" style={{ marginTop: 'var(--space-3)' }}>
              {seedResult.ok
                ? <>Added {seedResult.added} file{seedResult.added === 1 ? '' : 's'}{seedResult.skipped > 0 ? ` (${seedResult.skipped} already existed)` : ''}. <a className="settings-link" href={seedResult.folderLink} target="_blank" rel="noreferrer">Open shared folder ↗</a></>
                : seedResult.reason === 'no_drive'
                  ? 'Drive isn\'t connected. Go to Storage and connect first.'
                  : 'Couldn\'t add example skills. Check Drive permissions and try again.'
              }
            </div>
          )}
        </section>
      )}

      {/* Per-agent loaded skill lists */}
      {agentOrder.map(key => {
        const items = skills?.[key] || []
        if (items.length === 0) return null
        const active = items.filter(s => !s.skipped)
        const dropped = items.filter(s => s.skipped)
        const totalTokens = active.reduce((sum, s) => sum + (s.tokenEst || 0), 0)

        // Shared section has no per-agent toggle — it flows to whichever
        // agents have useSkills on. Real agents get a toggle.
        const isAgent = key !== 'shared'
        const useSkills = !isAgent || settings.agents?.[key]?.useSkills !== false
        const isDisabled = isAgent && !useSkills

        return (
          <section className={`settings-card${isDisabled ? ' settings-card--quiet' : ''}`} key={key}>
            <div className="settings-row">
              <div>
                <div className="settings-row-title">
                  {AGENT_LABELS[key]}
                  <span className="tool-status-badge" style={{ marginLeft: 'var(--space-3)' }}>
                    {active.length} skill{active.length === 1 ? '' : 's'} · ~{(totalTokens / 1000).toFixed(1)}K tokens
                  </span>
                  {isDisabled && <span className="tool-status-badge" style={{ marginLeft: 'var(--space-2)' }}>skills off</span>}
                </div>
                {isAgent && (
                  <div className="settings-row-sub">
                    {useSkills
                      ? `Adds ~${(totalTokens / 1000).toFixed(1)}K tokens to every ${AGENT_LABELS[key]} message.`
                      : `Skills disabled for ${AGENT_LABELS[key]}. Toggle on to inject this knowledge on every message.`
                    }
                  </div>
                )}
              </div>
              {isAgent && (
                <Toggle value={useSkills} onChange={() => toggleAgentSkills(key)} />
              )}
            </div>
            {useSkills && (
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
            )}
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

function Toggle({ value, onChange }) {
  return (
    <button
      className={`settings-toggle${value ? ' is-on' : ''}`}
      onClick={onChange}
      role="switch"
      aria-checked={value}
    >
      <span className="settings-toggle-thumb"/>
    </button>
  )
}
