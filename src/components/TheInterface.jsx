import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { useStore } from '../store/useStore'
import { modelsToTry, isModelError } from '../config/models'
import { makeIdleTimeout, isAbort } from '../utils/fetchTimeout'
import { classifyError } from '../utils/errorClassify'
import { buildSystemPrompt } from '../utils/buildSystemPrompt'
import { VoiceEngine } from '../utils/voiceEngine'
import Settings from './Settings'
import HelpDrawer from './HelpDrawer'
import { exportConversation } from '../utils/exportConversation'
import HistorySidebar from './HistorySidebar'
import { orchestrate, getProactiveNotices, processCorrection, ROLE_POOL, shouldAudit, auditResponse, buildRetryReminder, defaultDecision, generateBuildOptions, carryActionSteps } from '../utils/openClaw'
import BuildOptionsTurn from './BuildOptionsTurn'
import OptionsCard from './OptionsCard'
import SuggestedPrompts from './SuggestedPrompts'
import ProjectBriefDetectedCard from './ProjectBriefDetectedCard'
import RoundtableLogo from './RoundtableLogo'
import { suggestPrompts } from '../utils/suggestPrompts'
import { classifyProjectBrief, briefToDescription } from '../utils/classifyProjectBrief'
import { detectSignalsFromUserMessage, logSignals, logAuditFail, getRecentRolePerformance } from '../utils/roleSignals'
import { logUsage, logError, checkTierLimits } from '../utils/telemetry'
import { track } from '../utils/track'
import { saveToCloud, pickProvider, listStorageConnections } from '../utils/cloudStorage'
import { TOOLS_BY_ID, ToolError, readKey, generateImageWithFallback } from '../tools/registry'
import { runBuild } from '../utils/buildExecutor'
import { runAgenticBuild } from '../utils/agenticBuild'
import { brandBriefFrom } from '../utils/brandContext'
import { entitlements, capAgents, capTools, capNudge } from '../utils/entitlements'
import { friendlyError, buildSummary, extractSlideTitles } from '../utils/buildErrors'
import { estimateBuildCents, formatCents } from '../utils/buildCost'
import { ingestFile, formatIngested } from '../utils/fileIngestion'
import { downloadFile } from '../utils/downloadFile'
import { supabase } from '../utils/supabase'
import PromptLibrary from './PromptLibrary'
import ToolOutput from './ToolOutput'
import OnboardingPanel from './OnboardingPanel'
import ProjectPicker from './ProjectPicker'
import MemoryPanel from './MemoryPanel'
import TrialBanner from './TrialBanner'
import ErrorBoundary from './ErrorBoundary'

const AGENTS = [
  { id:"claude",  name:"Claude",  color:"var(--color-agent-claude)", avatar:"C" },
  { id:"gpt",     name:"ChatGPT", color:"var(--color-agent-gpt)",    avatar:"G" },
  { id:"gemini",  name:"Gemini",  color:"var(--color-agent-gemini)", avatar:"X" },
  { id:"grok",    name:"Grok",    color:"var(--color-agent-grok)",   avatar:"GR" },
]

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

// We prefix each agent's message in the shared history with "[Name]: " so the
// other agents can tell who said what. Agents sometimes imitate that format in
// their OWN reply — copying the wrong name (e.g. ChatGPT emitting "[Grok]: ..."),
// or echoing the transcript format at the start of interior lines mid-reply.
// Strip BOTH the leading speaker tag(s) and any line-starting tag throughout the
// text so it never displays or gets saved; the real tag is added separately when
// we push the message into conversationRef.
const SPEAKER_TAG_RE = /^\s*\[[^\]\n]{1,24}\]:[ \t]*/
const LINE_SPEAKER_TAG_RE = /\n[ \t]*\[[^\]\n]{1,24}\]:[ \t]*/g
function stripLeadingSpeakerTag(text) {
  let out = text
  while (SPEAKER_TAG_RE.test(out)) out = out.replace(SPEAKER_TAG_RE, '')
  out = out.replace(LINE_SPEAKER_TAG_RE, '\n')
  return out
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}


// Distill a provider's raw error response into one short diagnostic line for
// the error card: "<model> · <provider's own message>". Providers usually
// return JSON ({error:{message}} for OpenAI/x.ai, {error:{message}} or a bare
// {message}); we dig out the human string and fall back to the raw text.
function buildErrorDetail(status, msg, model) {
  let human = ''
  const raw = (msg == null ? '' : String(msg)).trim()
  if (raw) {
    try {
      const j = JSON.parse(raw)
      human = j?.error?.message || j?.error || j?.message || j?.detail || ''
      if (typeof human !== 'string') human = JSON.stringify(human)
    } catch { human = raw }
  }
  human = human.replace(/\s+/g, ' ').trim().slice(0, 280)
  const parts = []
  if (model) parts.push(model)
  if (status) parts.push(`HTTP ${status}`)
  const head = parts.join(' · ')
  return [head, human].filter(Boolean).join(' — ') || null
}

// POST to a proxy provider route, trying each model in turn. The client owns
// the model id (see src/config/models.js); the worker honors body.model. If a
// model is retired/renamed (model-not-found), we fall back to the next id
// BEFORE any streaming starts — model errors surface on the initial response,
// so retrying here is safe. Returns the first ok Response (body unconsumed),
// or { res, text } for the last failure.
// Transient upstream statuses worth retrying the SAME model: provider capacity
// (503 "high demand"), brief rate spikes (429), and 5xx/overload blips. These
// are momentary — a short wait + retry turns a provider hiccup (e.g. Gemini's
// frequent 503s) into a slight delay instead of a failed turn.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504, 529])
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms))

async function postWithModelFallback(route, provider, buildBody, headers, timeout) {
  const models = modelsToTry(provider)
  const ids = models.length ? models : [undefined]  // fall back to worker default
  let res = null, text = '', model
  for (let i = 0; i < ids.length; i++) {
    model = ids[i]
    // Per-model transient retry (up to 3 attempts) BEFORE streaming starts, so a
    // momentary 503/429/5xx (or a network blip) is retried rather than surfaced
    // as an error. Aborts (hard idle-timeout) propagate immediately.
    for (let attempt = 0; attempt < 3; attempt++) {
      timeout?.bump()  // reset the idle window for each attempt
      try {
        res = await fetch(`${PROXY}/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers, ...(await authHeader()) },
          body: JSON.stringify(buildBody(model)),
          signal: timeout?.signal,
        })
      } catch (e) {
        if (isAbort(e)) throw e   // hard timeout — let the caller handle it
        if (attempt < 2) { await sleepMs(600 * (attempt + 1)); continue }  // network blip → retry
        throw e
      }
      if (res.ok) return { res, text: '', model }
      text = await res.text().catch(() => '')
      // Momentary upstream failure → wait and retry the SAME model.
      if (TRANSIENT_STATUS.has(res.status) && attempt < 2) { await sleepMs(600 * (attempt + 1)); continue }
      break  // non-transient, or out of retries — stop retrying this model
    }
    if (res?.ok) return { res, text: '', model }
    // Only keep trying the NEXT model on a model-not-found; bail otherwise.
    if (!isModelError(res.status, text) || i === ids.length - 1) break
  }
  // `model` is the LAST model tried — the one whose error `text` we return,
  // so the caller can show "which model the provider rejected".
  return { res, text, model }
}

async function streamClaude(key, messages, onChunk, onDone, onError) {
  const t = makeIdleTimeout()
  try {
    const { res, text: errText, model } = await postWithModelFallback('claude', 'claude', (model) => ({ messages, model }), { "x-api-key": key }, t)
    if (!res.ok) { t.clear(); onError?.(res.status, errText, model); onDone(); return }
    const data = await res.json()
    t.clear()
    if (data.error) { onError?.(0, data.error?.message || "Claude error"); onDone(); return }
    const text = data.content?.[0]?.text || ""
    if (!text) { onError?.(0, "Empty response from Claude"); onDone(); return }
    // Claude returns the full text at once; we reveal it progressively for a
    // streaming feel. Emit a small batch of words per tick (not one) so a long
    // answer triggers ~4x fewer store updates / re-renders while still reading
    // as a live type-out.
    const words = text.split(" ")
    let i = 0
    const BATCH = 4
    const iv = setInterval(() => {
      if (i >= words.length) { clearInterval(iv); onDone(); return }
      const chunk = words.slice(i, i + BATCH).join(" ")
      onChunk((i === 0 ? "" : " ") + chunk)
      i += BATCH
    }, 50)
  } catch(e) { t.clear(); onError?.(0, isAbort(e) ? 'timed out — no response for 90s' : e.message); onDone() }
}

async function streamOpenAI(key, messages, onChunk, onDone, onError) {
  const t = makeIdleTimeout()
  try {
    const { res, text: errText, model } = await postWithModelFallback('gpt', 'gpt', (model) => ({ messages, model }), { "Authorization": `Bearer ${key}` }, t)
    if (!res.ok) { t.clear(); onError?.(res.status, errText, model); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      t.bump()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    t.clear()
    onDone()
  } catch(e) { t.clear(); onError?.(0, isAbort(e) ? 'timed out — stream stalled for 90s' : e.message); onDone() }
}

async function streamGemini(key, messages, onChunk, onDone, onError) {
  const t = makeIdleTimeout()
  try {
    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
    const { res, text: errText, model } = await postWithModelFallback('gemini', 'gemini', (model) => ({ contents, model }), { "x-api-key": key }, t)
    if (!res.ok) { t.clear(); onError?.(res.status, errText, model); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      t.bump()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ")) continue
        try {
          const d = JSON.parse(l.slice(6))
          const txt = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (txt) onChunk(txt)
        } catch {}
      }
    }
    t.clear()
    onDone()
  } catch(e) { t.clear(); onError?.(0, isAbort(e) ? 'timed out — stream stalled for 90s' : e.message); onDone() }
}

async function streamGrok(key, messages, onChunk, onDone, onError) {
  const t = makeIdleTimeout()
  try {
    const { res, text: errText, model } = await postWithModelFallback('grok', 'grok', (model) => ({ messages, model }), { "Authorization": `Bearer ${key}` }, t)
    if (!res.ok) { t.clear(); onError?.(res.status, errText, model); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      t.bump()
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    t.clear()
    onDone()
  } catch(e) { t.clear(); onError?.(0, isAbort(e) ? 'timed out — stream stalled for 90s' : e.message); onDone() }
}

// Short human "when" for project-context previews: "today" / "3d ago" / "May 12".
function relativeDate(iso) {
  if (!iso) return ""
  const then = new Date(iso)
  if (isNaN(then)) return ""
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// Smart conversation title via Gemini — the cheapest connected model (the
// proxy's /gemini route is a Flash-tier model, ~$0.0001/title). Reuses the
// existing streamGemini transport and accumulates the (tiny) output. Returns
// "" on any failure so the caller falls back to the heuristic title.
function generateGeminiTitle(key, userText, agentText) {
  const prompt =
    `Write a short, specific title (3-6 words) for this conversation. ` +
    `No quotes, no trailing punctuation, no "Title:" prefix — just the title.\n\n` +
    `User: ${(userText || "").slice(0, 300)}\n` +
    `Assistant: ${(agentText || "").slice(0, 300)}`
  return new Promise((resolve) => {
    let out = ""
    streamGemini(
      key,
      [{ role: "user", content: prompt }],
      (c) => { out += c },
      () => {
        const title = out.split("\n")[0].replace(/^["'\s]+|["'\s.]+$/g, "").slice(0, 60)
        resolve(title)
      },
      () => resolve("")
    )
  })
}

export default function TheInterface() {
  // skills is the per-agent knowledge loaded from Drive at sign-in.
  // We thread it into buildSystemPrompt so every agent call picks up
  // whatever the user has dropped into Drive/Agent Interface/Skills/.
  const { settings, turns, activeAgentId, voiceMode, addTurn, addToolTurn, updateToolTurn, updateBuildTurn, setTurnText, finishTurn, addErrorTurn, addToolErrorTurn, clearTurns, setVoiceMode, saveConversation, saveStatus, conversationId, loadMemory, saveMemory, resetTurnForRetry, activeProject, projects, loadProjects, createProject, setActiveProject, skills, renameConversation, loadProjectConversations, loadConversations, moveConversation, justCreatedConversationId, billing } = useStore()

  // State-aware suggested prompts for the empty / short-conversation state.
  const [suggestions, setSuggestions] = useState([])
  // Project-brief auto-detect state, per conversation. Tracks dismissal so we
  // don't re-prompt, allowing ONE re-offer if a substantially different brief
  // (different name) appears later in the same conversation.
  const briefStateRef = useRef({ dismissed: false, lastName: null, reoffered: false })
  
  // "Voice activates next message" badge shown when toggled ON mid-response.
  const [voiceJustEnabled, setVoiceJustEnabled] = useState(false)
  const voiceBadgeTimer = useRef(null)

  const handleVoiceToggle = () => {
    if (!voiceMode) {
      voiceRef.current = new VoiceEngine(settings)
      // Prime the audio channel INSIDE the click gesture so the browser allows
      // programmatic speech later (autoplay policy: speech must follow a user
      // gesture). A silent utterance opens the channel.
      try {
        const primer = new SpeechSynthesisUtterance(' ')
        primer.volume = 0
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(primer)
      } catch { /* speechSynthesis unavailable — VoiceEngine handles fallback */ }
      // A response in flight can't be retro-played (its gesture window closed),
      // so tell the user voice kicks in on the next message.
      if (activeAgentId) {
        setVoiceJustEnabled(true)
        if (voiceBadgeTimer.current) clearTimeout(voiceBadgeTimer.current)
        voiceBadgeTimer.current = setTimeout(() => setVoiceJustEnabled(false), 10000)
      }
    } else {
      voiceRef.current?.stopSpeaking()
      voiceRef.current?.stopListening()
      setVoiceJustEnabled(false)
      if (voiceBadgeTimer.current) clearTimeout(voiceBadgeTimer.current)
    }
    setVoiceMode(!voiceMode)
  }
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState([])
  const [ingesting, setIngesting] = useState(false)
  const fileInputRef = useRef(null)
  const [targets, setTargets] = useState(["all"])
  const [responseMode, setResponseMode] = useState("concise")
  const [toolsWorking, setToolsWorking] = useState(false)
  const [listening, setListening] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showPrompts, setShowPrompts] = useState(false)
  const [agentMemory, setAgentMemory] = useState([])
  // Load saved memories on mount. Previously agentMemory was only populated when
  // the user opened AND closed the Memory panel, so scopedMemory (threaded into
  // every system prompt) stayed empty all session — "it remembers" was silently
  // inert. Load it up front so memories influence the panel from the first turn.
  useEffect(() => { loadMemory().then(setAgentMemory).catch(() => {}) }, [loadMemory])
  const [projectConvos, setProjectConvos] = useState([])
  const [setupNotices, setSetupNotices] = useState([])
  const [skippedOnboarding, setSkippedOnboarding] = useState(false)
  // First-run wizard latch. Decided ONCE after settings load (billing != null):
  // open it only for a fresh user (no agents, no history). Latched so it stays
  // open across connecting the first agent mid-wizard, instead of unmounting the
  // moment activeAgents flips > 0.
  const [wizardOpen, setWizardOpen] = useState(false)
  const wizardDecidedRef = useRef(false)
  const scrollRef = useRef(null)
  const voiceRef = useRef(null)
  const conversationRef = useRef([])
  // Synchronous re-entrancy guard for sendMessage. `busy` (derived from
  // activeAgentId) only flips true once the first agent turn is added — i.e.
  // AFTER the checkTierLimits/orchestrate awaits — so a second trigger in that
  // window would otherwise slip past the `busy` check and double everything.
  const sendingRef = useRef(false)
  const previousRolesRef = useRef({})
  // Stick the last spend_mode across turns so a frugal brainstorm stays
  // frugal until the user signals otherwise (build it, "use the best", etc).
  const previousSpendModeRef = useRef(null)
  // Show the tier-cap upgrade nudge at most once per session so it never nags.
  const tierNudgeShownRef = useRef(false)

  const activeAgents = useMemo(
    () => AGENTS.filter(a => settings.agents[a.id]?.enabled && settings.agents[a.id]?.key),
    [settings.agents]
  )

  // Decide the first-run wizard ONCE, after settings have loaded (billing flips
  // non-null when loadSettings finishes) so we don't flash it at returning users
  // before their keys load. Open only for a fresh account: no agents, no history.
  useEffect(() => {
    if (wizardDecidedRef.current || billing == null) return
    wizardDecidedRef.current = true
    if (turns.length === 0 && activeAgents.length === 0 && !skippedOnboarding) {
      // Defer out of the effect body so it doesn't count as a synchronous
      // setState-in-effect (avoids the cascading-render lint + an extra pass).
      queueMicrotask(() => setWizardOpen(true))
    }
  }, [billing, turns.length, activeAgents.length, skippedOnboarding])

  // Project-scoped memory: a memory row tagged to a project (project_id) must
  // NOT bleed into a different project's prompts — that's cross-contamination
  // (Project A's facts surfacing in Project B). Rows with no project_id are
  // genuinely global (user-level preferences) and apply everywhere. With no
  // active project, only global rows are in scope. (Rows predate the project_id
  // column → undefined → treated as global, so this is backward-safe.)
  const scopedMemory = useMemo(
    () => agentMemory.filter(m => m.project_id == null || m.project_id === activeProject?.id),
    [agentMemory, activeProject?.id]
  )
  // A tool toggled "on" but missing its API key is effectively unusable — if we
  // hand it to the dispatcher it plans a step that fails at runtime (the Suno
  // problem). Require both the toggle AND a resolvable key before exposing it.
  const enabledTools = useMemo(() => Object.fromEntries(
    Object.entries(settings.tools || {}).filter(([id, v]) => {
      if (!v.enabled) return false
      const tool = TOOLS_BY_ID[id]
      if (!tool) return false
      if (tool.keySource?.startsWith('agent.')) {
        const agentKey = tool.keySource.split('.')[1]
        return !!settings.agents?.[agentKey]?.key
      }
      if (tool.keySource?.startsWith('tool_keys.')) {
        const tk = tool.keySource.split('.')[1]
        return !!settings.toolKeys?.[tk]
      }
      return true  // tools with no keySource (OAuth-based) are always usable
    })
  ), [settings.tools, settings.agents, settings.toolKeys])
  const busy = !!activeAgentId || toolsWorking
  const canSend = !busy && (input.trim() || listening)

  useEffect(() => {
    if (voiceRef.current) {
      voiceRef.current.updateSettings(settings)
    } else {
      voiceRef.current = new VoiceEngine(settings)
    }
  }, [settings])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

  // Autosave the conversation once a response settles (not mid-stream), so it
  // persists to History and stays tagged to the active project. saveConversation
  // stamps the active project_id and reuses conversationId for updates. The
  // activeProject dep re-stamps if the project is switched mid-conversation; the
  // debounce coalesces the burst of turn updates at the end of a multi-agent
  // response into a single write.
  useEffect(() => {
    if (busy || !turns.length) return
    const t = setTimeout(() => saveConversation(turns), 800)
    return () => clearTimeout(t)
  }, [turns, busy, activeProject, saveConversation])

  // Load compact previews of prior conversations in the active project so the
  // panel can reference past discussions. Refreshes when the project switches
  // or a new conversation is created (conversationId), so the list stays current.
  useEffect(() => {
    let cancelled = false
    // loadProjectConversations returns [] for a null projectId, so this also
    // clears the list when no project is active — no synchronous setState needed.
    loadProjectConversations(activeProject?.id).then(d => { if (!cancelled) setProjectConvos(d) })
    return () => { cancelled = true }
  }, [activeProject?.id, conversationId, loadProjectConversations])

  // New conversation → reset the project-brief detection state so a fresh chat
  // can offer to save a brief again.
  useEffect(() => { briefStateRef.current = { dismissed: false, lastName: null, reoffered: false } }, [conversationId])

  // State-aware suggested prompts. Recomputes on sign-in/project switch/new
  // conversation, and when a short conversation goes idle (so the panel can
  // suggest grounded next steps). Skips long/active conversations entirely.
  useEffect(() => {
    let cancelled = false
    const userTurns = turns.filter(t => t.type === 'user').length
    const isEmpty = turns.length === 0
    const idleShort = !busy && userTurns >= 2 && userTurns <= 5
    if (!isEmpty && !idleShort) { setSuggestions([]); return }
    ;(async () => {
      const [recentRaw, storageConnections] = await Promise.all([
        loadConversations().catch(() => []),
        listStorageConnections().catch(() => []),
      ])
      const transcript = isEmpty ? null : turns
        .filter(t => (t.type === 'user' || t.type === 'agent') && t.text)
        .slice(-8)
        .map(t => ({ role: t.type === 'user' ? 'user' : 'assistant', agent: t.agent, text: t.text }))
      const result = await suggestPrompts({
        activeProject,
        recentConversations: (recentRaw || []).slice(0, 10),
        settings, skills, storageConnections,
        activeAgents,
        activeConvoTranscript: transcript,
      })
      if (!cancelled) setSuggestions(result)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, busy, activeProject?.id, conversationId, skills?.loadedAt, activeAgents.length])

  // Smart title: once a conversation is first created, generate a concise title
  // from the opening exchange via the cheapest model (Gemini). One call per
  // conversation — justCreatedConversationId is a one-shot marker we clear after
  // consuming it. No Gemini key → keep the heuristic title (no extra cost).
  useEffect(() => {
    const cid = justCreatedConversationId
    if (!cid) return
    useStore.setState({ justCreatedConversationId: null })
    const key = settings.agents?.gemini?.key
    if (!key) return
    const live = useStore.getState().turns
    const firstUser = live.find(t => t.type === "user")?.text || ""
    const firstAgent = live.find(t => t.type === "agent" && t.text)?.text || ""
    if (!firstUser) return
    generateGeminiTitle(key, firstUser, firstAgent).then(title => {
      if (title) renameConversation(cid, title)
    })
  }, [justCreatedConversationId, settings, renameConversation])

  useEffect(() => {
    const handler = (e) => {
      const { agent, role } = e.detail || {}
      if (agent && role) logAuditFail(agent, role, conversationId)
    }
    window.addEventListener('openclaw:audit_fail', handler)
    return () => window.removeEventListener('openclaw:audit_fail', handler)
  }, [conversationId])

  const handleFiles = async (fileList) => {
    if (!fileList?.length) return
    setIngesting(true)
    for (const file of fileList) {
      const result = await ingestFile(file, settings)
      if (result.ok) {
        setAttachments(prev => [...prev, result])
      } else {
        addErrorTurn('orchestrator', 'attachment_failed')
        logError('ingestFile', new Error(result.error || 'unknown'), { name: file.name, type: file.type })
      }
    }
    setIngesting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (idx) => setAttachments(prev => prev.filter((_, i) => i !== idx))

  const sendMessage = async (overrideText) => {
    const text = (overrideText || input).trim()
    // sendingRef closes the async gap before `busy` turns true. Every exit
    // path below MUST reset it (see the resets before each early return and at
    // the end), otherwise sending locks up permanently.
    if ((!text && attachments.length === 0) || busy || sendingRef.current) return
    // No usable agent (none enabled with a key) — don't silently no-op or fire
    // a doomed orchestrate call. Prompt the user to connect one. Checked before
    // sendingRef/setInput so the typed message is preserved for after they add a key.
    if (activeAgents.length === 0) {
      addErrorTurn("orchestrator", "no_agents")
      return
    }
    sendingRef.current = true
    try {
    if (!overrideText) setInput("")

    // Voice: re-anchor the audio gesture on this fresh user action (a paused
    // synth from a prior turn won't speak otherwise), and clear the
    // "voice next message" hint now that the next message is being sent.
    if (useStore.getState().voiceMode) { try { window.speechSynthesis.resume() } catch { /* no synth */ } }
    if (voiceJustEnabled) {
      setVoiceJustEnabled(false)
      if (voiceBadgeTimer.current) clearTimeout(voiceBadgeTimer.current)
    }

    const limit = await checkTierLimits()
    if (!limit.allowed) {
      addErrorTurn("orchestrator", "free_tier_limit")
      return
    }

    const ingestedPrefix = attachments.map(formatIngested).join('')
    const messageForAgents = ingestedPrefix + (text || 'Discuss the attached file(s).')
    const displayText = text || `[Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'}]`
    const attachedNames = attachments.map(a => a.filename)
    setAttachments([])

    const userTurnId = "u-" + Date.now()
    addTurn({ id: userTurnId, type: "user", text: displayText, attachments: attachedNames })
    conversationRef.current = [...conversationRef.current, { role: "user", content: messageForAgents }]

    const signals = detectSignalsFromUserMessage(text, previousRolesRef.current)
    if (signals.length) logSignals(signals, conversationId)

    // PROJECT-BRIEF AUTO-DETECT: a long message with no active project may be a
    // brand brief. Classify in the background (cheap fast model) so we can offer
    // to remember it as a project. Doesn't block the panel; awaited at the end
    // so the card lands BELOW the panel's response. Skipped once dismissed-and-
    // re-offered for this conversation (see briefStateRef).
    const bs = briefStateRef.current
    const briefPromise = (text.length > 150 && !activeProject && !(bs.dismissed && bs.reoffered))
      ? classifyProjectBrief(text, settings).catch(() => null)
      : null

    const baseSelected = targets.includes("all") ? activeAgents : activeAgents.filter(a => targets.includes(a.id))

    // ── TIER ENFORCEMENT (hard caps by the user's effective plan) ────────
    // How many agents talk at once, how many tools are active, whether memory
    // is available — the real, unbypassable gate (UI lock badges come later).
    // Storage is gated in executeBuild. capTools flips the over-limit tools off
    // so orchestrate + the agent prompts only ever see allowed tools.
    const ent = entitlements(billing)
    const { agents: selected, trimmed: agentsTrimmed } = capAgents(baseSelected, ent)
    const { tools: allowedTools, trimmed: toolsTrimmed } = capTools(enabledTools, ent)
    const allowedMemory = ent.memory ? scopedMemory : []
    const nudge = capNudge({ agentsTrimmed, toolsTrimmed }, ent)
    if (nudge && !tierNudgeShownRef.current) {
      tierNudgeShownRef.current = true
      addTurn({ id: `tier-${Date.now()}`, type: 'notice', kind: 'tier_limit', message: nudge })
    }

    const recentAgentResponses = turns
      .filter(t => t.type === "agent" && t.text)
      .slice(-8)
      .map(t => ({ agent: t.agent, text: t.text }))

    const routingPerformance = await getRecentRolePerformance(90)

    let clawDecision = null
    try {
      clawDecision = await orchestrate({
        userMessage: text,
        conversationHistory: conversationRef.current,
        agentResponses: recentAgentResponses,
        enabledAgents: selected.map(a => a.id),
        enabledTools: allowedTools,
        memory: allowedMemory,
        activeProject,
        previousRoleAssignments: previousRolesRef.current,
        previousSpendMode: previousSpendModeRef.current,
        routingPerformance,
        settings,
        voiceMode,
      })
    } catch(e) {
      // NEVER kill the turn. The orchestrator is a router, not the answer — if it
      // throws (network blip, unexpected error), fall back to a plain discuss
      // round with the selected agents so the user still gets a response instead
      // of a dead end. We log it for telemetry and note it in the decision so the
      // claw card shows "answered directly" rather than masking the degradation.
      logError("orchestrate", e)
      logUsage({ kind: 'orchestrate', provider: 'openclaw', model: 'openclaw', success: false, errorType: 'orchestrator_fallback' })
      clawDecision = {
        ...defaultDecision(selected.map(a => a.id), voiceMode),
        reasoning: "Smart routing was briefly unavailable — answering directly with your agents.",
      }
    }

    // DETERMINISTIC BUILD FAST-PATH. A clear "make/build me a game / app / playable
    // / website" MUST produce a real playable file — not a debate, and not a pile of
    // generated tower images that go nowhere. We do NOT trust the LLM router to
    // classify this: if the message plainly asks to BUILD something interactive,
    // force a webapp build here. executeBuild then routes it to the agentic builder,
    // which writes one self-contained .html via build_webapp.
    const FORCE_WEBAPP = /\b(make|build|create|code|program|develop|design|turn (?:it|this) into|do)\b[^.?!]{0,60}\b(game|web ?app|web ?site|app|playable|tower[ -]?defen[sc]e|arcade|simulator|interactive|html|chart|graph|diagram|flow ?chart|mind ?map|org ?chart|form|survey|quiz|calculator|dashboard|qr ?code)\b/i.test(text)
      || /\b(tower[ -]?defen[sc]e|playable game|html game|mini[- ]?game)\b/i.test(text)
    const FORCE_PODCAST = /\b(make|build|create|record|produce|generate|do|give me)\b[^.?!]{0,40}\b(podcast|audio (?:show|episode|drama)|two[- ]?host)\b/i.test(text)
    // Same deterministic override for finished DOCUMENTS — a deck, spreadsheet, doc,
    // pdf, report. The LLM router under-classifies "make me a deck AND a spreadsheet"
    // as 'discuss': the panel debates, reaches agreement, then asks the user to
    // confirm AGAIN instead of building. An explicit build verb + a concrete document
    // noun = build it. GUARD: a brand-creative deliverable (deck/ad/logo/newsletter)
    // needs brand context, so only force it when the active project carries a brief —
    // otherwise fall through to the normal flow, whose brand-context gate asks for one
    // rather than inventing the brand. Exploratory questions ("should I make a deck?")
    // are excluded so they still get discussed.
    const FORCE_DOC = /\b(make|build|create|write|draft|put together|generate|design|give me)\b[^.?!]{0,80}\b(deck|slides?|powerpoint|presentation|pitch|keynote|spreadsheet|excel|workbook|xlsx|budget|pricing|doc|document|report|one[- ]?pager|whitepaper|memo|proposal|pdf|newsletter)\b/i.test(text)
    const docExploratory = /\b(should (?:i|we)|do you think|is it worth|worth it|how (?:do|should|would) i|what (?:do|should|would) you|help me (?:decide|figure out (?:whether|if)))\b/i.test(text)
    const docBrandCreative = /\b(deck|pitch|slides?|presentation|keynote|ad|advert|landing|newsletter|social|motto|logo|tagline|slogan|brand|campaign)\b/i.test(text)
    const forceDocOk = FORCE_DOC && !docExploratory && (!docBrandCreative || !!brandBriefFrom(activeProject))
    if (FORCE_WEBAPP || FORCE_PODCAST) {
      const nm = (text.replace(/^(ok,?\s*|please\s*|can you\s*|now\s*|so\s*|let'?s\s*)/i, '').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).slice(0, 6).join(' ') || (FORCE_PODCAST ? 'Podcast' : 'App'))
      clawDecision = {
        ...(clawDecision || {}),
        mode: 'build',
        agents_to_respond: [],
        reasoning: FORCE_PODCAST ? 'Recording the podcast directly.' : 'Building a playable app directly.',
        plan: { deliverable: nm, steps: [{ id: 's1', tool: 'agent_synth', needs: [], output_schema: FORCE_PODCAST ? 'document' : 'page', input: text, label: FORCE_PODCAST ? 'Write the podcast' : 'Build the app' }], brandContext: null },
        block: null,
      }
    } else if (forceDocOk) {
      const nm = (text.replace(/^(ok,?\s*|please\s*|can you\s*|now\s*|so\s*|let'?s\s*|what i (?:would|'?d) (?:like|want)(?: you)?(?: to do)?(?: is)?\s*)/i, '').replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/).slice(0, 6).join(' ') || 'Build')
      clawDecision = {
        ...(clawDecision || {}),
        mode: 'build',
        agents_to_respond: [],
        reasoning: 'Building the requested documents directly.',
        plan: { deliverable: nm, steps: [{ id: 's1', tool: 'agent_synth', needs: [], output_schema: 'document', input: text, label: 'Build the documents' }], brandContext: brandBriefFrom(activeProject) || null },
        block: null,
      }
    }

    // BRAND-CONTEXT GATE: the dispatcher refused a brand-facing build because
    // there's no usable brand context. Respond AS the orchestrator asking for a
    // brief — do NOT run agents or a build (either would fabricate the product).
    if (clawDecision?.mode === 'blocked') {
      addTurn({
        id: `notice-${Date.now()}`,
        type: 'notice',
        kind: clawDecision.block?.reason || 'blocked',
        message: clawDecision.block?.message || '',
        canEditProject: !!clawDecision.block?.hasProject,
      })
      logUsage({
        kind: 'orchestrate', provider: 'openclaw', model: 'openclaw', success: true,
        metadata: { mode: 'blocked', reason: clawDecision.block?.reason || 'blocked', is_build: false },
      })
      return
    }

    if (clawDecision?.role_assignments && Object.keys(clawDecision.role_assignments).length) {
      previousRolesRef.current = clawDecision.role_assignments
    }

    // Spend mode: frugal | balanced | premium. Stick across turns so the
    // user doesn't have to repeat "cheap" every message.
    const spendMode = clawDecision?.spend_mode || previousSpendModeRef.current || 'balanced'
    if (clawDecision?.spend_mode) previousSpendModeRef.current = clawDecision.spend_mode
    const isFrugal = spendMode === 'frugal'
    const isPremium = spendMode === 'premium'

    if (clawDecision?.reasoning || clawDecision?.mode) {
      addTurn({
        id: `claw-${Date.now()}`,
        type: "claw",
        mode: clawDecision.mode || "discuss",
        spendMode,
        reasoning: clawDecision.reasoning || "",
        plan: clawDecision.plan || [],
        roleAssignments: clawDecision.role_assignments || {},
      })
    }

    const isBuildMode = clawDecision?.mode === "build"
    const isBuildOptions = clawDecision?.mode === "build_options"
    const respondingAgents = isBuildMode
      ? []
      : isBuildOptions
        // Panel-first: the chosen debaters respond regardless of the user's
        // target chip, so the debate that drives the options always happens.
        ? activeAgents.filter(a => clawDecision.agents_to_respond?.includes(a.id))
        : (clawDecision?.agents_to_respond?.length
          ? selected.filter(a => clawDecision.agents_to_respond.includes(a.id))
          : selected)
    const totalRounds = clawDecision?.rounds || 1
    const activeResponseMode = clawDecision?.response_mode || responseMode

    // Telemetry: log every orchestrate decision so we can see which modes
    // users land on most. Drives future defaults (e.g. if 70% of turns
    // land in frugal, we should make frugal the default).
    logUsage({
      kind: 'orchestrate',
      provider: 'openclaw',
      model: 'openclaw',
      success: true,
      metadata: {
        spend_mode: spendMode,
        mode: clawDecision?.mode || 'discuss',
        agent_count: respondingAgents.length,
        connected_agents: activeAgents.map(a => a.id),
        rounds: totalRounds,
        is_build: isBuildMode,
      },
    })

    if (clawDecision?.correction?.detected && clawDecision?.correction?.save_to_memory) {
      processCorrection(clawDecision, settings, saveMemory)
    }

    for (let round = 0; round < totalRounds; round++) {
      if (round > 0) {
        const roundMsg = round < totalRounds - 1
          ? "Continue the discussion — respond to what the other agents said."
          : "Final round — wrap up your position in 1-2 sentences."
        conversationRef.current = [...conversationRef.current, { role: "user", content: roundMsg }]
      }

      for (const agent of respondingAgents) {
        const id = `${agent.id}-${Date.now()}`
        const role = clawDecision?.role_assignments?.[agent.id] || null
        addTurn({ id, type: "agent", agent: agent.id, role, text: "", directed: !targets.includes("all") })

        const memoryContext = allowedMemory.length > 0
          ? allowedMemory.slice(0, 8).map(m => `[${m.title}]: ${m.content.slice(0, 300)}`).join("\n")
          : ""

        // Compact prior-project context: title + one-line preview + when, for up
        // to 5 other conversations in this project. Deliberately tiny (~one line
        // each) so it never bloats the prompt — previews are pre-capped at 100
        // chars in the DB; we trim a little more here. Current chat is excluded.
        const projectContext = (activeProject && projectConvos.length)
          ? projectConvos
              .filter(c => c.id !== conversationId)
              .slice(0, 5)
              .map(c => `- "${(c.title || "Untitled").slice(0, 60)}" (${relativeDate(c.updated_at)}): ${(c.preview || "").slice(0, 90)}`)
              .join("\n")
          : ""

        // Per-agent skills toggle: when false, this agent's prompt won't
        // include shared/ or its own skill files. Default true so users
        // who haven't touched the setting get the full benefit.
        // Spend mode overrides the per-agent default: frugal skips skills
        // to save tokens, premium forces them on for max quality.
        const userPref = settings.agents[agent.id]?.useSkills !== false
        const agentUseSkills = isFrugal ? false : isPremium ? true : userPref

        const baseSystemPrompt = buildSystemPrompt({
          activeAgentIds: selected.map(a => a.id),
          enabledTools: allowedTools, mode: activeResponseMode, round: round + 1, totalRounds,
          agentId: agent.id, voiceMode, memoryContext, projectContext, role,
          projectName: activeProject?.name || "",
          projectBrief: brandBriefFrom(activeProject),
          skills, useSkills: agentUseSkills,
          buildDebate: isBuildOptions,
        })

        const streamOnce = (systemPrompt) => new Promise((resolve) => {
          const messages = [{ role: "user", content: systemPrompt }, ...conversationRef.current]
          let fullText = ""
          // Strip any leading "[Name]:" the model echoes back so it never
          // reaches the screen; re-sanitize the whole turn each chunk since the
          // tag can straddle a chunk boundary.
          const onChunk = (c) => { fullText += c; setTurnText(id, stripLeadingSpeakerTag(fullText)) }
          const onDone = () => { finishTurn(); resolve({ text: stripLeadingSpeakerTag(fullText), error: null }) }
          const onError = (status, msg, model) => {
            const errorType = classifyError(status, msg)
            // Keep the RAW provider message (e.g. x.ai's "model grok-3 does not
            // exist or you do not have access") so the error card shows WHICH
            // model was rejected — not just a generic "isn't responding".
            const detail = buildErrorDetail(status, msg, model)
            addErrorTurn(agent.id, errorType, detail)
            // Capture the raw status + message snippet so an 'unknown' failure
            // (e.g. the recurring Grok ones) is diagnosable from telemetry —
            // without it Command Center can only report "X% failing", not why.
            logUsage({ kind: "agent_message", provider: agent.id, model: model || agent.id, success: false, errorType, metadata: { status: status ?? null, detail: String(msg || '').slice(0, 300) } })
            resolve({ text: "", error: errorType })
          }
          const key = settings.agents[agent.id]?.key
          if (agent.id === "claude") streamClaude(key, messages, onChunk, onDone, onError)
          else if (agent.id === "gpt") streamOpenAI(key, messages, onChunk, onDone, onError)
          else if (agent.id === "gemini") streamGemini(key, messages, onChunk, onDone, onError)
          else if (agent.id === "grok") streamGrok(key, messages, onChunk, onDone, onError)
        })

        let result = await streamOnce(baseSystemPrompt)
        let auditResult = null
        let retried = false

        // Frugal mode skips the V2 audit pass — auditing means a second
        // round-trip to Claude per off-spec response, which defeats the
        // point of "use the cheapest tokens we can."
        if (!result.error && !isFrugal && shouldAudit(role, voiceMode)) {
          auditResult = await auditResponse({ text: result.text, role, userMessage: text, settings })
          if (!auditResult.passed) {
            const reminder = buildRetryReminder(role, auditResult.reason)
            const hardened = `${baseSystemPrompt}\n\n${reminder}`
            resetTurnForRetry(id)
            const retry = await streamOnce(hardened)
            if (!retry.error) { result = retry; retried = true }
            window.dispatchEvent(new CustomEvent('openclaw:audit_fail', {
              detail: { agent: agent.id, role, reason: auditResult.reason }
            }))
          }
        }

        if (result.text) {
          // Belt-and-suspenders: re-strip any [Name]: tags (leading or
          // line-start) the model echoed, then use the cleaned text for BOTH
          // what we display and what we store. Overwrite the live-streamed turn
          // text so the displayed final matches the stored one exactly.
          const cleanResultText = stripLeadingSpeakerTag(result.text).trim()
          setTurnText(id, cleanResultText)
          // Tag with the speaking agent so a later agent picking up the
          // conversation can tell who said what. Without this prefix the
          // assistant history is a flat blob and Claude can't tell a
          // Gemini opinion from a Grok one.
          conversationRef.current = [...conversationRef.current, { role: "assistant", content: `[${agent.name}]: ${cleanResultText}` }]
          // Thread the V2 audit outcome into telemetry so silent audit outages
          // are visible in analytics (not just console warnings). audit_state:
          //   "not_run"  — role wasn't audited (frugal/voice/non-drift-prone)
          //   "verified" — an audit model actually judged it (auditResult.audited)
          //   "skipped"  — audit was attempted but couldn't run (no model / API
          //                error / unparseable) → failed open, response unverified
          //   "retried"  — the first response failed the audit and we swapped in
          //                a hardened retry. The original fail reason is kept as
          //                audit_reason, but we do NOT emit audit_passed: the text
          //                being logged is the retry, which was not itself audited.
          //   "errored"  — the model errored on this turn (so the audit block was
          //                skipped) yet still produced partial text. Kept distinct
          //                from "not_run" so an audit gap isn't mistaken for a
          //                deliberate frugal/voice skip.
          const auditMeta = result.error
            ? { audit_state: "errored" }
            : !auditResult
            ? { audit_state: "not_run" }
            : retried
              ? { audit_state: "retried", audit_reason: auditResult.reason }
              : auditResult.audited
                ? { audit_state: "verified", audit_passed: auditResult.passed, audit_reason: auditResult.reason }
                : { audit_state: "skipped", audit_reason: auditResult.reason }
          logUsage({
            kind: "agent_message", provider: agent.id, model: agent.id,
            tokensOut: cleanResultText.length / 4 | 0, success: true,
            metadata: { role: role || null, ...auditMeta },
          })
          // Read voiceMode LIVE, not the closure captured at sendMessage start —
          // so a mid-response toggle ON starts speaking this turn's later agents
          // (and a toggle OFF stops them).
          if (useStore.getState().voiceMode && voiceRef.current) {
            // Speak the FULL reply — the engine chunks it for the browser TTS
            // cutoff. (Was sliced to 400 chars, which cut off most of a reply.)
            await new Promise(r => voiceRef.current.speak(cleanResultText, agent.id, r))
          }
        }
      }
    }

    const plan = clawDecision?.plan
    const steps = plan?.steps || []

    // A concrete "build me X" (a finished video, deck, doc, spreadsheet, pdf,
    // post) skips the options debate and goes STRAIGHT to the agentic builder (a
    // real tool-call loop) — that fulfills "tell it what you want and it builds
    // it". The options step was unreliable for finished files (whichever option
    // got picked mis-routed to the static plan executor). Detect from the user's
    // words, or a plan that already includes a document/video generator.
    const _docToolIds = ['pptxgen', 'docgen', 'xlsxgen', 'pdfgen', 'mdgen']
    const wantsDirectBuild = (isBuildMode || isBuildOptions) && (
      /\b(video|promo|mp4|reel|trailer|clip|spot|advert|commercial|deck|slides?|powerpoint|presentation|pitch|keynote|document|report|one[- ]?pager|whitepaper|memo|proposal|spreadsheet|excel|workbook|budget|pdf|blog post|article|newsletter|game|web ?app|web ?site|interactive|playable|arcade|simulator|tower defense|html|podcast|audio show)\b/i.test(text || '') ||
      steps.some(s => _docToolIds.includes(s.tool)) ||
      (steps.some(s => ['dalle', 'stability', 'ideogram', 'flux', 'recraft', 'image_per_slide'].includes(s.tool)) &&
        steps.some(s => ['elevenlabs', 'openai_tts'].includes(s.tool)))
    )

    if (wantsDirectBuild) {
      await executeBuild({ deliverable: plan?.deliverable || 'Build', steps, brandContext: plan?.brandContext || null, request: text })
    } else if (isBuildOptions) {
      // The panel just debated. Turn that debate into 3-4 concrete build
      // options for the user to choose from (the panel is the product — we do
      // NOT auto-build a single answer). On no options, fall back to the base plan.
      const debate = useStore.getState().turns
        .filter(t => t.type === 'agent' && t.text)
        .slice(-(respondingAgents.length * totalRounds))
        .map(t => ({ agent: t.agent, role: t.role, text: t.text }))
      let options = []
      try {
        options = await generateBuildOptions({ userMessage: text, debate, deliverable: plan.deliverable, enabledTools: allowedTools, settings })
      } catch (e) { logError('generateBuildOptions', e) }
      if (options.length) {
        addTurn({ id: `buildopts-${Date.now()}`, type: 'build_options', options, debate, basePlan: clawDecision.base_plan || plan })
      } else if (steps.length > 0) {
        await executeBuild({ deliverable: plan.deliverable, steps, brandContext: plan.brandContext || null, request: text })
      }
    } else if (clawDecision?.mode === 'build' && steps.length > 0) {
      await executeBuild({ deliverable: plan.deliverable, steps, brandContext: plan.brandContext || null })
    }

    // Surface the project-brief offer AFTER the panel responded (awaited here so
    // it appends below the response). High-confidence briefs only; never when a
    // project got set mid-turn, and respecting dismissal / one re-offer rule.
    if (briefPromise) {
      const det = await briefPromise
      const st = briefStateRef.current
      const nm = det?.extracted?.name || ''
      const qualifies = det?.is_project_brief && det.confidence > 0.7 && !useStore.getState().activeProject
      const allowed = !st.dismissed || (!st.reoffered && nm && nm !== st.lastName)
      if (qualifies && allowed) {
        if (st.dismissed) st.reoffered = true
        st.lastName = nm
        addTurn({ id: `brief-${Date.now()}`, type: 'project_brief', extracted: det.extracted })
      }
    }
    } finally {
      sendingRef.current = false
    }
  }

  // Pulled out so the build retry button can call the same path. The
  // retry stores the original plan on the build turn and re-runs it.
  const executeBuild = async (planToRun) => {
    setToolsWorking(true)
    const buildTurnId = `build-${Date.now()}`
    // Real deliverables (deck, doc, spreadsheet, pdf, post, promo video) run
    // through the AGENTIC builder (a real tool-call loop) instead of the static
    // plan executor — far more reliable: the agent writes the real content and
    // fires the FINAL tool that emits the actual file, fulfilling "tell it what
    // you want and it builds it". The agent decides+fires its own tool calls, so
    // it has no pre-listed steps (they stream in as it works). Detect by plan
    // CONTENT (a document/video generator step) OR intent words — the
    // orchestrator's deliverable name alone is too unreliable to depend on.
    const _steps = planToRun.steps || []
    const _docTools = ['pptxgen', 'docgen', 'xlsxgen', 'pdfgen', 'mdgen']
    const _hasImage = _steps.some(s => ['dalle', 'stability', 'ideogram', 'flux', 'recraft', 'image_per_slide'].includes(s.tool))
    const _hasVoice = _steps.some(s => ['elevenlabs', 'openai_tts'].includes(s.tool))
    const _hasDoc = _steps.some(s => _docTools.includes(s.tool))
    const _text = `${planToRun.deliverable || ''} ${planToRun.request || ''}`
    const isVideoBuild =
      /\b(video|promo|mp4|reel|trailer|clip|spot|advert|commercial)\b/i.test(_text) ||
      (_hasImage && _hasVoice && !_hasDoc)
    // The agentic builder owns any build whose deliverable is a finished file.
    const isWebappBuild = /\b(game|web ?app|web ?site|interactive|playable|arcade|simulator|tower defense|calculator|landing page|html|chart|graph|diagram|flow ?chart|mind ?map|org ?chart|form|survey|quiz|dashboard|qr ?code)\b/i.test(_text)
    const isPodcast = /\b(podcast|audio (?:show|episode|drama)|two[- ]?host)\b/i.test(_text)
    const isAgentic = isVideoBuild || isWebappBuild || isPodcast || _hasDoc ||
      /\b(deck|slides?|powerpoint|presentation|pitch|keynote|document|report|one[- ]?pager|brief|whitepaper|memo|letter|proposal|spreadsheet|excel|workbook|budget|pdf|blog post|article|newsletter)\b/i.test(_text)
    const cost = estimateBuildCents(planToRun.steps || [])
    addToolTurn({
      id: buildTurnId,
      type: 'build',
      deliverable: planToRun.deliverable || 'Build',
      steps: isAgentic ? [] : (planToRun.steps || []).map(s => ({ id: s.id, label: s.label, tool: s.tool, status: 'pending' })),
      files: [],
      errors: [],
      plan: planToRun,  // stored so Retry can re-run the same plan
      cost,
    })

    // Resolve storage availability once so the build can keep outputs inline
    // (instead of failing every file step) when no Drive/Dropbox is connected.
    // Cloud storage is a Standard/Pro entitlement — Free builds stay inline.
    const hasStorage = entitlements(billing).storage ? !!(await pickProvider()) : false

    let result
    if (isAgentic) {
      // Agentic builder: steps are added/updated as the agent fires each tool.
      const addOrUpdate = (id, label, status, reason) => updateBuildTurn(buildTurnId, {
        steps: (s) => {
          const arr = s || []
          const i = arr.findIndex(x => x.id === id)
          return i < 0
            ? [...arr, { id, label, tool: id.startsWith('_') ? '' : id, status, reason }]
            : arr.map(x => x.id === id ? { ...x, label: label || x.label, status, reason } : x)
        },
      })
      // Digest of the conversation so the builder can resolve references like
      // "make THIS game" to what was actually discussed (otherwise it asks
      // "which game?" and produces nothing).
      const buildContext = (useStore.getState().turns || [])
        .filter(t => (t.type === 'user' && t.text) || (t.type === 'agent' && t.text))
        .slice(-10)
        .map(t => `${t.type === 'user' ? 'USER' : (t.agent || 'AI')}: ${(t.text || '').replace(/\s+/g, ' ').slice(0, 600)}`)
        .join('\n')
        .slice(-3000)
      try {
        result = await runAgenticBuild(
          { request: planToRun.request || planToRun.deliverable, deliverable: planToRun.deliverable, brandContext: planToRun.brandContext || null, settings, project: activeProject, proxy: proxyFetch, hasStorage, context: buildContext },
          addOrUpdate,
        )
      } catch (e) {
        console.error('[agentic] executeBuild threw:', e?.stack || e)
        logError('runAgenticBuild', e)
        result = { files: [], errors: [{ stepId: '_agent', error: e.message }], folderName: null, folderLink: null, folderProvider: null }
      }
    } else {
      result = await runBuild(
        { ...planToRun, brandContext: planToRun.brandContext || null },
        { settings, project: activeProject, proxy: proxyFetch, hasStorage },
        (stepId, status, reason) => {
          updateBuildTurn(buildTurnId, {
            steps: (s) => (s || []).map(x => x.id === stepId ? { ...x, status, reason } : x),
          })
        }
      )
    }

    updateBuildTurn(buildTurnId, {
      files: result.files,
      errors: result.errors,
      folderName: result.folderName,
      folderLink: result.folderLink,
      folderProvider: result.folderProvider,
    })
    result.files.forEach(f => logUsage({ kind: 'tool_call', provider: f.output?.tool || 'build', model: f.output?.tool || null, success: true, metadata: { stepId: f.stepId } }))
    // Capture WHY a build step failed (tool, classified code, real message) so
    // usage_events is diagnosable — previously this logged only the step id and a
    // generic 'build_step', leaving every failure row's metadata empty.
    result.errors.forEach(e => logUsage({
      kind: 'tool_call',
      provider: e.tool || 'build',
      model: e.tool || null,
      success: false,
      errorType: e.code || 'build_step',
      metadata: { stepId: e.stepId, tool: e.tool || null, code: e.code || null, detail: String(e.error || '').slice(0, 500) },
    }))
    // Surface which build tools get used as a hub feature signal (feeds top_features).
    result.files.forEach(f => track('tool_use', { feature: f.output?.tool || 'build' }))

    setToolsWorking(false)
  }

  // Regenerate ONE component of a finished video build (voiceover / music /
  // image) and re-stitch the MP4 — without rebuilding the whole thing. Re-runs
  // that one tool with its original prompt/script (voiceover also picks up the
  // current Settings → Narrator voice), then re-renders via ad_render with the
  // other pieces unchanged. Works in the live session: the components' data:
  // URLs live in memory and are stripped on reload, so the buttons only show
  // while they're still available.
  const regenerateComponent = async (buildTurnId, kind) => {
    const turn = useStore.getState().turns.find(t => t.id === buildTurnId)
    if (!turn) return
    const files = turn.files || []
    const videoFile = files.find(f => f.output?.type === 'video')
    const comp = (k) => files.find(f => f.output?.regenKind === k)?.output || null
    const imageFiles = files.filter(f => f.output?.regenKind === 'image')
    const voice0 = comp('voiceover'), music0 = comp('music')
    // regenParam (the prompt/script) survives persistence — only the heavy media
    // url is stripped on save/reload — so we can always reconstruct from it.
    if (!videoFile || !imageFiles[0]?.output?.regenParam || !voice0?.regenParam) {
      addToolErrorTurn('regenerate', 'unavailable', "This build can't be revised — rebuild it instead.")
      return
    }
    setToolsWorking(true)
    try {
      // For each piece: keep the inline original if its url is still in memory,
      // else re-make it from its saved prompt. `force` always re-makes (the piece
      // the user asked to redo). This is what lets regen survive a page reload:
      // the "unchanged" pieces are reconstructed from their prompts when their
      // urls were dropped on save. Images are handled as a SET so the slideshow
      // (every scene frame) is preserved, not collapsed to one.
      const ensureImages = async (force) => Promise.all(imageFiles.map(async (f) => {
        const o = f.output
        if (!force && o?.url) return o
        if (!o?.regenParam) return o
        const out = await generateImageWithFallback({ prompt: o.regenParam, structuredInput: { prompt: o.regenParam }, settings, proxy: proxyFetch })
        return { ...out, regenKind: 'image', regenParam: o.regenParam }
      }))
      const ensureVoice = async (force) => {
        if (!force && voice0?.url) return voice0
        const elevenKey = readKey(settings, 'tool_keys.elevenlabs')
        const tool = elevenKey ? TOOLS_BY_ID.elevenlabs : TOOLS_BY_ID.openai_tts
        const key = elevenKey || readKey(settings, 'agent.gpt')
        if (!key) throw new Error('Add an ElevenLabs or OpenAI key to regenerate the voiceover.')
        const out = await tool.run({ prompt: voice0.regenParam, structuredInput: { text: voice0.regenParam }, key, proxy: proxyFetch, settings })
        return { ...out, regenKind: 'voiceover', regenParam: voice0.regenParam }
      }
      const ensureMusic = async (force) => {
        if (!music0) return null
        if (!force && music0?.url) return music0
        const key = readKey(settings, 'tool_keys.stability')
        if (!key) return music0?.url ? music0 : null   // can't re-make without a key
        const prompt = music0.regenParam || 'instrumental backing track, no vocals'
        const out = await TOOLS_BY_ID.stable_audio.run({ prompt, structuredInput: { prompt, duration: music0.regenDuration || 15 }, key, proxy: proxyFetch })
        return { ...out, regenKind: 'music', regenParam: prompt, regenDuration: music0.regenDuration || 15 }
      }
      const newImages = await ensureImages(kind === 'image')
      const images = newImages.filter(o => o?.url)
      const voice = await ensureVoice(kind === 'voiceover')
      const music = await ensureMusic(kind === 'music')
      if (!images.length || !voice?.url) throw new Error("Couldn't prepare the pieces to re-render.")
      const finalOut = await TOOLS_BY_ID.ad_render.run({ structuredInput: { images, voiceover: voice, music: music || null }, label: turn.deliverable, context: { sourceImageUrl: images[0].url } })
      // Re-save the revised cut into the SAME build folder so Drive holds the
      // latest (named "(revised)" so it's distinct from the original). Only if
      // storage is connected + entitled; otherwise it stays inline like before.
      let savedLink = null, driveUrl = null
      const hasStorage = entitlements(billing).storage ? !!(await pickProvider()) : false
      if (hasStorage) {
        const buildProject = activeProject
          ? { ...activeProject, name: `${activeProject.name}/${turn.folderName || turn.deliverable}` }
          : { id: null, name: turn.folderName || turn.deliverable }
        const saved = await saveToCloud({ ...finalOut, displayName: `FINAL — ${turn.deliverable} (revised)` }, buildProject).catch(() => null)
        if (saved) { savedLink = saved.webViewLink || null; driveUrl = saved.webViewLink || null }
      }
      // Swap the regenerated piece(s) + the new (re-saved) video back into the
      // turn. Images map positionally so each frame's new output lands on its row.
      updateBuildTurn(buildTurnId, {
        files: (fs) => { let imgI = 0; return (fs || []).map(f => {
          if (f.output?.type === 'video') return { ...f, output: { ...finalOut, driveUrl: driveUrl || undefined }, savedLink }
          if (f.output?.regenKind === 'voiceover') return { ...f, output: voice }
          if (f.output?.regenKind === 'music' && music) return { ...f, output: music }
          if (f.output?.regenKind === 'image') { const out = newImages[imgI++] || f.output; return { ...f, output: out } }
          return f
        }) },
      })
      track('tool_use', { feature: `regen_${kind}` })
    } catch (e) {
      logError('regenerateComponent', e)
      addToolErrorTurn('regenerate', 'regen_failed', e?.message || 'Regeneration failed.')
    } finally {
      setToolsWorking(false)
    }
  }

  // Stable callback identities for the memoized TurnRow rows. We keep the
  // latest sendMessage/executeBuild in a ref so settled rows don't re-render on
  // every streamed token just because these closures are recreated each render.
  const fnRefs = useRef({})
  // Update the ref after commit (not during render) so the stable callbacks
  // below always invoke the current sendMessage/executeBuild closures.
  useEffect(() => {
    fnRefs.current.sendMessage = sendMessage
    fnRefs.current.executeBuild = executeBuild
    fnRefs.current.regenerateComponent = regenerateComponent
  })
  const onRetryLast = useCallback(() => {
    const ts = useStore.getState().turns
    fnRefs.current.sendMessage(ts.filter(t => t.type === "user").slice(-1)[0]?.text || "")
  }, [])
  const onExecuteBuild = useCallback((plan) => fnRefs.current.executeBuild(plan), [])
  const onRegenerate = useCallback((buildTurnId, kind) => fnRefs.current.regenerateComponent(buildTurnId, kind), [])
  // Build a chosen panel-first option. Feed the debate into the first agent_synth
  // step so it builds FROM the panel's reasoning, not from scratch.
  const onBuildOption = useCallback((option, debate, basePlan) => {
    const steps = option?.plan?.steps || []
    if (!steps.length) return
    const digest = debate?.length
      ? 'PANEL DEBATE (build from this reasoning, do not ignore it):\n' +
        debate.map(d => `${String(d.agent || '').toUpperCase()}${d.role ? ` (${d.role})` : ''}: ${(d.text || '').slice(0, 600)}`).join('\n\n')
      : ''
    const firstSynth = steps.find(s => s.tool === 'agent_synth' && (!s.needs || !s.needs.length))
    let finalSteps = digest && firstSynth
      ? steps.map(s => (s === firstSynth ? { ...s, input: `${digest}\n\nTASK:\n${s.input || ''}` } : s))
      : steps
    // Carry the requested send-action(s) (e.g. "…and email it") from the base
    // plan onto this option — the options regenerate the deliverable only and
    // would otherwise drop the email/SMS step.
    finalSteps = carryActionSteps(finalSteps, basePlan)
    fnRefs.current.executeBuild({ deliverable: option.plan.deliverable, steps: finalSteps, brandContext: null })
  }, [])
  const onBuildSomethingDifferent = useCallback((textVal) => fnRefs.current.sendMessage(textVal), [])
  const onOpenSettings = useCallback(() => setShowSettings(true), [])

  // Suggested-prompt click. Setup cards route to settings; starters just
  // populate the composer (so the user finishes the thought); the rest auto-send.
  const onPickSuggestion = useCallback((s) => {
    if (s.action) { setShowSettings(true); return }
    const text = s.prompt || s.label || ''
    setInput(text)
    if (s.send) { fnRefs.current.sendMessage(text); setInput('') }
    else setTimeout(() => document.querySelector('textarea')?.focus(), 50)
  }, [])

  // Project-brief detected card actions. Stable identities for memoized rows.
  const onSaveBrief = useCallback(async (extracted) => {
    const proj = await createProject(extracted?.name || 'Untitled project', briefToDescription(extracted))
    if (proj) {
      const cid = useStore.getState().conversationId
      if (cid) moveConversation(cid, proj.id)   // setActiveProject already done by createProject
    }
    return proj
  }, [createProject, moveConversation])
  const onDismissBrief = useCallback(() => { briefStateRef.current.dismissed = true }, [])
  const onEditBrief = useCallback((extracted) => {
    window.dispatchEvent(new CustomEvent('openclaw:edit_project', {
      detail: { prefill: { name: extracted?.name || '', description: briefToDescription(extracted) } },
    }))
  }, [])

  const toggleTarget = (id) => {
    if (id === "all") { setTargets(["all"]); return }
    setTargets(prev => {
      const without = prev.filter(t => t !== "all" && t !== id)
      if (prev.includes(id)) return without.length ? without : ["all"]
      return [...without, id]
    })
  }

  const toggleVoiceListening = () => {
    if (!voiceRef.current) return
    if (listening) {
      voiceRef.current.stopListening()
      setListening(false)
      return
    }
    voiceRef.current.startListening(
      (transcript) => {
        setListening(false)
        if (transcript.trim()) sendMessage(transcript)
      },
      (state) => setListening(state === "listening")
    )
  }

  const accent = settings.accent || "var(--color-accent)"

  return (
    <div className="ai-app">
      <header className="ai-header">
        <div className="ai-brand">
          <RoundtableLogo size={28} pulse={false} />
          <h1>Agent Interface</h1>
          <ProjectPicker/>
          {turns.length > 0 && saveStatus !== 'idle' && (
            <span className={`save-status save-status--${saveStatus}`} title={
              saveStatus === 'saving' ? 'Saving conversation…'
              : saveStatus === 'saved' ? 'Conversation saved'
              : 'Could not save — check your connection'
            }>
              {saveStatus === 'saving' && (
                <><span className="save-status-dot" aria-hidden="true"/>Saving…</>
              )}
              {saveStatus === 'saved' && (
                <><svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Saved</>
              )}
              {saveStatus === 'error' && (
                <><span className="save-status-dot" aria-hidden="true"/>Save failed</>
              )}
            </span>
          )}
        </div>
        <nav className="ai-toolbar">
          <IconButton title="Prompt library" onClick={() => setShowPrompts(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2.5C3 2.22386 3.22386 2 3.5 2H12.5C12.7761 2 13 2.22386 13 2.5V13.5C13 13.7761 12.7761 14 12.5 14H3.5C3.22386 14 3 13.7761 3 13.5V2.5Z" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 5.5H10.5M5.5 8H10.5M5.5 10.5H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
          <IconButton title="History" onClick={() => setShowHistory(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.2"/><path d="M8 5V8L10 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
          <IconButton title="Memory" onClick={() => setShowMemory(true)} active={agentMemory.length > 0}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2C5.79086 2 4 3.79086 4 6V7.5C3.17157 7.5 2.5 8.17157 2.5 9V12C2.5 12.8284 3.17157 13.5 4 13.5H12C12.8284 13.5 13.5 12.8284 13.5 12V9C13.5 8.17157 12.8284 7.5 12 7.5V6C12 3.79086 10.2091 2 8 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="6" cy="10.5" r="0.7" fill="currentColor"/>
              <circle cx="8" cy="10.5" r="0.7" fill="currentColor"/>
              <circle cx="10" cy="10.5" r="0.7" fill="currentColor"/>
            </svg>
          </IconButton>
          {turns.length > 0 && (
            <div style={{ position:"relative" }}>
              <IconButton title="Export" expanded={showExport} onClick={() => setShowExport(!showExport)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5V10.5M8 10.5L5 7.5M8 10.5L11 7.5M3 13H13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </IconButton>
              {showExport && (
                <div className="ai-menu">
                  {[["txt","Plain text"],["md","Markdown"],["html","HTML"]].map(([fmt, label]) => (
                    <button key={fmt} className="ai-menu-item" onClick={() => { exportConversation(turns, fmt); setShowExport(false) }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <span className="voice-btn-wrap">
            <IconButton title={voiceMode ? "Voice mode on" : "Voice mode off"} onClick={handleVoiceToggle} active={voiceMode}>
              {voiceMode
                ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 5.5C12.5 6.5 12.5 9.5 11.5 10.5M13 4C14.5 5.5 14.5 10.5 13 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 6L14 8.5M14 6L11.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              }
            </IconButton>
            {voiceJustEnabled && (
              <span className="voice-next-badge" role="status">Voice activates next message</span>
            )}
          </span>
          <IconButton title="Need help?" onClick={() => setShowHelp(true)} active={showHelp}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M6.3 6.2C6.3 5.3 7 4.7 8 4.7C9 4.7 9.7 5.3 9.7 6.1C9.7 7.6 8 7.3 8 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="11.2" r="0.7" fill="currentColor"/></svg>
          </IconButton>
          <IconButton title="Settings" onClick={() => setShowSettings(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </IconButton>
        </nav>
      </header>

      {setupNotices.length > 0 && (
        <div className="ai-notice">
          {setupNotices.slice(0,1).map((n, i) => (
            <div key={i}>
              <span>{n.message}</span>
              <button onClick={() => setSetupNotices([])} aria-label="dismiss">×</button>
            </div>
          ))}
        </div>
      )}

      <TrialBanner onUpgrade={onOpenSettings} />

      <main ref={scrollRef} className="ai-thread">
        {turns.length === 0 && wizardOpen && (
          <OnboardingPanel onSkip={() => { setWizardOpen(false); setSkippedOnboarding(true) }} />
        )}

        {turns.length === 0 && !wizardOpen && (
          <div className="ai-empty">
            <div className="ai-empty-logo"><RoundtableLogo size={48} /></div>
            <h2>One interface. All your AI.</h2>
            <p>{activeAgents.length} agent{activeAgents.length!==1?"s":""} ready · OpenClaw orchestrating</p>
            {activeAgents.length === 0 && (
              <button className="ai-btn" onClick={() => setSkippedOnboarding(false)} style={{ marginTop: "var(--space-4)" }}>
                Connect an agent to start
              </button>
            )}
            <div className="ai-suggestions">
              <SuggestedPrompts suggestions={suggestions} onPick={onPickSuggestion} />
            </div>
          </div>
        )}

        {turns.map(turn => (
          // Per-turn boundary: one malformed turn (bad persisted shape, an
          // unexpected tool-output) degrades to a small card instead of
          // white-screening the whole thread.
          <ErrorBoundary
            key={turn.id}
            scope="turn"
            fallback={
              <div className="ai-turn ai-tool-card">
                <div className="ai-error-title">This message couldn't be displayed</div>
                <div className="ai-error-help">It hit a rendering error and was skipped — the rest of your conversation is fine.</div>
              </div>
            }
          >
            <TurnRow
              turn={turn}
              isActive={activeAgentId === turn.id}
              busy={busy}
              onRetryLast={onRetryLast}
              onExecuteBuild={onExecuteBuild}
              onRegenerate={onRegenerate}
              onBuildOption={onBuildOption}
              onBuildSomethingDifferent={onBuildSomethingDifferent}
              onOpenSettings={onOpenSettings}
              onSaveBrief={onSaveBrief}
              onDismissBrief={onDismissBrief}
              onEditBrief={onEditBrief}
            />
          </ErrorBoundary>
        ))}

        {/* Mid-conversation: grounded next-step suggestions once a short
            conversation goes idle (stage 2 — generated from the transcript). */}
        {turns.length > 0 && !busy && suggestions.length > 0 && (
          <div className="ai-suggestions ai-suggestions--inline">
            <SuggestedPrompts suggestions={suggestions} onPick={onPickSuggestion} title="Where to next" />
          </div>
        )}
      </main>

      <footer className="ai-composer">
        <div className="ai-targets">
          <span className="ai-targets-label">To</span>
          <button
            className={`ai-chip${targets.includes("all") ? " is-active" : ""}`}
            onClick={() => toggleTarget("all")}
          >All</button>
          {activeAgents.map(ag => {
            const sel = !targets.includes("all") && targets.includes(ag.id)
            return (
              <button
                key={ag.id}
                className={`ai-chip${sel ? " is-active" : ""}`}
                onClick={() => toggleTarget(ag.id)}
                style={sel ? { color: ag.color, borderColor: ag.color } : {}}
              >{ag.name}</button>
            )
          })}
          {turns.length > 0 && (
            <button className="ai-chip ai-chip--clear" onClick={() => { clearTurns(); conversationRef.current = []; previousRolesRef.current = {}; previousSpendModeRef.current = null }}>Clear</button>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((a, i) => (
              <span key={i} className={`ai-attachment ai-attachment--${a.kind}`}>
                <span className="ai-attachment-icon">
                  {a.kind === 'pdf' ? '📄' : a.kind === 'image' ? '🖼' : a.kind === 'audio' ? '🎙' : '📝'}
                </span>
                <span className="ai-attachment-name">{a.filename}</span>
                <button className="ai-attachment-remove" onClick={() => removeAttachment(i)} aria-label="Remove">×</button>
              </span>
            ))}
            {ingesting && <span className="ai-attachment ai-attachment--loading">Reading…</span>}
          </div>
        )}
        <div className="ai-input-row">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="text/*,image/*,audio/*,application/pdf,.md,.csv,.json"
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            className="ai-iconbtn ai-iconbtn--lg"
            onClick={() => fileInputRef.current?.click()}
            disabled={ingesting || busy}
            aria-label="Attach file"
            title="Attach file — PDF, image, audio, or text"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M14.5 8L8.5 14C7.4 15.1 5.6 15.1 4.5 14C3.4 12.9 3.4 11.1 4.5 10L10.5 4C11.2 3.3 12.3 3.3 13 4C13.7 4.7 13.7 5.8 13 6.5L7.5 12C7.2 12.3 6.8 12.3 6.5 12C6.2 11.7 6.2 11.3 6.5 11L11 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <textarea
            className="ai-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()} }}
            placeholder={attachments.length > 0 ? `Ask about the ${attachments.length === 1 ? 'attached file' : 'attachments'}…` : (targets.includes("all")?"Message all agents…":activeAgents.filter(a=>targets.includes(a.id)).map(a=>a.name).join(" + ")+"…")}
            rows={1}
          />
          {voiceMode && (
            <button
              className={`ai-iconbtn ai-iconbtn--lg${listening ? " is-listening" : ""}`}
              onClick={toggleVoiceListening}
              aria-label={listening ? "Stop listening" : "Start listening"}
            >
              {listening
                ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" fill="currentColor"/></svg>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="6.5" y="2" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M3.5 8.5C3.5 11.5 6 13.5 9 13.5C12 13.5 14.5 11.5 14.5 8.5M9 13.5V16M6 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              }
            </button>
          )}
          <button
            className="ai-iconbtn ai-iconbtn--lg ai-iconbtn--send"
            onClick={() => sendMessage()}
            disabled={(!input.trim() && attachments.length === 0) || busy || ingesting}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 14V4M9 4L5 8M9 4L13 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="ai-composer-hint">
          Enter to send · {activeAgents.length} agent{activeAgents.length!==1?"s":""} live · say "build it" to trigger tools
        </div>
      </footer>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <HelpDrawer open={showHelp} onClose={() => setShowHelp(false)} />
      {showHistory && <HistorySidebar onClose={() => setShowHistory(false)} accent={accent} />}
      <MemoryPanel
        open={showMemory}
        onClose={() => { setShowMemory(false); loadMemory().then(setAgentMemory) }}
        turns={turns}
        settings={settings}
      />
      {showPrompts && <PromptLibrary accent={accent} onClose={() => setShowPrompts(false)} onUse={(prompt, mode) => { setInput(prompt); if(mode) setResponseMode(mode); setShowPrompts(false); setTimeout(() => document.querySelector("textarea")?.focus(), 100) }}/>}
    </div>
  )
}

const TurnRow = memo(function TurnRow({ turn, isActive, busy, onRetryLast, onExecuteBuild, onRegenerate, onBuildOption, onBuildSomethingDifferent, onOpenSettings, onSaveBrief, onDismissBrief, onEditBrief }) {
          if (turn.type === "user") return (
            <div key={turn.id} className="ai-turn ai-turn--user">
              <div className="ai-user-bubble">{turn.text}</div>
            </div>
          )
          if (turn.type === "claw") {
            const rolePairs = turn.roleAssignments ? Object.entries(turn.roleAssignments) : []
            const spendLabel = turn.spendMode === 'frugal' ? 'lite' : turn.spendMode === 'premium' ? 'premium' : null
            const spendTitle = turn.spendMode === 'frugal'
              ? 'Saving tokens — cheapest agents, skills off, no audit retry'
              : turn.spendMode === 'premium'
              ? 'Max quality — capable agents, skills on, audit retry on'
              : null
            return (
              <div key={turn.id} className="ai-claw">
                <div className="ai-claw-tag-row">
                  <span className={`ai-claw-tag ai-claw-tag--${turn.mode}`}>OpenClaw · {turn.mode}</span>
                  {spendLabel && (
                    <span
                      className={`ai-claw-spend ai-claw-spend--${turn.spendMode}`}
                      title={spendTitle}
                    >
                      {spendLabel}
                    </span>
                  )}
                </div>
                <p className="ai-claw-text">{turn.reasoning}</p>
                {turn.plan?.length > 0 && (
                  <span className="ai-claw-plan">
                    → firing {turn.plan.map(s => s.label || s.tool).join(", ")}
                  </span>
                )}
                {rolePairs.length > 0 && (
                  <div className="ai-claw-roles-section">
                    <span className="ai-claw-roles-label">Panel for this turn</span>
                    <div className="ai-claw-roles">
                      {rolePairs.map(([a, r]) => (
                        <span key={a} className="ai-claw-role-pair">
                          <strong>{a}</strong> <em>as</em> {ROLE_POOL[r]?.name || r}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          }
          if (turn.type === "tool") return (
            <div key={turn.id} className="ai-turn ai-tool-card">
              <div className="ai-tool-label">{turn.output?.tool || "tool"}</div>
              <ToolOutput output={turn.output} />
            </div>
          )
          // Orchestrator notice (not an error) — e.g. a brand-facing build was
          // held for lack of context. Renders as an OpenClaw bubble with the
          // ask; the CTA opens the active project's brief editor.
          if (turn.type === "notice") return (
            <div key={turn.id} className="ai-turn ai-turn--agent">
              <div className="ai-avatar ai-avatar--claw">⚙</div>
              <div className="ai-notice" role="status">
                <div className="ai-notice-title">OpenClaw</div>
                <div className="ai-notice-msg">{turn.message}</div>
                {turn.canEditProject && (
                  <div className="ai-actions">
                    <button className="ai-btn ai-btn--primary"
                      onClick={() => window.dispatchEvent(new CustomEvent('openclaw:edit_project'))}>
                      Add a brand brief
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
          if (turn.type === "project_brief") return (
            <ProjectBriefDetectedCard
              key={turn.id}
              extracted={turn.extracted}
              onSave={onSaveBrief}
              onDismiss={onDismissBrief}
              onEdit={onEditBrief}
            />
          )
          if (turn.type === "build_options") return (
            <BuildOptionsTurn
              key={turn.id}
              options={turn.options}
              onBuild={(opt) => onBuildOption(opt, turn.debate, turn.basePlan)}
              onSomethingDifferent={onBuildSomethingDifferent}
            />
          )
          if (turn.type === "build") {
            const done = turn.steps?.every(s => s.status === 'done' || s.status === 'failed')
            const folderHref = turn.folderLink || turn.files?.find(f => f.savedLink)?.savedLink
            const summary = done ? buildSummary({ deliverable: turn.deliverable, files: turn.files, errors: turn.errors }) : null
            const slideTitles = done ? extractSlideTitles(turn.files) : []
            // Action results (email/sheet/event/payment-link) are surfaced in
            // their own row, not as downloadable files — keep them out of the
            // file count + downloads so an action-only build doesn't claim
            // "1 file generated" with nothing to download.
            const fileItems = (turn.files || []).filter(f => f.output?.type !== 'action')
            return (
              <div key={turn.id} className="ai-turn ai-build-card">
                <div className="ai-build-header">
                  <div className="ai-build-title">📦 {turn.deliverable}</div>
                  {turn.cost && (
                    <div className="ai-build-cost" title="Rough estimate based on each tool's per-call cost. Real billing comes off your API keys.">
                      Est. cost: <strong>{formatCents(turn.cost.totalCents)}</strong>
                      {turn.cost.unknownSteps > 0 && (
                        <span> (+ {turn.cost.unknownSteps} unknown)</span>
                      )}
                    </div>
                  )}
                  {summary && <div className="ai-build-summary">{summary}</div>}
                  {done && turn.folderName && (
                    <div className="ai-build-folder">Saved to: <em>{turn.folderName}</em></div>
                  )}
                </div>
                <ul className="ai-build-steps">
                  {(turn.steps || []).map(s => (
                    <li key={s.id} className={`ai-build-step is-${s.status}`}>
                      <span className="ai-build-step-icon">
                        {s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : s.status === 'started' ? '◐' : '○'}
                      </span>
                      <span className="ai-build-step-label">{s.label}</span>
                      <span className="ai-build-step-tool">{s.tool}</span>
                      {s.status === 'failed' && s.reason && (
                        <span className="ai-build-step-reason">{friendlyError(s.reason)}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {slideTitles.length > 0 && (
                  <div className="ai-build-slides">
                    <div className="ai-build-slides-label">Slides</div>
                    <ol className="ai-build-slides-list">
                      {slideTitles.map((t, i) => <li key={i}>{t}</li>)}
                    </ol>
                  </div>
                )}
                {done && turn.files?.some(f => f.output?.text) && (
                  <div className="ai-build-text">
                    {turn.files.filter(f => f.output?.text).map(f => (
                      <div key={f.stepId} className="ai-build-text-block">
                        <div className="ai-build-text-label">{f.label}</div>
                        <pre className="ai-build-text-body">{f.output.text}</pre>
                      </div>
                    ))}
                  </div>
                )}
                {/* Action results (sheet/event/payment-link/notion/email/SMS sent)
                    carry a summary + optional link but no downloadable file — show
                    them as a confirmation row with the link, or the build looks
                    empty ("done" with nothing to click). */}
                {done && turn.files?.some(f => f.output?.type === 'action') && (
                  <div className="ai-build-action-results">
                    {turn.files.filter(f => f.output?.type === 'action').map(f => (
                      <div key={f.stepId} className="ai-build-action-row">
                        <span className="ai-build-action-summary">✓ {f.output.summary || f.label}</span>
                        {f.output.link && (
                          <a className="ai-build-action-link" href={f.output.link} target="_blank" rel="noreferrer">Open ↗</a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Inline previews — play/show the finished media right in the
                    chat instead of only a download link. Only when the url is
                    present (live session); after reload heavy data: URLs are
                    stripped, so the folder/download links below carry it. */}
                {done && fileItems.some(f => (['video', 'image', 'audio'].includes(f.output?.type) && f.output?.url) || (f.output?.type === 'webapp' && (f.output?.html || f.output?.url))) && (
                  <div className="ai-build-previews">
                    {fileItems
                      .filter(f => (['video', 'image', 'audio'].includes(f.output?.type) && f.output?.url) || (f.output?.type === 'webapp' && (f.output?.html || f.output?.url)))
                      .map(f => (
                        <ToolOutput key={`preview-${f.stepId}`} output={f.savedLink ? { ...f.output, driveUrl: f.savedLink } : f.output} />
                      ))}
                  </div>
                )}
                {/* Component-level regen: redo one piece + re-stitch, no full
                    rebuild. Only for a finished video whose pieces are still in
                    memory (cleared on reload). Voiceover redo picks up the
                    current Settings → Narrator voice. */}
                {done && turn.files?.some(f => f.output?.type === 'video') && (() => {
                  const has = (k) => turn.files?.some(f => f.output?.regenKind === k && f.output?.regenParam)
                  const btns = [
                    has('voiceover') && { k: 'voiceover', label: 'voiceover', hint: 'Re-records the voiceover — set a different voice in Settings → Narrator voice first' },
                    has('music') && { k: 'music', label: 'music', hint: 'Generates a fresh backing track' },
                    has('image') && { k: 'image', label: 'visuals', hint: 'Regenerates the scene image(s)' },
                  ].filter(Boolean)
                  if (!btns.length) return null
                  return (
                    <div className="ai-build-regen" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 8px' }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>Tweak one piece:</span>
                      {btns.map(b => (
                        <button key={b.k} type="button" disabled={busy} title={b.hint}
                          onClick={() => onRegenerate?.(turn.id, b.k)}
                          style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>
                          ↻ Redo {b.label}
                        </button>
                      ))}
                    </div>
                  )
                })()}
                {done && fileItems.length > 0 && (
                  <div className="ai-build-files">
                    <span>{fileItems.length} file{fileItems.length === 1 ? '' : 's'} {folderHref ? 'bundled' : 'generated'}</span>
                    {folderHref ? (
                      // Cloud-saved: link EACH finished deliverable (deck, spreadsheet)
                      // directly in the chat, not just the bundle folder — otherwise
                      // the user has to dig through the folder to open what they asked
                      // for. Each saved file carries its own webViewLink (f.savedLink).
                      <div className="ai-build-downloads">
                        {fileItems.filter(f => !f.component && (f.savedLink || f.output?.url)).map(f => (
                          <a key={f.stepId} className="ai-build-download"
                             href={f.savedLink || f.output.url} target="_blank" rel="noreferrer">
                            {(f.label || 'File').replace(/^FINAL — /, '')} ↗
                          </a>
                        ))}
                        <a className="ai-build-folder-link" href={folderHref} target="_blank" rel="noreferrer">
                          Open folder ↗
                        </a>
                      </div>
                    ) : (
                      <>
                        <div className="ai-build-downloads">
                          {fileItems.flatMap(f => {
                            const out = f.output
                            // Bundle output — one download per child file.
                            if (Array.isArray(out?.files)) {
                              return out.files
                                .filter(c => c?.url && !c.error)
                                .map((c, i) => (
                                  <a key={`${f.stepId}-${i}`} href={c.url} download={c.filename || undefined}
                                     onClick={e => { e.preventDefault(); downloadFile(c.url, c.filename) }}
                                     className="ai-build-download">{c.filename || `${f.label} ${i + 1}`} ↓</a>
                                ))
                            }
                            // Single-file output.
                            if (out?.url) {
                              return [
                                <a key={f.stepId} href={out.url} download={out.filename || undefined}
                                   onClick={e => { e.preventDefault(); downloadFile(out.url, out.filename) }}
                                   className="ai-build-download">{f.label} ↓</a>,
                              ]
                            }
                            return []
                          })}
                        </div>
                        <div className="ai-build-unsaved-note">
                          Not saved to cloud — connect Drive or Dropbox in Settings → Storage to keep these.
                        </div>
                      </>
                    )}
                  </div>
                )}
                {done && turn.plan && turn.errors?.length > 0 && (
                  <div className="ai-build-actions">
                    <OptionsCard
                      keyboard={false}
                      title="Some steps failed — what next?"
                      options={[
                        { title: 'Retry exactly', description: 'Re-run the same plan' },
                        { title: 'Try smaller scope', description: 'Just the writing — skip the heavy generators' },
                        { title: 'Leave it', description: 'Keep what succeeded' },
                      ]}
                      onSelect={(_, i) => {
                        if (i === 0) onExecuteBuild(turn.plan)
                        else if (i === 1) {
                          const synth = (turn.plan.steps || []).filter(s => s.tool === 'agent_synth')
                          onExecuteBuild({ ...turn.plan, steps: synth.length ? synth : (turn.plan.steps || []).slice(0, 1) })
                        }
                      }}
                    />
                  </div>
                )}
                {done && turn.plan && !turn.errors?.length && turn.files?.length > 0 && (
                  <div className="ai-build-actions">
                    <button className="ai-btn ai-btn--small" onClick={() => onExecuteBuild(turn.plan)} disabled={busy} title="Re-run this build">↻ Rebuild</button>
                  </div>
                )}
              </div>
            )
          }
          if (turn.type === "error") {
            const agent = AGENTS.find(a => a.id === turn.agent)
            const isOrchestrator = turn.agent === "orchestrator"
            const label = isOrchestrator ? "OpenClaw" : agent?.name
            const message = (
              turn.errorType === "rate_limited" ? `${label} hit its rate limit. Wait a moment and retry.` :
              turn.errorType === "quota_exceeded" ? `Your ${label} quota is used up — a free-tier or plan limit has been reached, so retrying now won't help. Add billing to your ${label} account, switch to another agent, or wait for the quota to reset.` :
              turn.errorType === "out_of_credits" ? `Your ${label} account is out of credits.` :
              turn.errorType === "invalid_key" ? `Your ${label} API key isn't working — it may have expired.` :
              turn.errorType === "model_unavailable" ? `${label}'s model is currently unavailable — it may have been retired, or your account doesn't have access. Try a different agent, or check that your ${label} plan includes it.` :
              turn.errorType === "service_down" ? `${label} is having a service issue. Try again in a moment.` :
              turn.errorType === "network" ? `Couldn't reach ${label}. Check your connection and retry.` :
              turn.errorType === "orchestrator_down" ? `OpenClaw couldn't process this message. Retry, or verify your agent keys.` :
              turn.errorType === "free_tier_limit" ? `You've reached the free-tier daily limit. Upgrade to Pro for unlimited messages.` :
              turn.errorType === "no_agents" ? `No AI agents are connected yet. Add a provider API key (Claude, GPT, Gemini, or Grok) in Settings, then send your message again.` :
              turn.errorType === "attachment_failed" ? `Couldn't read that attachment. Try a different file (PDF, image, or text), or remove it and send again.` :
              `${label} returned an unexpected error. Retry, or check Settings.`
            )
            const billingUrl = agent?.id==="claude"?"https://console.anthropic.com":agent?.id==="gpt"?"https://platform.openai.com/account/billing":agent?.id==="gemini"?"https://aistudio.google.com/app/plan":"https://console.x.ai"
            return (
              <div key={turn.id} className="ai-turn ai-turn--agent">
                {agent
                  ? <div className="ai-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
                  : <div className="ai-avatar ai-avatar--error">!</div>
                }
                <div className="ai-error" role="alert">
                  <div className="ai-error-title">{turn.errorType === "no_agents" ? "Connect an agent to get started" : `${label} isn't responding`}</div>
                  <div className="ai-error-msg">{message}</div>
                  {turn.detail && (
                    <details className="ai-error-detail">
                      <summary>Technical details</summary>
                      <code>{turn.detail}</code>
                    </details>
                  )}
                  <div className="ai-actions">
                    {turn.errorType === "no_agents"
                      ? <button className="ai-btn ai-btn--primary" onClick={onOpenSettings}>Add a key</button>
                      : turn.errorType === "quota_exceeded"
                      ? <button className="ai-btn ai-btn--primary" onClick={onOpenSettings}>Switch agent</button>
                      : <button className="ai-btn ai-btn--primary" onClick={onRetryLast}>Retry</button>}
                    {turn.errorType === "out_of_credits" && agent && (
                      <a className="ai-btn" href={billingUrl} target="_blank" rel="noreferrer">Add credits</a>
                    )}
                    {turn.errorType === "quota_exceeded" && agent && (
                      <a className="ai-btn" href={billingUrl} target="_blank" rel="noreferrer">Add billing</a>
                    )}
                    {turn.errorType === "invalid_key" && (
                      <button className="ai-btn" onClick={onOpenSettings}>Fix key</button>
                    )}
                    {turn.errorType === "model_unavailable" && (
                      <button className="ai-btn" onClick={onOpenSettings}>Switch agent</button>
                    )}
                    {turn.errorType === "free_tier_limit" && (
                      <button className="ai-btn ai-btn--primary" onClick={onOpenSettings}>Upgrade</button>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          if (turn.type === "tool_error") return (
            <div key={turn.id} className="ai-tool-error" role="alert">
              <div className="ai-tool-error-title">{turn.tool} failed</div>
              <div className="ai-tool-error-msg">{turn.message}</div>
              {turn.errorType === "missing_key" && (
                <button className="ai-btn" onClick={onOpenSettings}>Open settings</button>
              )}
            </div>
          )
          const agent = AGENTS.find(a => a.id === turn.agent)
          if (!agent) return null
          const roleDef = turn.role && ROLE_POOL[turn.role]
          return (
            <div key={turn.id} className="ai-turn ai-turn--agent">
              <div className="ai-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
              <div className="ai-agent-msg">
                <div className="ai-agent-name" style={{ color: agent.color }}>
                  {agent.name}
                  {roleDef && <span className="ai-agent-role" style={{ borderColor: agent.color, color: agent.color }}>{roleDef.name}</span>}
                  {turn.reRolled && <span className="ai-agent-rerolled" title="OpenClaw asked this agent to retry — first response was off-role">↻ re-rolled</span>}
                </div>
                <div className={`ai-agent-text${isActive ? " is-streaming" : ""}`} aria-live={isActive ? "polite" : undefined}>
                  {turn.text || (isActive ? <span className="ai-typing">thinking…</span> : "")}
                </div>
              </div>
            </div>
          )
})

function IconButton({ children, onClick, title, active, expanded }) {
  return (
    <button
      type="button"
      className={`ai-iconbtn${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-haspopup={expanded !== undefined ? "menu" : undefined}
      aria-expanded={expanded}
    >
      {children}
    </button>
  )
}

async function proxyFetch(path, body, extraHeaders = {}) {
  // Shared by every registry tool AND the agentic builder. Without a timeout a
  // hung upstream left the tool/build promise pending forever — the exact hang
  // class fetchTimeout.js exists to kill, but this path skipped it. Some worker
  // routes poll synchronously for up to ~200s (runway/shotstack/heygen) and
  // return one JSON at the end, so this is a generous 240s total ceiling (not the
  // 90s idle window the streaming agent calls use) — long enough for any real
  // poll, short enough that a true hang surfaces as an error.
  const t = makeIdleTimeout(240_000)
  try {
    return await fetch(`${PROXY}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()), ...extraHeaders },
      body: JSON.stringify(body),
      signal: t.signal,
    })
  } catch (e) {
    if (isAbort(e)) throw new Error(`${path} timed out — no response in 240s`)
    throw e
  } finally {
    t.clear()
  }
}

/**
 * Registry-driven tool dispatch. Every tool lives in src/tools/registry.js
 * with the same {id, keySource, run({prompt, key, settings, proxy, context})}
 * shape — adding a new provider is one entry in that file.
 */
async function runTool(toolId, prompt, settings, context = {}) {
  const tool = TOOLS_BY_ID[toolId]
  if (!tool) {
    throw new ToolError(toolId, 'not_implemented', `The ${toolId} tool isn't available yet.`)
  }
  if (typeof tool.run !== 'function') {
    throw new ToolError(toolId, 'not_implemented', `${tool.name} doesn't have a runner yet.`)
  }
  const key = readKey(settings, tool.keySource)
  return tool.run({ prompt, key, settings, proxy: proxyFetch, context })
}
