import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { buildSystemPrompt } from '../utils/buildSystemPrompt'
import { VoiceEngine } from '../utils/voiceEngine'
import Settings from './Settings'
import HelpDrawer from './HelpDrawer'
import { exportConversation } from '../utils/exportConversation'
import HistorySidebar from './HistorySidebar'
import { orchestrate, getProactiveNotices, processCorrection, ROLE_POOL, shouldAudit, auditResponse, buildRetryReminder } from '../utils/openClaw'
import { detectSignalsFromUserMessage, logSignals, logAuditFail, getRecentRolePerformance } from '../utils/roleSignals'
import { logUsage, logError, checkTierLimits } from '../utils/telemetry'
import { track } from '../utils/track'
import { saveToCloud } from '../utils/cloudStorage'
import { TOOLS_BY_ID, ToolError, readKey } from '../tools/registry'
import { runBuild } from '../utils/buildExecutor'
import { friendlyError, buildSummary, extractSlideTitles } from '../utils/buildErrors'
import { estimateBuildCents, formatCents } from '../utils/buildCost'
import { ingestFile, formatIngested } from '../utils/fileIngestion'
import { supabase } from '../utils/supabase'
import PromptLibrary from './PromptLibrary'
import ToolOutput from './ToolOutput'
import OnboardingPanel from './OnboardingPanel'
import ProjectPicker from './ProjectPicker'
import MemoryPanel from './MemoryPanel'

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

function classifyError(status, text) {
  if (status === 401 || status === 403) return "invalid_key"
  if (status === 429) return "rate_limited"
  if (status === 402) return "out_of_credits"
  if (status >= 500) return "service_down"
  if (status === 0) return "network"
  return "unknown"
}

async function streamClaude(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const data = await res.json()
    if (data.error) { onError?.(0, data.error?.message || "Claude error"); onDone(); return }
    const text = data.content?.[0]?.text || ""
    if (!text) { onError?.(0, "Empty response from Claude"); onDone(); return }
    const words = text.split(" ")
    let i = 0
    const iv = setInterval(() => {
      if (i >= words.length) { clearInterval(iv); onDone(); return }
      onChunk((i === 0 ? "" : " ") + words[i])
      i++
    }, 40)
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamOpenAI(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/gpt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamGemini(key, messages, onChunk, onDone, onError) {
  try {
    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
    const res = await fetch(`${PROXY}/gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, ...(await authHeader()) },
      body: JSON.stringify({ contents }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ")) continue
        try {
          const d = JSON.parse(l.slice(6))
          const t = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (t) onChunk(t)
        } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
}

async function streamGrok(key, messages, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${PROXY}/grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...(await authHeader()) },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) { const t = await res.text(); onError?.(res.status, t); onDone(); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const l of lines) {
        if (!l.startsWith("data: ") || l.includes("[DONE]")) continue
        try { const d = JSON.parse(l.slice(6)); const c = d.choices?.[0]?.delta?.content; if (c) onChunk(c) } catch {}
      }
    }
    onDone()
  } catch(e) { onError?.(0, e.message); onDone() }
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
  const { settings, turns, activeAgentId, voiceMode, addTurn, addToolTurn, updateToolTurn, updateBuildTurn, setTurnText, finishTurn, addErrorTurn, addToolErrorTurn, clearTurns, setVoiceMode, saveConversation, saveStatus, conversationId, loadMemory, saveMemory, resetTurnForRetry, activeProject, projects, loadProjects, createProject, setActiveProject, skills, renameConversation, loadProjectConversations, justCreatedConversationId } = useStore()
  
  const handleVoiceToggle = () => {
    if (!voiceMode) {
      voiceRef.current = new VoiceEngine(settings)
    } else {
      voiceRef.current?.stopSpeaking()
      voiceRef.current?.stopListening()
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
  const [projectConvos, setProjectConvos] = useState([])
  const [setupNotices, setSetupNotices] = useState([])
  const [skippedOnboarding, setSkippedOnboarding] = useState(false)
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

  const activeAgents = AGENTS.filter(a => settings.agents[a.id]?.enabled && settings.agents[a.id]?.key)
  // A tool toggled "on" but missing its API key is effectively unusable — if we
  // hand it to the dispatcher it plans a step that fails at runtime (the Suno
  // problem). Require both the toggle AND a resolvable key before exposing it.
  const enabledTools = Object.fromEntries(
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
  )
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
    sendingRef.current = true
    try {
    if (!overrideText) setInput("")

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

    const selected = targets.includes("all") ? activeAgents : activeAgents.filter(a => targets.includes(a.id))

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
        enabledTools,
        memory: agentMemory,
        activeProject,
        previousRoleAssignments: previousRolesRef.current,
        previousSpendMode: previousSpendModeRef.current,
        routingPerformance,
        settings,
        voiceMode,
      })
    } catch(e) {
      logError("orchestrate", e)
      addErrorTurn("orchestrator", "orchestrator_down")
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
    const respondingAgents = isBuildMode
      ? []
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

        const memoryContext = agentMemory.length > 0
          ? agentMemory.slice(0, 8).map(m => `[${m.title}]: ${m.content.slice(0, 300)}`).join("\n")
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
          enabledTools, mode: activeResponseMode, round: round + 1, totalRounds,
          agentId: agent.id, voiceMode, memoryContext, projectContext, role,
          skills, useSkills: agentUseSkills,
        })

        const streamOnce = (systemPrompt) => new Promise((resolve) => {
          const messages = [{ role: "user", content: systemPrompt }, ...conversationRef.current]
          let fullText = ""
          // Strip any leading "[Name]:" the model echoes back so it never
          // reaches the screen; re-sanitize the whole turn each chunk since the
          // tag can straddle a chunk boundary.
          const onChunk = (c) => { fullText += c; setTurnText(id, stripLeadingSpeakerTag(fullText)) }
          const onDone = () => { finishTurn(); resolve({ text: stripLeadingSpeakerTag(fullText), error: null }) }
          const onError = (status, msg) => {
            const errorType = classifyError(status, msg)
            addErrorTurn(agent.id, errorType)
            logUsage({ kind: "agent_message", provider: agent.id, model: agent.id, success: false, errorType })
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
          if (voiceMode && voiceRef.current) {
            await new Promise(r => voiceRef.current.speak(cleanResultText.slice(0, 400), agent.id, r))
          }
        }
      }
    }

    const plan = clawDecision?.plan
    const steps = plan?.steps || []
    if (steps.length > 0) {
      await executeBuild({ deliverable: plan.deliverable, steps })
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
    const cost = estimateBuildCents(planToRun.steps)
    addToolTurn({
      id: buildTurnId,
      type: 'build',
      deliverable: planToRun.deliverable || 'Build',
      steps: planToRun.steps.map(s => ({ id: s.id, label: s.label, tool: s.tool, status: 'pending' })),
      files: [],
      errors: [],
      plan: planToRun,  // stored so Retry can re-run the same plan
      cost,
    })

    const result = await runBuild(
      planToRun,
      { settings, project: activeProject, proxy: proxyFetch },
      (stepId, status, reason) => {
        updateBuildTurn(buildTurnId, {
          steps: (s) => (s || []).map(x => x.id === stepId ? { ...x, status, reason } : x),
        })
      }
    )

    updateBuildTurn(buildTurnId, {
      files: result.files,
      errors: result.errors,
      folderName: result.folderName,
      folderLink: result.folderLink,
      folderProvider: result.folderProvider,
    })
    result.files.forEach(f => logUsage({ kind: 'tool_call', provider: f.output?.tool || 'build', success: true }))
    result.errors.forEach(e => logUsage({ kind: 'tool_call', provider: e.stepId, success: false, errorType: 'build_step' }))
    // Surface which build tools get used as a hub feature signal (feeds top_features).
    result.files.forEach(f => track('tool_use', { feature: f.output?.tool || 'build' }))

    setToolsWorking(false)
  }

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
          <Logo/>
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
              <IconButton title="Export" onClick={() => setShowExport(!showExport)}>
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
          <IconButton title={voiceMode ? "Voice mode on" : "Voice mode off"} onClick={handleVoiceToggle} active={voiceMode}>
            {voiceMode
              ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 5.5C12.5 6.5 12.5 9.5 11.5 10.5M13 4C14.5 5.5 14.5 10.5 13 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3L5.5 5.5H3V10.5H5.5L9 13V3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M11.5 6L14 8.5M14 6L11.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            }
          </IconButton>
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

      <main ref={scrollRef} className="ai-thread">
        {turns.length === 0 && activeAgents.length === 0 && !skippedOnboarding && (
          <OnboardingPanel onSkip={() => setSkippedOnboarding(true)} />
        )}

        {turns.length === 0 && (activeAgents.length > 0 || skippedOnboarding) && (
          <div className="ai-empty">
            <div className="ai-empty-logo"><Logo size={48}/></div>
            <h2>One interface. All your AI.</h2>
            <p>{activeAgents.length} agent{activeAgents.length!==1?"s":""} ready · OpenClaw orchestrating</p>
            {activeAgents.length === 0 && (
              <button className="ai-btn" onClick={() => setSkippedOnboarding(false)} style={{ marginTop: "var(--space-4)" }}>
                Connect an agent to start
              </button>
            )}
            <div className="ai-suggestions">
              {[
                "Help me brainstorm features",
                "Debate the best approach to this",
                "Plan a 30 second ad",
                "What are you all good at?",
              ].map(q => (
                <button key={q} onClick={() => setInput(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {turns.map(turn => {
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
          if (turn.type === "build") {
            const done = turn.steps?.every(s => s.status === 'done' || s.status === 'failed')
            const folderHref = turn.folderLink || turn.files?.find(f => f.savedLink)?.savedLink
            const summary = done ? buildSummary({ deliverable: turn.deliverable, files: turn.files, errors: turn.errors }) : null
            const slideTitles = done ? extractSlideTitles(turn.files) : []
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
                {done && turn.files?.length > 0 && (
                  <div className="ai-build-files">
                    <span>{turn.files.length} file{turn.files.length === 1 ? '' : 's'} bundled</span>
                    {folderHref && (
                      <a className="ai-build-folder-link" href={folderHref} target="_blank" rel="noreferrer">
                        Open folder ↗
                      </a>
                    )}
                  </div>
                )}
                {done && turn.plan && (turn.errors?.length > 0 || turn.files?.length > 0) && (
                  <div className="ai-build-actions">
                    <button
                      className="ai-btn ai-btn--small"
                      onClick={() => executeBuild(turn.plan)}
                      disabled={busy}
                      title="Re-run this exact build plan"
                    >
                      ↻ Retry build
                    </button>
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
              turn.errorType === "out_of_credits" ? `Your ${label} account is out of credits.` :
              turn.errorType === "invalid_key" ? `Your ${label} API key isn't working — it may have expired.` :
              turn.errorType === "service_down" ? `${label} is having a service issue. Try again in a moment.` :
              turn.errorType === "network" ? `Couldn't reach ${label}. Check your connection and retry.` :
              turn.errorType === "orchestrator_down" ? `OpenClaw couldn't process this message. Retry, or verify your agent keys.` :
              turn.errorType === "free_tier_limit" ? `You've reached the free-tier daily limit. Upgrade to Pro for unlimited messages.` :
              `${label} returned an unexpected error. Retry, or check Settings.`
            )
            const billingUrl = agent?.id==="claude"?"https://console.anthropic.com":agent?.id==="gpt"?"https://platform.openai.com/account/billing":agent?.id==="gemini"?"https://aistudio.google.com/app/plan":"https://console.x.ai"
            return (
              <div key={turn.id} className="ai-turn ai-turn--agent">
                {agent
                  ? <div className="ai-avatar" style={{ color: agent.color, borderColor: agent.color }}>{agent.avatar}</div>
                  : <div className="ai-avatar ai-avatar--error">!</div>
                }
                <div className="ai-error">
                  <div className="ai-error-title">{label} isn't responding</div>
                  <div className="ai-error-msg">{message}</div>
                  <div className="ai-actions">
                    <button className="ai-btn ai-btn--primary" onClick={() => sendMessage(turns.filter(t=>t.type==="user").slice(-1)[0]?.text||"")}>Retry</button>
                    {turn.errorType === "out_of_credits" && agent && (
                      <a className="ai-btn" href={billingUrl} target="_blank" rel="noreferrer">Add credits</a>
                    )}
                    {turn.errorType === "invalid_key" && (
                      <button className="ai-btn" onClick={() => setShowSettings(true)}>Fix key</button>
                    )}
                    {turn.errorType === "free_tier_limit" && (
                      <button className="ai-btn ai-btn--primary" onClick={() => setShowSettings(true)}>Upgrade</button>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          if (turn.type === "tool_error") return (
            <div key={turn.id} className="ai-tool-error">
              <div className="ai-tool-error-title">{turn.tool} failed</div>
              <div className="ai-tool-error-msg">{turn.message}</div>
              {turn.errorType === "missing_key" && (
                <button className="ai-btn" onClick={() => setShowSettings(true)}>Open settings</button>
              )}
            </div>
          )
          const agent = AGENTS.find(a => a.id === turn.agent)
          const isActive = activeAgentId === turn.id
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
                <div className={`ai-agent-text${isActive ? " is-streaming" : ""}`}>
                  {turn.text || (isActive ? <span className="ai-typing">thinking…</span> : "")}
                </div>
              </div>
            </div>
          )
        })}
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

function Logo({ size = 32 }) {
  const points = [0, 72, 144, 216, 288]
  const r1 = 9.5, r2 = 12
  const dotColors = [
    "var(--color-agent-claude)",
    "var(--color-agent-gpt)",
    "var(--color-agent-gemini)",
    "var(--color-agent-grok)",
    "var(--color-accent)",
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden>
      <rect width="36" height="36" rx="9" fill="var(--color-bg-tertiary)"/>
      {points.map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180
        const x1 = 18 + r1 * Math.cos(rad)
        const y1 = 18 + r1 * Math.sin(rad)
        const x2 = 18 + r2 * Math.cos(rad)
        const y2 = 18 + r2 * Math.sin(rad)
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-text-secondary)" strokeWidth="0.8" opacity="0.5"/>
            <circle cx={x2} cy={y2} r="2" fill={dotColors[i]}/>
          </g>
        )
      })}
      <circle cx="18" cy="18" r="10.5" stroke="var(--color-text-tertiary)" strokeWidth="0.6" fill="none" strokeDasharray="2 2.5"/>
      <circle cx="18" cy="18" r="3" fill="var(--color-text-primary)"/>
      <circle cx="18" cy="18" r="1.1" fill="var(--color-accent)"/>
    </svg>
  )
}

function IconButton({ children, onClick, title, active }) {
  return (
    <button className={`ai-iconbtn${active ? " is-active" : ""}`} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  )
}

async function proxyFetch(path, body, extraHeaders = {}) {
  return fetch(`${PROXY}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()), ...extraHeaders },
    body: JSON.stringify(body),
  })
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
