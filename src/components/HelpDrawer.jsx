import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { useModalDismiss } from '../utils/useModalDismiss'
import { askHelp } from '../utils/openClaw'
import { TOOL_REGISTRY } from '../tools/registry'
import { AGENT_SETUP } from '../config/agentSetup'
import SetupLinks from './SetupLinks'

const AGENT_NAMES = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' }
const AGENT_ALIASES = {
  claude: ['anthropic'],
  gpt: ['openai', 'chatgpt', 'dall-e', 'dalle'],
  gemini: ['google'],
  grok: ['xai', 'x.ai'],
}

// Static app knowledge the registry can't express. Kept terse — it's prepended
// to the per-tool/agent setup info to form the assistant's whole knowledge base.
const APP_CONCEPTS = `APP BASICS:
- A roundtable of AI agents (Claude, ChatGPT, Gemini, Grok). Add each one's API key in Settings -> Agents. OpenClaw routes your message to the right agents.
- Spend modes: frugal (cheapest, skips extras), balanced (default), premium (best models + skills). It sticks to your last mode until you signal otherwise.
- Modes: "discuss" = the agents debate; "build" = it produces a deliverable (deck, doc, spreadsheet, image, audio) using tools.
- Voice mode reads replies aloud (uses your ElevenLabs key if set, otherwise the browser voice).
- Skills: a per-agent toggle that injects your skill files; premium forces them on, frugal off.
COMMON PROBLEMS:
- Notion "404 / can't find parent": you forgot to SHARE the target page/database with your integration (Notion page -> ... menu -> Connections -> add your integration).
- Runway: use the developer portal (Get key button), NOT the consumer app — API credits are separate.
- Suno: there is no official public API or self-serve key page; API access is partner-beta only.
- OpenAI and Anthropic keys need prepaid credits before they work, and the key is shown only once.
- A tool shows "needs key": open Settings -> Tools, expand it, and paste the key (use its Get key button).`

function buildKnowledge() {
  const agents = Object.entries(AGENT_SETUP).map(([id, s]) =>
    `AGENT ${AGENT_NAMES[id]} (key lives in Settings -> Agents): ${s.seeText || ''} ${s.note || ''}`.trim())
  const tools = TOOL_REGISTRY.filter(t => t.setup).map(t =>
    `TOOL ${t.name}: ${t.capability || t.desc || ''} | Setup: ${t.setup.seeText || 'see the buttons'} ${t.setup.note || ''}`.trim())
  return [APP_CONCEPTS, '', 'AGENTS:', ...agents, '', 'TOOLS:', ...tools].join('\n')
}
const KNOWLEDGE = buildKnowledge()

// Deterministically pick which providers' verified setup links to show under an
// answer, by matching the question against agent/tool names + ids. We never let
// the model emit links — these chips come straight from our verified data.
function matchProviders(text) {
  const q = text.toLowerCase()
  const out = []
  for (const [id, s] of Object.entries(AGENT_SETUP)) {
    if (q.includes(id) || (AGENT_ALIASES[id] || []).some(a => q.includes(a))) {
      out.push({ key: 'agent:' + id, name: AGENT_NAMES[id], setup: s })
    }
  }
  for (const t of TOOL_REGISTRY) {
    if (!t.setup) continue
    if (q.includes(t.id) || q.includes(t.name.toLowerCase())) {
      out.push({ key: 'tool:' + t.id, name: t.name, setup: t.setup })
    }
  }
  const seen = new Set()
  return out.filter(m => (seen.has(m.key) ? false : seen.add(m.key))).slice(0, 3)
}

const SUGGESTIONS = [
  'How do I get a Claude key?',
  'How do I set up ElevenLabs voice?',
  'Why does Notion say 404?',
  "What's a spend mode?",
]

export default function HelpDrawer({ open, onClose }) {
  useModalDismiss(onClose, { active: open })
  const { settings } = useStore()
  const [messages, setMessages] = useState([]) // {role, content, providers?}
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)
  const sendingRef = useRef(false)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const ask = async (preset) => {
    const q = (preset || input).trim()
    if (!q || sendingRef.current) return
    sendingRef.current = true
    setLoading(true)
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(m => [...m, { role: 'user', content: q }])
    setInput('')
    try {
      const { text, error } = await askHelp({ question: q, history, knowledge: KNOWLEDGE, settings })
      const content = error === 'no_model'
        ? 'I need an AI key to answer questions. Add one in Settings → Agents (Claude, ChatGPT, or Gemini) — the buttons below take you straight there.'
        : error
          ? "Sorry — I couldn't reach the model just now. Try again in a moment."
          : text
      const providers = error === 'no_model'
        ? [{ key: 'agent:claude', name: 'Claude', setup: AGENT_SETUP.claude }]
        : matchProviders(q)
      setMessages(m => [...m, { role: 'assistant', content, providers }])
    } finally {
      setLoading(false)
      sendingRef.current = false
    }
  }

  if (!open) return null
  return (
    <>
      <div className="help-overlay" onClick={onClose} />
      <aside className="help-drawer" role="dialog" aria-modal="true" aria-label="Help">
        <header className="help-head">
          <div className="help-title">Need help?</div>
          <button className="help-close" onClick={onClose} aria-label="Close help">×</button>
        </header>

        <div className="help-body" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="help-empty">
              <p>Ask how to set up a tool, get an API key, or use the studio. I'll point you to the exact buttons.</p>
              <div className="help-suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="help-suggestion" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`help-msg help-msg--${m.role}`}>
              <div className="help-msg-text">{m.content}</div>
              {m.role === 'assistant' && m.providers?.length > 0 && (
                <div className="help-msg-links">
                  {m.providers.map(p => (
                    <div key={p.key} className="help-provider">
                      <div className="help-provider-name">{p.name}</div>
                      <SetupLinks setup={p.setup} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="help-msg help-msg--assistant"><div className="help-typing">thinking…</div></div>}
        </div>

        <div className="help-input-row">
          <input
            className="help-input"
            placeholder="Ask a question…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          />
          <button className="help-send" onClick={() => ask()} disabled={!input.trim() || loading}>Ask</button>
        </div>
      </aside>
    </>
  )
}
