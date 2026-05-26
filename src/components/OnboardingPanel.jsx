import { useState } from 'react'
import { useStore } from '../store/useStore'

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

export default function OnboardingPanel({ onSkip }) {
  const { settings, updateSetting } = useStore()
  const [expandedAll, setExpandedAll] = useState(false)
  const [showKeyFor, setShowKeyFor] = useState("claude")
  const [keyInput, setKeyInput] = useState("")
  const [saving, setSaving] = useState(null)

  const updateAgentKey = (id, key) => {
    updateSetting("agents", {
      ...settings.agents,
      [id]: { ...settings.agents[id], key, enabled: true },
    })
  }

  const handleSave = async (id) => {
    if (!keyInput.trim()) return
    setSaving(id)
    updateAgentKey(id, keyInput.trim())
    setKeyInput("")
    setSaving(null)
  }

  const recommended = PROVIDERS[0]
  const others = PROVIDERS.slice(1)

  return (
    <div className="onboarding">
      <h2 className="onboarding-title">Welcome to Agent Interface</h2>
      <p className="onboarding-sub">
        To get started, connect at least one AI. You use your own API keys — your billing, your data, your control.
      </p>

      <ProviderCard
        provider={recommended}
        featured
        open={showKeyFor === recommended.id}
        onToggle={() => setShowKeyFor(showKeyFor === recommended.id ? null : recommended.id)}
        keyInput={showKeyFor === recommended.id ? keyInput : ""}
        onKeyInput={setKeyInput}
        onSave={() => handleSave(recommended.id)}
        saving={saving === recommended.id}
      />

      {!expandedAll && (
        <button className="onboarding-toggle" onClick={() => setExpandedAll(true)}>
          Show other agents ↓
        </button>
      )}

      {expandedAll && (
        <div className="onboarding-others">
          <div className="onboarding-others-label">Other agents</div>
          {others.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              open={showKeyFor === p.id}
              onToggle={() => { setShowKeyFor(showKeyFor === p.id ? null : p.id); setKeyInput("") }}
              keyInput={showKeyFor === p.id ? keyInput : ""}
              onKeyInput={setKeyInput}
              onSave={() => handleSave(p.id)}
              saving={saving === p.id}
            />
          ))}
        </div>
      )}

      <div className="onboarding-skip">
        <button className="onboarding-skip-btn" onClick={onSkip}>
          Skip — I'll explore first
        </button>
      </div>
    </div>
  )
}

function ProviderCard({ provider, featured, open, onToggle, keyInput, onKeyInput, onSave, saving }) {
  return (
    <section className={`onboarding-card${featured ? " is-featured" : ""}${open ? " is-open" : ""}`}>
      <button className="onboarding-card-head" onClick={onToggle}>
        <div className="onboarding-card-avatar" style={{ color: provider.color, borderColor: provider.color }}>
          {provider.avatar}
        </div>
        <div className="onboarding-card-meta">
          <div className="onboarding-card-name">
            {provider.name}
            {featured && <span className="onboarding-badge">Recommended</span>}
          </div>
          <div className="onboarding-card-blurb">{provider.blurb}</div>
        </div>
        <div className="onboarding-card-chev" aria-hidden>{open ? "−" : "+"}</div>
      </button>

      {open && (
        <div className="onboarding-card-body">
          <p className="onboarding-card-why">{provider.why}</p>
          <ol className="onboarding-steps">
            <li>
              <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="onboarding-step-link">
                Get your {provider.provider} API key ↗
              </a>
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
            <button
              className="ai-btn ai-btn--primary"
              disabled={!keyInput.trim() || saving}
              onClick={onSave}
            >{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
    </section>
  )
}
