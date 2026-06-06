import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { AGENT_SETUP } from '../config/agentSetup'
import { supabase } from '../utils/supabase'
import { listStorageConnections } from '../utils/cloudStorage'
import SetupLinks from './SetupLinks'

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    provider: "Anthropic",
    color: "var(--color-agent-claude)",
    avatar: "C",
    placeholder: "sk-ant-api03-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    blurb: "Best at reasoning, writing, and nuanced thinking. OpenClaw uses Claude as its compiler when available.",
    why: "Best starting agent — Claude orchestrates the others when you debate or build.",
  },
  {
    id: "gpt",
    name: "ChatGPT",
    provider: "OpenAI",
    color: "var(--color-agent-gpt)",
    avatar: "G",
    placeholder: "sk-proj-…",
    docsUrl: "https://platform.openai.com/api-keys",
    blurb: "Strong at code, structured output, and image generation (DALL-E uses this key).",
    why: "Add this if you'll generate images.",
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "Google",
    color: "var(--color-agent-gemini)",
    avatar: "X",
    placeholder: "AIza…",
    docsUrl: "https://aistudio.google.com/app/apikey",
    blurb: "Strong at research and real-time data. Free tier available.",
    why: "Great free option to round out the roundtable.",
  },
  {
    id: "grok",
    name: "Grok",
    provider: "xAI",
    color: "var(--color-agent-grok)",
    avatar: "GR",
    placeholder: "xai-…",
    docsUrl: "https://console.x.ai",
    blurb: "Current events, internet culture, direct opinions. Adds friction to the debate.",
    why: "Optional — adds contrarian energy when debating.",
  },
]

const STEPS = ['Connect an AI', 'Build your panel', 'Connect a drive', "You're set"]

// Multi-step first-run wizard: connect a key → add more agents (so the panel can
// debate) → connect a drive (so builds save) → done. Each step reflects real
// state, so the user can't get "stuck" — Skip is always available, and the
// wizard closes via onDone(). Mounted by TheInterface only for users with no
// agents connected and no chat history.
export default function OnboardingPanel({ onSkip }) {
  const { settings, updateSetting } = useStore()
  const [step, setStep] = useState(0)
  const [showKeyFor, setShowKeyFor] = useState("claude")
  const [keyInput, setKeyInput] = useState("")
  const [saving, setSaving] = useState(null)
  const [storage, setStorage] = useState(null)   // null = loading, [] = none, [..] = connected
  const [connectingDrive, setConnectingDrive] = useState(false)

  useEffect(() => { listStorageConnections().then(setStorage) }, [])

  const updateAgentKey = (id, key) => {
    updateSetting("agents", { ...settings.agents, [id]: { ...settings.agents[id], key, enabled: true } })
  }
  const handleSave = async (id) => {
    if (!keyInput.trim()) return
    setSaving(id)
    updateAgentKey(id, keyInput.trim())
    setKeyInput("")
    setSaving(null)
    setShowKeyFor(null)
  }

  const connected = PROVIDERS.filter(p => settings.agents?.[p.id]?.key)
  const connectedIds = new Set(connected.map(p => p.id))
  const hasDrive = (storage || []).includes('google_drive') || (storage || []).includes('dropbox')

  const connectDrive = async () => {
    setConnectingDrive(true)
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          scopes: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar.events',
          ].join(' '),
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      })
      // Redirects away; on return the user lands signed-in with Drive connected.
    } catch { setConnectingDrive(false) }
  }

  const cardFor = (p, featured) => (
    <ProviderCard
      key={p.id}
      provider={p}
      featured={featured}
      connected={connectedIds.has(p.id)}
      open={showKeyFor === p.id}
      onToggle={() => { setShowKeyFor(showKeyFor === p.id ? null : p.id); setKeyInput("") }}
      keyInput={showKeyFor === p.id ? keyInput : ""}
      onKeyInput={setKeyInput}
      onSave={() => handleSave(p.id)}
      saving={saving === p.id}
    />
  )

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))

  return (
    <div className="onboarding">
      <div className="wiz-progress" role="list" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <div key={label} role="listitem" className={`wiz-dot${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}>
            <span className="wiz-dot-num">{i < step ? '✓' : i + 1}</span>
            <span className="wiz-dot-label">{label}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="wiz-step">
          <h2 className="onboarding-title">Connect your first AI</h2>
          <p className="onboarding-sub">You bring your own API keys — your billing, your data, your control. One is enough to start; you can add more next.</p>
          {cardFor(PROVIDERS[0], true)}
          <div className="onboarding-others">
            <div className="onboarding-others-label">Or start with another</div>
            {PROVIDERS.slice(1).map(p => cardFor(p, false))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="wiz-step">
          <h2 className="onboarding-title">Build your panel</h2>
          <p className="onboarding-sub">
            The magic is the <strong>debate</strong> — two or more AIs arguing a question from different angles.
            You have {connected.length} connected{connected.length === 1 ? '. Add at least one more so they can debate.' : ' — nice, that\'s a panel.'}
          </p>
          {PROVIDERS.filter(p => !connectedIds.has(p.id)).map(p => cardFor(p, false))}
          {connected.length >= 2 && <p className="wiz-note">✓ {connected.length} agents ready to debate.</p>}
        </div>
      )}

      {step === 2 && (
        <div className="wiz-step">
          <h2 className="onboarding-title">Connect a drive <span className="wiz-optional">optional</span></h2>
          <p className="onboarding-sub">
            When the panel builds something — a deck, doc, image, audio — it saves straight to <strong>your</strong> cloud.
            Without a drive, builds stay inline in the chat. You can also do this later in Settings → Storage.
          </p>
          {hasDrive ? (
            <p className="wiz-note">✓ Storage connected — builds will auto-save.</p>
          ) : (
            <button className="ai-btn ai-btn--primary" onClick={connectDrive} disabled={connectingDrive}>
              {connectingDrive ? 'Opening Google…' : 'Connect Google Drive'}
            </button>
          )}
          <p className="wiz-fineprint">Connecting opens Google to authorize — you'll come back here signed in. The same connection lets the panel email deliverables via Gmail.</p>
        </div>
      )}

      {step === 3 && (
        <div className="wiz-step">
          <h2 className="onboarding-title">You're set 🎉</h2>
          <ul className="wiz-recap">
            <li>{connected.length > 0 ? '✓' : '○'} {connected.length} AI{connected.length === 1 ? '' : 's'} connected{connected.length >= 2 ? ' — the panel can debate' : ''}</li>
            <li>{hasDrive ? '✓ Drive connected — builds auto-save' : '○ No drive yet — builds stay inline (add one anytime in Settings)'}</li>
          </ul>
          <p className="onboarding-sub">Tell the panel what you're working on, ask them to debate a decision, or have them build something. OpenClaw routes it to the right agents.</p>
          <button className="ai-btn ai-btn--primary wiz-finish" onClick={onSkip}>Start using Agent Interface</button>
        </div>
      )}

      <div className="wiz-footer">
        {step > 0 && <button className="onboarding-toggle" onClick={back}>← Back</button>}
        <div className="wiz-footer-spacer" />
        {step < STEPS.length - 1 && (
          <>
            <button className="onboarding-skip-btn" onClick={onSkip}>Skip setup</button>
            <button
              className="ai-btn ai-btn--primary"
              onClick={next}
              disabled={step === 0 && connected.length === 0}
            >
              {step === 0 && connected.length === 0 ? 'Connect one to continue' : 'Next →'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function ProviderCard({ provider, featured, connected, open, onToggle, keyInput, onKeyInput, onSave, saving }) {
  return (
    <section className={`onboarding-card${featured ? " is-featured" : ""}${open ? " is-open" : ""}${connected ? " is-connected" : ""}`}>
      <button className="onboarding-card-head" onClick={onToggle}>
        <div className="onboarding-card-avatar" style={{ color: provider.color, borderColor: provider.color }}>
          {provider.avatar}
        </div>
        <div className="onboarding-card-meta">
          <div className="onboarding-card-name">
            {provider.name}
            {connected ? <span className="onboarding-badge onboarding-badge--ok">✓ connected</span>
              : featured && <span className="onboarding-badge">Recommended</span>}
          </div>
          <div className="onboarding-card-blurb">{provider.blurb}</div>
        </div>
        <div className="onboarding-card-chev" aria-hidden>{open ? "−" : connected ? "↻" : "+"}</div>
      </button>

      {open && (
        <div className="onboarding-card-body">
          <p className="onboarding-card-why">{provider.why}</p>
          <ol className="onboarding-steps">
            <li>
              Get your {provider.provider} API key:
              <SetupLinks setup={AGENT_SETUP[provider.id]} />
            </li>
            <li>Paste it below — keys save automatically.</li>
          </ol>
          <div className="onboarding-key-row">
            <input
              className="settings-input"
              type="password"
              placeholder={provider.placeholder}
              value={keyInput}
              onChange={e => onKeyInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") onSave() }}
            />
            <button className="ai-btn ai-btn--primary" disabled={!keyInput.trim() || saving} onClick={onSave}>
              {saving ? "Saving…" : connected ? "Replace" : "Save"}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
