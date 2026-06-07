/**
 * AGENT INTERFACE — OpenClaw v3
 * ================================
 * The compiler at the heart of Agent Interface.
 * Reads the roundtable, decides who talks, what tools fire, and what to build.
 */

import { supabase } from './supabase'
import { pricingTableFor, sortByCost, pricingFor } from './agentPricing'
import { makeIdleTimeout, isAbort } from './fetchTimeout'
import { TOOLS_BY_ID, readKey } from '../tools/registry'
import { brandBriefFrom, buildRequiresBrandContext, brandContextBlockMessage } from './brandContext'
import { resolveBuildClass } from './buildClass'

const PROXY = import.meta.env.VITE_PROXY_URL || "https://claude-proxy.jamesreed.workers.dev"

// ── Role pool ────────────────────────────────────────
export const ROLE_POOL = {
  skeptic: { name: "Skeptic", purpose: "Find what's broken. Do not agree with the premise. Only 'no, because' — never 'yes, and'. If you genuinely cannot find a flaw, say so explicitly: 'I can't find a flaw here, and here's why this is unusually solid.' That rare admission is your most useful signal — never fake skepticism, never fake comfort." },
  reality_checker: { name: "Reality Checker", purpose: "Surface unstated assumptions and missing context. Ask the questions the user didn't think to ask. What does this plan require that we have not confirmed the user has — money, time, connections, skills, access, audience? No opinions on the idea itself — only flag what's unspoken." },
  builder: { name: "Builder", purpose: "Take the idea seriously and figure out how it would actually work on day one with what's in front of us right now. Constructive and concrete. Specific first step, specific tool, specific output. No hand-waving." },
  synthesizer: { name: "Synthesizer", purpose: "Write the actual read across what everyone said. Not consensus — real conclusions, including the disagreements that didn't resolve. Example shape: 'Three of us think this is solid. The Skeptic's objection is X, and it wasn't answered. Here's what to do about it.'" },
  pattern_spotter: { name: "Pattern Spotter", purpose: "Notice the shape underneath. Connect this idea to structures from other domains, prior conversations the user mentioned, or recurring patterns the user might not see. One sharp connection beats five vague ones." },
  steel_manner: { name: "Steel-Manner", purpose: "Argue for the idea as strongly as possible. Make the best version of the case before anyone tears it down. Even if you privately disagree, your job is to articulate why this could actually work, taken at its strongest." },
  numbers_person: { name: "Numbers Person", purpose: "Get concrete about money, time, and math. Real numbers — costs, hours, conversion rates, break-evens, traffic estimates. If you have to estimate, estimate openly and show the math. No vague 'this could be profitable' — give actual figures." },
  translator: { name: "Translator", purpose: "Restate the idea or the discussion in plainer terms. Strip the jargon. Confirm everyone (user + other agents) is using the same words to mean the same things." },
  historian: { name: "Historian", purpose: "Pull in what we've discussed before — prior conversations, memory the user has confirmed, decisions they've already made. Bring continuity. Surface a contradiction with something they said earlier if you spot one." },
}

const ROLE_IDS = Object.keys(ROLE_POOL)
const SPEND_MODES = ['frugal', 'balanced', 'premium']

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { 'x-supabase-auth': `Bearer ${session.access_token}` } : {}
}

export function selectOrchestrationModel(settings) {
  if (settings?.agents?.claude?.key) return { provider: "claude", key: settings.agents.claude.key }
  if (settings?.agents?.gpt?.key) return { provider: "gpt", key: settings.agents.gpt.key }
  if (settings?.agents?.gemini?.key) return { provider: "gemini", key: settings.agents.gemini.key }
  // Grok last (purely additive — only chosen when it's the ONLY key, so it
  // never changes routing for a claude/gpt/gemini user). It's OpenAI-wire-
  // compatible, so every orchestration call site treats it like the gpt branch
  // with the /grok route. Closes the gap where a Grok-only user could chat but
  // not orchestrate or build.
  if (settings?.agents?.grok?.key) return { provider: "grok", key: settings.agents.grok.key }
  return null
}

function extractJson(text) {
  if (!text) return null
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim()
  const start = cleaned.indexOf("{")
  if (start === -1) return null
  let depth = 0, inString = false, escape = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (c === "\\") { escape = true; continue }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)) }
        catch { return null }
      }
    }
  }
  return null
}

async function callOpenClaw(prompt, modelConfig) {
  if (!modelConfig) return { decision: null, raw: null, error: "no_model" }

  const system =
    "You are OpenClaw — the compiler inside Agent Interface. " +
    "Your only job is to return ONE JSON object that follows the schema exactly. " +
    "Begin your response with `{` and end with `}`. No prose. No markdown. No code fences."

  // Guard the orchestrate call against a hung proxy — a stall here blocks the
  // ENTIRE turn (no agents respond until this returns). Idle timeout aborts a
  // dead socket instead of spinning forever.
  const t = makeIdleTimeout()
  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }], max_tokens: 2048 }),
        signal: t.signal,
      })
      const data = await res.json()
      if (!res.ok || data.error) { t.clear(); return { decision: null, raw: data, error: `claude_${res.status}` } }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt" || modelConfig.provider === "grok") {
      const res = await fetch(`${PROXY}/${modelConfig.provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
        signal: t.signal,
      })
      raw = await streamToText(res, "gpt", t)
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }),
        signal: t.signal,
      })
      raw = await streamToText(res, "gemini", t)
    }
    t.clear()
    const decision = extractJson(raw)
    return { decision, raw, error: decision ? null : "parse_failed" }
  } catch (e) {
    t.clear()
    return { decision: null, raw: null, error: isAbort(e) ? "timeout" : e.message }
  }
}

// Freeform in-app help assistant. Unlike orchestrate()/callOpenClaw() this
// returns natural-language prose, not JSON. The caller passes a `knowledge`
// string (built from the tool registry + agent setup, so it's always current).
// It MUST NOT invent URLs — the UI renders verified Sign up / Get key / Billing
// buttons under the answer — so the prompt tells it to refer to those buttons.
export async function askHelp({ question, history = [], knowledge = "", settings }) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { text: "", error: "no_model" }

  const system = [
    "You are the in-app help assistant for Agent Interface, a multi-agent AI studio.",
    "Answer the user's question clearly and concisely — a few short steps, not an essay.",
    "Use ONLY the knowledge below. If it isn't covered, say so briefly and suggest where in the app to look.",
    "IMPORTANT: never write out URLs or links. The app shows verified 'Sign up / Get key / Billing' buttons directly under your answer, so refer to those (e.g. \"tap Get key below\") instead of pasting any link.",
    "",
    "=== KNOWLEDGE ===",
    knowledge,
  ].join("\n")

  const convo = history.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n")
  const prompt = `${convo ? convo + "\n" : ""}User: ${question}\nAssistant:`

  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }], max_tokens: 1024 }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return { text: "", error: `claude_${res.status}` }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt" || modelConfig.provider === "grok") {
      const res = await fetch(`${PROXY}/${modelConfig.provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }),
      })
      if (!res.ok) return { text: "", error: `gpt_${res.status}` }
      raw = await streamToText(res, "gpt")
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }),
      })
      if (!res.ok) return { text: "", error: `gemini_${res.status}` }
      raw = await streamToText(res, "gemini")
    }
    return { text: raw.trim(), error: raw.trim() ? null : "empty" }
  } catch (e) {
    return { text: "", error: e.message }
  }
}

async function streamToText(res, kind, timeout) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = "", full = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    timeout?.bump()  // bytes arrived — reset the idle window
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop()
    for (const l of lines) {
      if (!l.startsWith("data: ")) continue
      if (l.includes("[DONE]")) continue
      try {
        const d = JSON.parse(l.slice(6))
        if (kind === "gemini") {
          const t = d.candidates?.[0]?.content?.parts?.[0]?.text
          if (t) full += t
        } else {
          const c = d.choices?.[0]?.delta?.content
          if (c) full += c
        }
      } catch {}
    }
  }
  return full
}

function buildOrchestratorPrompt({
  userMessage, agentSummary, toolList, memorySummary, enabledAgents,
  activeProject, isCorrection, isBuildSignal, hasPriorDiscussion,
  voiceMode, previousRoleAssignments, routingPerformance, previousSpendMode,
}) {
  const roleCatalog = Object.entries(ROLE_POOL)
    .map(([id, r]) => `  - "${id}" (${r.name}): ${r.purpose.split('.')[0]}.`)
    .join("\n")

  const previousAssignmentsLine = previousRoleAssignments && Object.keys(previousRoleAssignments).length
    ? Object.entries(previousRoleAssignments).map(([a, r]) => `${a}=${r}`).join(", ")
    : "(none — this is the first turn or roles weren't assigned last turn)"

  const perfBlock = routingPerformance && routingPerformance.length
    ? routingPerformance.filter(p => p.agent_id !== '_any_').slice(0, 12)
        .map(p => `  - ${p.agent_id} as ${p.role_id}: ${p.total} turns, ${p.positive_pct}% positive`).join("\n") || "(no actionable signal yet)"
    : "(no signal yet — first few sessions, weight tendencies above instead)"

  const requestedRoles = routingPerformance?.filter(p => p.agent_id === '_any_').map(p => p.role_id) || []
  const requestedHint = requestedRoles.length ? `\nThe user has previously asked for these roles explicitly: ${requestedRoles.join(", ")}` : ""

  // Adaptive pricing context — only shows agents the user has connected.
  // Sorted cheapest-first so frugal mode picks naturally from the top.
  const pricingBlock = enabledAgents.length
    ? pricingTableFor(enabledAgents)
    : '  (no agents available)'
  const cheapest = sortByCost(enabledAgents)[0]
  const mostExpensive = sortByCost(enabledAgents).slice(-1)[0]

  return `
You are the DISPATCHER for a panel of specialist AIs. You are NOT a fifth voice in the rotation.
Your job: read the user's intent, decide who speaks, assign roles, and decide what spend mode the conversation is in.

INPUT
=====
USER MESSAGE: "${userMessage}"
PRIOR AGENT DISCUSSION: ${hasPriorDiscussion ? "yes" : "none"}
EXPLICIT BUILD APPROVAL DETECTED: ${isBuildSignal ? "yes" : "no"}
IS CORRECTION: ${isCorrection}
VOICE MODE: ${voiceMode}

AGENTS CONNECTED & PRICING (sorted cheapest-first):
${pricingBlock}
${enabledAgents.length > 1 ? `Cheapest: ${cheapest}.  Most expensive: ${mostExpensive}.` : ''}

TOOLS AVAILABLE: ${toolList || "none"}
ACTIVE PROJECT: ${activeProject?.name || "none"}${activeProject?.description ? ` — ${activeProject.description}` : (activeProject ? " — (NO brand brief on file — you do NOT know what this product is; do not invent it)" : "")}

USER MEMORY:
${memorySummary || "none"}

WHAT AGENTS SAID JUST NOW:
${agentSummary || "(nothing yet — first message in this thread)"}

PREVIOUS TURN'S ROLE ASSIGNMENTS: ${previousAssignmentsLine}
PREVIOUS TURN'S SPEND MODE: ${previousSpendMode || "(none — first turn)"}

PRIOR ROUTING OUTCOMES FOR THIS USER (90-day rolling):
${perfBlock}${requestedHint}

ROLE POOL:
${roleCatalog}

SPEND MODE
==========
Read the user's message + recent conversation for cost vs. quality cues:

FRUGAL — user wants exploratory/cheap thinking. Triggers:
  "brainstorm", "just thinking", "rough idea", "quick", "save tokens",
  "affordable", "exploratory", "casual", "no need to overthink".
  Routing: prefer the CHEAPEST available agents. If only premium agents are
  connected, pick the cheapest of those. Skills get force-disabled. V2 audit
  skipped. Single round.

PREMIUM — user wants this done right, cost is not the constraint. Triggers:
  "build this right", "bulletproof", "make sure it's solid", "for investors",
  "final version", "production ready", "be thorough", "polish this".
  Routing: prefer the MOST CAPABLE available agents (usually highest-priced).
  Skills get force-enabled. V2 audit on every critical role. 2-3 rounds.

BALANCED — default. Anything else.
  Routing: pick what fits the role best regardless of cost.
  Skills and audit respect the user's existing per-agent settings.

ADAPTIVE TO WHAT'S CONNECTED — this matters:
- The user might have only 2 agents connected, or 6. Always reason RELATIVE
  to what's in the AGENTS CONNECTED list above, not against an absolute scale.
- If they have only one agent: spend mode is informational, that's the only choice.
- If they have only premium agents (no budget tier): frugal still means
  "cheapest of these", not "can't fulfill".
- If a budget-tier agent (e.g. gemini) is available and user signals frugal,
  lean on it heavily — it's ~40x cheaper than premium agents.

MODE STICKINESS:
- Mode persists from previous turn unless user signals a shift.
- Build approval ("build it") forces minimum balanced.
- If the message mixes signals ("brainstorm me a bulletproof pitch") —
  premium wins. Quality signal overrides cost signal in conflict.

ROLE ASSIGNMENT RULES
=====================
- Roles are ASSIGNMENTS, not identities. Same agent can play different roles
  on different turns. Sticky by default — reassign only when the SHAPE of
  the conversation shifts (brainstorm → stress-test), not the topic.
- FRICTION RULE: on multi-agent discuss turns with 2+ agents, MUST include
  at least one critical role (Skeptic OR Reality Checker) unless:
    • Voice mode is on
    • User explicitly asked for supportive mode ("hype me up", "no critique")
    • We already did a critical pass; this turn is synthesis or building
  Builder + Numbers Person + Steel-Manner is WRONG — no friction. Always
  pair generative roles with one that finds the flaw.
- Pick 2-3 roles per turn. Silence from a role is a meaningful signal.
- Match role to agent strengths (use the strengths field in the pricing
  table above as a guide — these are tendencies, not rules).
- PRIOR ROUTING OUTCOMES are a TIEBREAKER, not an override. Sample sizes
  under 5 are noise.

BRAND CONTEXT & HONESTY (this overrides eagerness to build)
===========================================================
- NEVER invent what a product/brand IS. If the ACTIVE PROJECT has no brand
  brief and the user hasn't described the product, you do NOT know what it is.
  A name alone ("Timberline Deal Tracker") tells you NOTHING about the market,
  audience, or voice — do not guess it's real estate, SaaS, or anything else.
- NEVER reference "prior context", "earlier sessions", "what we brainstormed",
  or past discussions that aren't actually present. PRIOR AGENT DISCUSSION above
  is the ONLY prior context you have. If it says "none" and no project brief is
  shown, your "reasoning" MUST NOT claim any prior context — say plainly
  "no prior context for this project".
- requires_brand_context: set true when the build's OUTPUT must align to a
  specific brand/product identity, voice, or positioning — ads, promos, sales
  decks, pitch decks, landing pages, newsletters, social posts (IG/X/TikTok),
  podcast/video scripts, taglines, marketing copy. Set false for neutral
  artifacts: a spreadsheet of data, a code project, a generic how-to doc, a
  research summary. When in doubt for anything marketing-shaped, set true.
- brand_brief_in_message: set true ONLY when the user's CURRENT message itself
  supplies real product context — what it is, who it's for, and/or its voice.
  A long message about HOW to market (channels, tactics, tone instructions) is
  NOT a brief if it never says WHAT the product actually is. Default false.

DECISION TREE (first match wins)
================================
1. If TOOLS AVAILABLE includes a search tool AND user asked a search question:
     → mode = "build", plan = [{tool: <search>, prompt: <topic>}], agents_to_respond = []

2. If the user DIRECTLY and SPECIFICALLY asks you to produce a concrete artifact
   that a BUILD-INTERNAL TOOL can generate — e.g. "make me a spreadsheet of …",
   "put this in a spreadsheet", "write a doc that …", "build a deck on …",
   "create a PDF of …", "turn this into a .xlsx/.docx/.pptx" — AND the request
   already has enough detail to act on WITHOUT a clarifying question:
     → mode = "build"  (this fires even with NO prior discussion — a clear
       deliverable request does not need a roundtable first)
     → agents_to_respond = []
     → deliverable = short folder-friendly name
     → plan = the matching generator, almost always fed by an agent_synth step.
       For tabular data → xlsxgen (use gsheets instead only if the user explicitly
       said "Google Sheet"). Canonical shape:
         { "steps": [
           { "id": "s1", "tool": "agent_synth", "needs": [], "output_schema": "spreadsheet",
             "input": "<exactly what to tabulate, with the columns/rows the user asked for>",
             "label": "Draft the data" },
           { "id": "s2", "tool": "xlsxgen", "needs": ["s1"], "input": "{s1}",
             "label": "Build the .xlsx" }
         ] }
       Mirror this for other artifacts: agent_synth(output_schema "document") → docgen,
       "slides" → pptxgen, "page" → htmlgen, "post" → mdgen, "project" → codezip.
     → If the ask is vague or exploratory ("help me think about what columns to use",
       "should I even make a spreadsheet?") do NOT build — fall through to discuss.
       Only build when both the deliverable AND its contents are clear.

2b. AD / VIDEO ASSET BUILD — if the user DIRECTLY asks to build an ad, promo,
    storyboard, or short video ("make me a 30s ad about X", "build a promo video
    for Y", "storyboard an ad for Z") AND the request has enough detail to act on:
     → mode = "build", agents_to_respond = [], deliverable = short folder name
     → Build the chain ONLY from tools that actually appear in TOOLS AVAILABLE.
       Storyboard frames always work (image_per_slide is build-internal).
       Animation needs runway; for the backing track PREFER stable_audio
       (build-internal) — include the animation step ONLY if runway is connected.
       Never invent a step for a tool that isn't listed.
     → Canonical shape (4 scenes, ~30s):
         { "steps": [
           { "id": "s1", "tool": "agent_synth", "needs": [], "output_schema": "storyboard",
             "input": "Write a 4-scene, 30-second ad for <subject>. For each scene give a title, a vivid photoreal image prompt (describe the SHOT, not the pitch), and a duration_sec. Then write voiceover_script: persuasive spoken ad copy that SELLS <subject> to the viewer (arc: hook → problem → product → resolution), ~75 words, pure spoken language — NOT a description of the scenes.",
             "label": "Write the storyboard + ad script" },
           { "id": "s2", "tool": "image_per_slide", "needs": ["s1"], "input": "{ \"slides\": {s1.scenes} }",
             "label": "Generate the 4 frames" },
           { "id": "s3", "tool": "elevenlabs", "needs": ["s1"], "input": "{s1.voiceover_script}",
             "label": "Record the voiceover" },
           { "id": "s4", "tool": "stable_audio", "needs": ["s1"], "input": "Instrumental 30s backing track, no vocals: tense build resolving to confident.",
             "label": "Generate the backing track" },
           { "id": "s5", "tool": "ad_render", "needs": ["s2", "s3", "s4"],
             "input": "{ \"images\": {s2}, \"voiceover\": {s3}, \"music\": {s4} }",
             "label": "Render the finished ad" }
         ] }
       CRITICAL — voiceover ≠ storyboard. s1 MUST use output_schema "storyboard"
       (it returns scenes[] for the visuals AND a separate voiceover_script that
       is real ad copy). The voiceover step MUST read "{s1.voiceover_script}" —
       NEVER feed it "{s1}" or the scene prompts, or it will narrate scene
       descriptions instead of selling the product. image_per_slide reads the
       scenes via "{s1.scenes}". Use openai_tts instead of elevenlabs for s3 if
       ElevenLabs isn't connected (OpenAI usually is — image_per_slide needs it).
     → SHORT PROMO / COMBINED BUILDS — if the video is short (≤~10s) OR the build
       ALSO produces a single hero image (e.g. "an App Store description + a hero
       image + a short promo video"), prefer the SIMPLE, reliable path: feed
       ad_render that one hero image directly instead of generating a separate
       multi-frame storyboard. i.e. ad_render input "images": {heroImageStep}
       (the dalle/stability step), plus the voiceover and music. One image + one
       voiceover is still a real finished video and has far fewer moving parts
       than storyboard→image_per_slide. Reserve image_per_slide for ads the user
       explicitly wants as MULTIPLE distinct scenes.
     → STITCHING: ad_render is the default finisher — it is build-internal
       (browser-side ffmpeg, no key) and fuses the frame(s) + voiceover
       (+ ducked backing track) into ONE finished MP4. In s5's input the
       image/voiceover/music placeholders are NOT quoted — they resolve to whole
       bundle objects that splice in directly; quoting them would produce invalid JSON.
       It always works, so the ad is a real video, not a kit. Alternatives only
       when asked: video_render (Shotstack) for a server-rendered MP4 from runway
       VIDEO clips (needs a shotstack key AND hosted clip URLs — it cannot fetch
       the data: frames/audio this pipeline makes, so it is NOT the default), or
       capcut_bundle for a hand-editable CapCut .zip. For motion instead of stills,
       add a runway step per scene before ad_render only if runway is connected.

2c. USER BRIEF BEATS PRIOR PANEL SKEPTICISM — if the user's CURRENT message
    contains an explicit build instruction ("build [X] now", "generate [X]",
    "create [X]", "make [X]", "fire the tools") AND the message includes enough
    detail to act on (the artifact type, the topic, the specifics):
     → mode = "build" REGARDLESS of whether prior agents in the discussion raised
       concerns or flagged gaps. The user's explicit instruction overrides any
       prior panel skepticism. Agents may have legitimately flagged missing info,
       but if the user is saying "build it now" with sufficient detail, build it now.
     → agents_to_respond = [], deliverable = short folder name
     → Multi-tool builds (storyboard → image_per_slide → suno → pptxgen) are
       valid; chain the steps via needs[] and trust each tool to do its part.

3. If EXPLICIT BUILD APPROVAL DETECTED yes AND PRIOR AGENT DISCUSSION yes:
     → mode = "build"
     → agents_to_respond = []
     → deliverable = short folder-friendly name
     → plan = multi-step graph using available tools + internal tools
       (agent_synth, pptxgen, docgen, pdfgen, narrate_per_slide, gmail)
     → Internal tools always available. See BUILD-INTERNAL TOOLS section below.

BUILD CLASS — set "build_class" on EVERY build. The panel IS the product, so a
build that has to REASON content into existence should debate first, not silently
produce a single-AI answer:
- "mechanical" → pure transformation/formatting of content that ALREADY exists
  (in the conversation or an attachment): convert, format, compile, "organize what
  we discussed", "turn this into a spreadsheet", "put that in a doc". agent_synth's
  job is to STRUCTURE, not to invent opinions. Mechanical builds run directly.
- "subjective" → generated opinion/judgment/strategy/argument/creative: "pros and
  cons", "recommend", "pitch", "write an ad", "plan a campaign", "best approach",
  "should we", "strongest case for". The content does not exist yet — a single AI
  here gives the same average answer as ChatGPT alone. Subjective builds DEBATE
  first (the panel), then offer the user options. Default to subjective when unsure.

BUILD INTENT — set "build_intent" on EVERY build (it tunes how agent_synth is fed):
- "compile"  → the panel JUST discussed this and the user wants it organized into
   an artifact. Triggers: "put this/that in a spreadsheet", "compile what we
   talked about", "make a doc from what we just discussed", "build a deck from
   the above", "organize the above", "turn this into a …" — i.e. the ask points
   BACK at the conversation ("this", "that", "the above", "what we discussed")
   AND there was prior discussion. The FIRST agent_synth step must ORGANIZE the
   prior discussion, not generate from scratch — the executor will inject the
   actual discussion transcript into that step, so write its input as a short
   instruction like "Organize the panel's key points about <topic> into the
   <schema> the user asked for; do not add new information." Keep it tight.
- "research" → the artifact needs current/external info the panel doesn't have.
   Triggers: "research X", "find current X", "what are X this year", "look up X",
   "latest X". Plan's FIRST step is a search tool (perplexity or exa) if one is
   in TOOLS AVAILABLE, then agent_synth to organize, then the generator.
- "create"   → pure generation; panel hasn't discussed it and no research needed.
   Triggers: "write me a poem about X", "draft an email about X", "make a deck
   pitching X". Standard agent_synth from the prompt with an adequate budget.
   This is the default when none of the above fit.

4. Otherwise:
     → mode = "discuss", plan = []
     → agents_to_respond = 2-3 from AGENTS CONNECTED, biased by spend_mode
     → role_assignments mapping each to a role_id, honoring stickiness
     → rounds = 1 for simple Q&A, 2 for back-and-forth, 3 for genuine debate
     → In frugal: 1 round, cheapest agents. In premium: up to 3, capable agents.

BUILD-INTERNAL TOOLS (always available in build mode):
- agent_synth (returns JSON; use output_schema "slides", "document", "spreadsheet", "page", "post", "project", or "storyboard" — storyboard returns scenes[]{title,prompt,duration_sec,on_screen_text} for the visuals AND a separate voiceover_script of real spoken ad copy; use it for ANY ad/video build so the voiceover is sales copy, not scene descriptions)
- pptxgen (slides[] → .pptx)
- docgen (sections[] or slides[] → .docx)
- pdfgen (sections[] or slides[] or text → .pdf)
- xlsxgen (sheets[{name,rows[][]}] → .xlsx — Excel spreadsheet, multi-tab supported)
- htmlgen ({title,sections[],theme?'light'|'dark'|'serif'} → .html — self-contained landing page)
- mdgen ({title,sections[],frontmatter?} → .md — blog post with YAML frontmatter)
- codezip ({files:[{path,content}]} → .zip — multi-file code project, nested paths OK)
- image_per_slide ({slides[{title,prompt?}], style?, size?'square'|'wide'|'tall'} → one image per slide as a bundle)
- IMAGE OUTPUT SPEC: any image step (dalle, image_per_slide) may add output_spec to get an EXACT, ready-to-use size instead of a model-native one. Use it for store/social assets: 'app_icon' (1024²), 'play_feature' (1024×500), 'play_screenshot'/'instagram_story' (1080×1920), 'ios_screenshot_67' (1290×2796), 'og_image' (1200×630), 'square_1080', 'youtube_thumb' (1280×720), 'twitter_card' (1600×900). Or pass dimensions:{w,h,fit:'cover'|'contain'}. e.g. {"prompt":"...","output_spec":"play_feature"}.
- narrate_per_slide (slides[] → per-slide audio with timing; accepts provider:'elevenlabs'|'openai')
- openai_tts ({text, voice?:'nova'|'alloy'|'echo'|'fable'|'onyx'|'shimmer'} → audio file; use when ElevenLabs is unavailable or user says "use OpenAI voice")
- stable_audio ({prompt, duration?:1-190} → instrumental music track up to 190s, royalty-free; PREFER for ad backing tracks, ambient, video music)
- elevenlabs_music ({prompt, length_ms?:3000-60000} → music up to 60s, can include vocals; PREFER when user wants songs/vocals)
- suno (third-party fallback only — use ONLY when user explicitly asks for Suno and has the key)
- ad_render (COMPOSER: { images:{frameStepId}, voiceover:{voiceStepId}, music?:{musicStepId} } → ONE finished .mp4 ad where the storyboard frames play across the voiceover with the backing track ducked underneath. Browser-side ffmpeg, no key, works with the data: assets this pipeline makes. THE default finisher for ad/promo/short-video builds — always the final step, fed by image_per_slide + the voiceover (+ stable_audio).)
- video_render ({clips:[{url,type?,length?}], soundtrack?, size?} → ONE finished MP4 via Shotstack from HOSTED clip URLs (e.g. runway videos). Needs the shotstack key AND publicly-fetchable assets — it CANNOT use the data: frames/audio this pipeline produces, so prefer ad_render for ads. Use only for stitching hosted video clips.)
- capcut_bundle ({clips:[{url,type?,length?}], soundtrack?, size?} → .zip with a timeline edit-plan + CapCut import steps; build-internal. Use when the user wants to hand-edit in CapCut rather than an auto-rendered MP4.)
- gmail ({to,subject,body} → sent email)
- gsheets ({title,sheets[{name,rows[][]}]} → Google Sheet in user's Drive, returns link)
- gcal ({summary,start,end,description?,attendees?[]} → Google Calendar event, ISO times or {date} for all-day)
- notion ({parentPageId|parentDatabaseId, title, sections:[{heading,body,items?[]}]} → Notion page; requires user's notion token + parent must be shared with their integration)
- twilio ({to:"+E.164", from:"+E.164", body} → sends an SMS via the user's Twilio account; needs Twilio credentials)
- stripe ({name, amount, currency?:"usd", description?, after_completion_url?} → Stripe payment link; amount in dollars (49.99) or cents (4999); test mode auto-detected from sk_test_ key)

CREDENTIAL-GATED INTERNAL TOOLS: stripe, twilio, notion, suno, stable_audio,
elevenlabs_music, openai_tts and image_per_slide each need the user's own key,
and gmail/gsheets/gcal need a connected Google account. Only include one of
these in a plan if the user has plainly asked for that capability — any such
step is automatically DROPPED if the credential is missing, so don't build a
chain that depends on one unless it's clearly wanted.

MUSIC ROUTING: when a build needs music, PREFER stable_audio for instrumental
ad/video backing tracks and ambient; PREFER elevenlabs_music when the user wants
vocals or a song-like track. Only use suno when the user EXPLICITLY asks for it
(unofficial third-party reseller, may be unreliable).

Variable interpolation: "{stepId}" or "{stepId.field}" in input.
Dependency order via needs[].

OUTPUT (return EXACTLY this JSON, no preface, no fence):
{
  "mode": "discuss" | "build",
  "spend_mode": "frugal" | "balanced" | "premium",
  "agents_to_respond": ["<agent_id>", ...],
  "role_assignments": { "<agent_id>": "<role_id>" },
  "rounds": 1,
  "response_mode": "concise" | "balanced" | "detailed",
  "build_intent": "compile" | "research" | "create" | null,
  "build_class": "mechanical" | "subjective",
  "requires_brand_context": true | false,
  "brand_brief_in_message": true | false,
  "deliverable": "<short folder name for build, or null in discuss>",
  "plan": { "steps": [{ "id": "...", "tool": "...", "needs": [], "input": "...", "label": "...", "output_schema": "slides" }] },
  "correction": { "detected": false, "what_was_wrong": null, "what_user_wants": null, "save_to_memory": false, "memory_entry": null },
  "voice_response_chars": 300,
  "reasoning": "one sentence: why this mode, these agents, this spend tier"
}
`.trim()
}

// COMPILE-mode source material. When a build follows a substantive panel
// discussion and the user asks to "organize / put this in / compile what we
// discussed", agent_synth must work FROM the conversation, not from scratch.
// This packs the relevant prior turns into a compact (~3-4K char) source block
// that gets prepended to the first agent_synth step's input. We send the real
// transcript we already hold in memory rather than asking the dispatcher LLM to
// reproduce it — keeps the round-trip cheap and the source verbatim.
function buildCompileDigest({ agentResponses = [], conversationHistory = [], userMessage = "" }) {
  // Most recent response per agent (later entries overwrite → keep latest).
  const latestByAgent = new Map()
  for (const r of agentResponses) {
    if (!r?.text) continue
    latestByAgent.set(r.agent || 'agent', r.text)
  }
  const discussion = [...latestByAgent.entries()]
    .map(([agent, text]) => `${String(agent).toUpperCase()}: "${text.trim().slice(0, 800)}"`)
    .join("\n\n")
  if (!discussion) return null

  // The question that prompted the discussion = the user turn BEFORE this build
  // trigger. conversationHistory already includes the trigger as its last user
  // entry, so take the previous one.
  const userTurns = conversationHistory.filter(m => m.role === 'user')
  const priorQuestion = userTurns.length > 1
    ? userTurns[userTurns.length - 2].content
    : (userTurns[0]?.content || '')

  return [
    "PRIOR PANEL DISCUSSION (organize ONLY this material into the requested",
    "schema; do NOT add external information):",
    "",
    priorQuestion ? `Q: "${String(priorQuestion).slice(0, 600)}"` : "",
    priorQuestion ? "" : null,
    discussion,
    "",
    "USER'S ASK:",
    `"${userMessage}"`,
  ].filter(l => l !== null).join("\n")
}

export async function orchestrate({
  userMessage, conversationHistory = [], agentResponses = [],
  enabledAgents = [], enabledTools = {}, memory = [], activeProject = null,
  previousRoleAssignments = {}, previousSpendMode = null,
  routingPerformance = [], settings, voiceMode = false,
}) {
  const modelConfig = selectOrchestrationModel(settings)

  const agentSummary = agentResponses
    .map(r => `${r.agent?.toUpperCase()}: ${(r.text || "").slice(0, 400)}`)
    .join("\n\n")

  const toolList = Object.entries(enabledTools).filter(([, v]) => v).map(([id]) => id).join(", ")
  const memorySummary = memory.slice(0, 5).map(m => `[${m.title}]: ${(m.content || "").slice(0, 150)}`).join("\n")

  const correctionPhrases = ["that's not what i meant", "no i wanted", "wrong", "not right", "try again", "that's not", "i said", "i meant", "actually"]
  const isCorrection = correctionPhrases.some(p => userMessage.toLowerCase().includes(p))

  const buildSignals = [
    "build it", "build this", "let's build", "go build", "ship it", "let's ship",
    "go for it", "let's go", "do it now", "yes do it", "yes build", "yes make it",
    "perfect, build", "great, build", "ok build", "let's make this",
    "go ahead and build", "fire the tools", "make it", "do it",
  ]
  const lower = userMessage.toLowerCase()
  const isBuildSignal = buildSignals.some(p => lower.includes(p))
  const hasPriorDiscussion = agentResponses.length > 0

  const prompt = buildOrchestratorPrompt({
    userMessage, agentSummary, toolList, memorySummary, enabledAgents,
    activeProject, isCorrection, isBuildSignal, hasPriorDiscussion, voiceMode,
    previousRoleAssignments, routingPerformance, previousSpendMode,
  })

  if (!modelConfig) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: "No orchestrator model configured — defaulted to discuss." }
  }

  const { decision, raw, error } = await callOpenClaw(prompt, modelConfig)
  if (raw) console.log("[OpenClaw]", raw.slice(0, 600))
  if (error) console.warn("[OpenClaw error]", error)

  if (!decision) {
    return { ...defaultDecision(enabledAgents, voiceMode), reasoning: `OpenClaw fallback — ${error || "no decision"}.` }
  }

  // Filter agents_to_respond to enabled
  if (Array.isArray(decision.agents_to_respond)) {
    decision.agents_to_respond = decision.agents_to_respond.filter(a => enabledAgents.includes(a))
    if (decision.mode !== "build" && decision.agents_to_respond.length === 0) {
      decision.agents_to_respond = enabledAgents
    }
  }

  // Validate spend_mode. Build approval forces at least balanced regardless of
  // what came back from the LLM — you're past brainstorming if you're building.
  if (!SPEND_MODES.includes(decision.spend_mode)) {
    decision.spend_mode = previousSpendMode && SPEND_MODES.includes(previousSpendMode) ? previousSpendMode : 'balanced'
  }
  if (isBuildSignal && decision.spend_mode === 'frugal') {
    decision.spend_mode = 'balanced'
  }

  // Sanitize role_assignments
  const cleanRoles = {}
  if (decision.role_assignments && typeof decision.role_assignments === "object") {
    for (const [agent, role] of Object.entries(decision.role_assignments)) {
      if (decision.agents_to_respond?.includes(agent) && ROLE_IDS.includes(role)) cleanRoles[agent] = role
    }
  }
  decision.role_assignments = cleanRoles

  // Normalize plan
  const BUILD_INTERNAL_TOOLS = new Set([
    'agent_synth', 'pptxgen', 'docgen', 'pdfgen',
    'xlsxgen', 'htmlgen', 'mdgen', 'codezip',
    'image_per_slide', 'narrate_per_slide', 'openai_tts',
    'stable_audio', 'elevenlabs_music', 'capcut_bundle', 'ad_render',
    'gmail', 'gsheets', 'gcal', 'notion', 'twilio', 'stripe',
  ])
  // Gate every step on whether it can ACTUALLY run, so the build plan never
  // includes a step that's doomed to fail at runtime for a missing credential.
  // Previously build-internal tools were allowed unconditionally — so a plan
  // could contain e.g. a `stripe` step with no Stripe key, which then 500s
  // mid-build. Now:
  //   • non-internal tools → must be user-enabled (unchanged)
  //   • agent_synth → needs ANY orchestration model (claude/gpt/gemini), not
  //     just its nominal keySource (it falls back internally) — don't drop it
  //     for a GPT-only user or every build breaks
  //   • other internal tools with a pasted-key keySource (stripe, twilio,
  //     notion, suno, stable_audio, elevenlabs_music, openai_tts,
  //     image_per_slide) → require that key
  //   • keyless internal tools (pptxgen, xlsxgen, ad_render, …) and the Google-
  //     OAuth ones (gmail/gsheets/gcal, keySource null) → allowed; the OAuth
  //     ones still fail gracefully at run time if the user hasn't connected.
  const isToolAllowed = (toolId) => {
    if (!BUILD_INTERNAL_TOOLS.has(toolId)) return !!enabledTools?.[toolId]
    if (toolId === 'agent_synth') return !!selectOrchestrationModel(settings)
    const keySource = TOOLS_BY_ID[toolId]?.keySource
    if (keySource) return !!readKey(settings, keySource)
    return true
  }

  let steps = []
  let deliverable = decision.deliverable || null
  if (Array.isArray(decision.plan)) {
    steps = decision.plan.filter(s => s?.tool && isToolAllowed(s.tool)).map((s, i) => ({
      id: s.id || `step_${i}`, tool: s.tool,
      input: s.input || s.prompt || '', needs: [],
      label: s.label || s.tool, output_schema: s.output_schema,
    }))
  } else if (decision.plan?.steps && Array.isArray(decision.plan.steps)) {
    steps = decision.plan.steps.filter(s => s?.id && s?.tool && isToolAllowed(s.tool)).map(s => ({
      id: s.id, tool: s.tool,
      input: s.input || s.prompt || '', needs: Array.isArray(s.needs) ? s.needs : [],
      label: s.label || s.tool, output_schema: s.output_schema,
    }))
    deliverable = decision.plan.deliverable || deliverable
  }
  const validIds = new Set(steps.map(s => s.id))
  steps = steps.map(s => ({ ...s, needs: s.needs.filter(n => validIds.has(n)) }))

  // COMPILE mode: the build organizes what the panel JUST discussed. The
  // dispatcher can't reliably copy the transcript into the step input (token
  // waste + lossy), so we inject the real prior discussion here — into the
  // FIRST agent_synth step, the one that has no upstream needs[] (i.e. it's
  // generating, not transforming another step's output). Without this, that
  // step regenerates the content from scratch: it burns tokens on broad topics
  // and produces weaker output on narrow ones.
  let buildIntent = ['compile', 'research', 'create'].includes(decision.build_intent)
    ? decision.build_intent : null
  // Heuristic fallback if the dispatcher didn't classify: a build that points
  // back at the conversation ("this", "the above", "what we discussed") AND
  // follows a real discussion is a compile.
  if (!buildIntent && decision.mode === 'build' && hasPriorDiscussion &&
      /\b(this|that|these|those|above|what we|we just|we talked|we discussed|the discussion)\b/i.test(userMessage)) {
    buildIntent = 'compile'
  }
  decision.build_intent = buildIntent

  if (decision.mode === 'build' && buildIntent === 'compile' && hasPriorDiscussion) {
    const digest = buildCompileDigest({ agentResponses, conversationHistory, userMessage })
    if (digest) {
      const firstSynth = steps.find(s => s.tool === 'agent_synth' && (!s.needs || s.needs.length === 0))
      if (firstSynth) {
        firstSynth.input = `${digest}\n\nTASK:\n${firstSynth.input || 'Organize the discussion above into the requested format. Do not add new information.'}`
      }
    }
  }

  // ── BRAND-CONTEXT HARD GATE ───────────────────────────────────────────
  // Before any brand-facing build runs, require real brand context. Without
  // it the panel fabricates an entire product identity from just a name (the
  // "Timberline → invented real-estate platform" failure). The gate checks the
  // ACTIVE PROJECT's brief, NOT how detailed the prompt is — a verbose prompt
  // about HOW to market supplies nothing about WHAT is being marketed. The one
  // escape is a brief pasted into the current message (brand_brief_in_message),
  // which we then carry into the build as one-time context.
  if (decision.mode === 'build' && steps.length > 0) {
    const brandBrief = brandBriefFrom(activeProject)
    const needsBrand = buildRequiresBrandContext({
      requiresBrandFlag: typeof decision.requires_brand_context === 'boolean'
        ? decision.requires_brand_context : null,
      steps,
    })
    const briefInMessage = decision.brand_brief_in_message === true
    if (needsBrand && !brandBrief && !briefInMessage) {
      return blockedForBrandContext(activeProject)
    }
    // Carry whatever brand context we DO have into the build so the builder
    // (agent_synth) writes from it instead of inventing. Project brief wins;
    // otherwise the in-message brief is used for this build only.
    const buildBrandContext = brandBrief || (briefInMessage ? userMessage : '')
    if (buildBrandContext) decision.plan_brand_context = buildBrandContext
  }

  decision.plan = { deliverable, steps, brandContext: decision.plan_brand_context || null }
  delete decision.plan_brand_context

  if (decision.mode === "build" && steps.length === 0) {
    decision.mode = "discuss"
    decision.agents_to_respond = decision.agents_to_respond?.length ? decision.agents_to_respond : enabledAgents
    decision.reasoning = (decision.reasoning || "") + " (no usable tool in plan — switched to discuss)"
  }

  // ── PANEL-FIRST: subjective builds debate before building ─────────────
  // The panel is the product. A build that has to REASON content into existence
  // (strategy, opinion, an ad) should debate first and then offer the user
  // options — not silently produce one single-AI answer. Mechanical builds
  // (format/compile existing content) build directly, unchanged. Needs ≥2 agents
  // to debate; the actual per-option plans are generated AFTER the debate
  // (generateBuildOptions). The dispatcher's drawn-up plan becomes the basis.
  if (decision.mode === 'build' && steps.length > 0 && enabledAgents.length >= 2) {
    const buildClass = resolveBuildClass(decision.build_class, userMessage, { hasPriorDiscussion })
    decision.build_class = buildClass
    if (buildClass === 'subjective') {
      const debaters = enabledAgents.slice(0, 3)
      const roles = assignDebateRoles(debaters)
      decision.mode = 'build_options'
      decision.agents_to_respond = debaters
      decision.role_assignments = roles
      decision.rounds = 1
      decision.panel_round = { agents: debaters, role_assignments: roles, rounds: 1 }
      decision.base_plan = decision.plan   // basis for the options after the debate
      decision.reasoning = (decision.reasoning || '') + ' (subjective build — panel debates, then offers options)'
    }
  } else if (decision.mode === 'build') {
    decision.build_class = 'mechanical'
  }

  return decision
}

// Default debate lineup for a panel-first (subjective) build. Always pairs a
// generative role (builder/steel_manner) with a critical one (skeptic/reality
// checker) so the debate has real friction, not parallel agreement.
const DEBATE_LINEUP = ['builder', 'skeptic', 'reality_checker']
function assignDebateRoles(agents) {
  const roles = {}
  agents.forEach((id, i) => { roles[id] = DEBATE_LINEUP[i % DEBATE_LINEUP.length] })
  return roles
}

// Send/notify actions that operate ON the finished deliverable. When a subjective
// build goes through the options flow ("make a deck AND email it"), the options
// only regenerate the deliverable — these trailing actions get dropped. We carry
// them from the base plan onto whichever option the user picks.
const POST_ACTION_TOOLS = new Set(['gmail', 'twilio'])

/**
 * Append the base plan's trailing send-actions (gmail/twilio) onto a chosen
 * option's steps, wired to run AFTER the option's deliverable. Re-points any
 * {baseStepId} placeholders in the action's input to the option's deliverable
 * step, and makes sure an email body includes the deliverable's link.
 */
export function carryActionSteps(optionSteps = [], basePlan = null) {
  const actions = (basePlan?.steps || []).filter(s => POST_ACTION_TOOLS.has(s?.tool))
  if (!actions.length || !optionSteps.length) return optionSteps
  // The deliverable = the option's last file-producing step (not the synth).
  const deliverable = [...optionSteps].reverse().find(s => s.tool !== 'agent_synth') || optionSteps[optionSteps.length - 1]
  const baseIds = new Set((basePlan.steps || []).map(s => s.id))
  const usedIds = new Set(optionSteps.map(s => s.id))
  const carried = actions.map((a, i) => {
    let id = a.id || `act${i + 1}`
    while (usedIds.has(id)) id = `act${i + 1}_${id}`
    usedIds.add(id)
    let input = typeof a.input === 'string' ? a.input : (a.input ? JSON.stringify(a.input) : '')
    // Point any reference to a base-plan step at the option's deliverable.
    input = input.replace(/\{([a-z0-9_]+)(\.[a-z0-9_]+)?\}/gi, (m, sid, field) =>
      baseIds.has(sid) ? `{${deliverable.id}${field || ''}}` : m)
    // Attach the finished deliverable to the email (gmail sends it as a real
    // file). The "{deliverable}" placeholder resolves to that step's output
    // object, which gmail turns into a base64 attachment.
    if (a.tool === 'gmail') {
      try {
        const obj = JSON.parse(input)
        if (!obj.attachments) obj.attachments = [`{${deliverable.id}}`]
        input = JSON.stringify(obj)
      } catch { /* non-JSON input — leave as-is */ }
    }
    return { ...a, id, input, needs: [deliverable.id] }
  })
  return [...optionSteps, ...carried]
}

// The output_schema a generator needs from its upstream agent_synth step.
const SCHEMA_FOR_GENERATOR = {
  pptxgen: 'slides', image_per_slide: 'slides', narrate_per_slide: 'slides',
  docgen: 'document', pdfgen: 'document',
  xlsxgen: 'spreadsheet', gsheets: 'spreadsheet',
  mdgen: 'post', htmlgen: 'page', codezip: 'project',
}

function normalizeOptionPlan(plan, fallbackDeliverable) {
  const raw = Array.isArray(plan?.steps) ? plan.steps : []
  const steps = raw.filter(s => s?.tool).map((s, i) => ({
    id: s.id || `s${i + 1}`,
    tool: s.tool,
    input: s.input || s.prompt || '',
    needs: Array.isArray(s.needs) ? s.needs : [],
    label: s.label || s.tool,
    output_schema: s.output_schema,
  }))
  const ids = new Set(steps.map(s => s.id))
  for (const s of steps) {
    s.needs = s.needs.filter(n => ids.has(n))
    // A generator step must consume its upstream step's STRUCTURED output via a
    // clean {stepId} placeholder. Models sometimes write prose ("Use the slides
    // from the outline…") which the generator then JSON.parses and chokes on
    // ("Unexpected token 'U'…"). Force the interpolation when there's no
    // placeholder already.
    if (s.needs.length && SCHEMA_FOR_GENERATOR[s.tool] && !/\{[a-z0-9_]+\}/i.test(s.input)) {
      s.input = `{${s.needs[0]}}`
    }
  }
  // Backfill an agent_synth step's output_schema from whatever generator
  // consumes it, so the synth produces the shape the generator expects
  // (slides for pptxgen, document for docgen, …).
  for (const s of steps) {
    if (s.tool === 'agent_synth' && !s.output_schema) {
      const consumer = steps.find(c => c.needs.includes(s.id) && SCHEMA_FOR_GENERATOR[c.tool])
      if (consumer) s.output_schema = SCHEMA_FOR_GENERATOR[consumer.tool]
    }
  }
  return { deliverable: plan?.deliverable || fallbackDeliverable || 'Build', steps }
}

/**
 * SECOND orchestrator pass for a subjective build. After the panel debates,
 * synthesize 3-4 meaningfully different build options FROM the debate — each
 * with a runnable plan, the agents who championed it, and a consensus score.
 * Returns an array (possibly empty); the executor's per-step isolation + content
 * rescue handle any imperfect plan, so we keep normalization light.
 */
export async function generateBuildOptions({ userMessage, debate = [], deliverable, enabledTools = {}, settings }) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return []
  const toolList = Object.entries(enabledTools).filter(([, v]) => v).map(([id]) => id).join(', ')
  const debateText = debate
    .map(r => `${String(r.agent || 'agent').toUpperCase()}${r.role ? ` (${r.role})` : ''}: ${(r.text || '').slice(0, 500)}`)
    .join('\n\n')

  const prompt = `You are OpenClaw. The panel just debated a build request. Turn the debate into concrete, DIFFERENT build options the user can choose from.

USER REQUEST: "${userMessage}"

PANEL DEBATE:
${debateText || '(no debate captured — infer reasonable angles)'}

TOOLS AVAILABLE: ${toolList || '(build-internal generators only)'}

Generate 3-4 MEANINGFULLY DIFFERENT options — distinct angles the panel raised,
not trivial variations. For each:
- "name": 2-4 words
- "description": one line on the angle
- "est_cost": rough, e.g. "~$0.05"
- "est_time": rough, e.g. "~2 min"
- "champions": array of agent ids who pushed this angle (from the debate above)
- "consensus": integer 1-4 — how many panelists would endorse it
- "plan": { "deliverable": "...", "steps": [ {"id","tool","needs":[],"input","label","output_schema"} ] }
  Use agent_synth (output_schema slides|document|spreadsheet|post|page) feeding a
  generator (pptxgen|docgen|xlsxgen|mdgen|htmlgen). Feed the debate into the synth
  step's input so it builds FROM the panel's reasoning. Each plan must be runnable.

Return EXACTLY this JSON, no preface, no fence:
{"options":[ ... ]}`.trim()

  const { decision } = await callOpenClaw(prompt, modelConfig)
  const options = Array.isArray(decision?.options) ? decision.options : []
  return options.slice(0, 4).map((o, i) => ({
    name: String(o?.name || `Option ${i + 1}`).slice(0, 48),
    description: String(o?.description || '').slice(0, 180),
    est_cost: String(o?.est_cost || ''),
    est_time: String(o?.est_time || ''),
    champions: Array.isArray(o?.champions) ? o.champions.filter(a => typeof a === 'string') : [],
    consensus: Math.max(1, Math.min(4, Math.round(Number(o?.consensus) || 1))),
    arguments: String(o?.arguments || o?.rationale || '').slice(0, 600),
    plan: normalizeOptionPlan(o?.plan, deliverable),
  })).filter(o => o.plan.steps.length > 0)
}

// A brand-facing build was requested but no usable brand context exists. We do
// NOT build (that would fabricate the product) and we do NOT run a discuss round
// (the agents would fabricate too). The orchestrator responds asking for a brief.
// TheInterface renders mode:"blocked" as a single orchestrator notice turn.
function blockedForBrandContext(activeProject) {
  const name = activeProject?.name || null
  return {
    mode: 'blocked',
    spend_mode: 'balanced',
    agents_to_respond: [],
    role_assignments: {},
    rounds: 0,
    response_mode: 'balanced',
    build_intent: null,
    deliverable: null,
    plan: { deliverable: null, steps: [], brandContext: null },
    block: {
      reason: 'needs_brand_context',
      projectName: name,
      hasProject: !!activeProject,
      message: brandContextBlockMessage(name),
    },
    correction: { detected: false },
    reasoning: name
      ? `Build needs brand context but "${name}" has no usable brief — asked for one instead of fabricating the product.`
      : `Build needs brand context but no project is active and no brief was provided — asked for one instead of fabricating the product.`,
  }
}

export function defaultDecision(enabledAgents, voiceMode) {
  return {
    mode: "discuss",
    spend_mode: 'balanced',
    agents_to_respond: enabledAgents,
    role_assignments: {}, skip_agents: [],
    rounds: 1,
    response_mode: voiceMode ? "concise" : "balanced",
    plan: [], correction: { detected: false },
    voice_response_chars: voiceMode ? 200 : 500,
    reasoning: "Default fallback",
  }
}

export async function processCorrection(decision, settings, saveMemory) {
  if (!decision?.correction?.detected) return
  if (!decision.correction.save_to_memory) return
  if (!decision.correction.memory_entry) return
  try {
    await saveMemory(
      `Learned: ${decision.correction.what_was_wrong?.slice(0, 50) || "preference"}`,
      decision.correction.memory_entry, "learned"
    )
  } catch {}
}

// ── V2 audit ────────────────────────────────────────────
const DRIFT_PRONE_ROLES = new Set(['skeptic', 'reality_checker', 'steel_manner'])

const AUDIT_TESTS = {
  skeptic: "Did they find an actual flaw? PASS = a real objection, even a small one. FAIL = soft agreement, 'good point but also...', restating the user's idea back, or generic concerns.",
  reality_checker: "Did they only flag unstated assumptions and missing context? PASS = surfacing what's unspoken. FAIL = giving opinions on the idea itself.",
  steel_manner: "Did they make the strongest possible case for the idea? PASS = a real argument FOR. FAIL = hedging, sliding into critique.",
}

export function shouldAudit(role, voiceMode) {
  if (voiceMode) return false
  return DRIFT_PRONE_ROLES.has(role)
}

// Returns { passed, reason, audited }.
//   audited=true  → the verdict is real (an audit model actually judged the text).
//   audited=false → the audit could not run (no model, infra error, unparseable
//                   reply). In that case we DELIBERATELY fail OPEN (passed:true).
// Why fail open: the only consumer (TheInterface) reacts to passed:false by
// re-prompting the agent with a "you drifted out of role" reminder. Failing
// closed on our own infra error would fire a spurious extra API call AND feed
// the agent a false accusation it drifted — making the output worse, not safer.
// So on failure we let the original response stand, but surface it via `audited`
// + a logged warning instead of masquerading as a clean pass.
export async function auditResponse({ text, role, userMessage, settings }) {
  if (!text || text.length < 20) return { passed: true, reason: "empty", audited: false }
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { passed: true, reason: "no_model", audited: false }
  const roleDef = ROLE_POOL[role]
  if (!roleDef) return { passed: true, reason: "unknown_role", audited: false }

  const audit = AUDIT_TESTS[role] || "Did they stay in role?"
  const prompt = `You are auditing whether a specialist AI stayed in its assigned role on this turn.

ROLE ASSIGNED: ${roleDef.name}
ROLE PURPOSE: ${roleDef.purpose}

USER'S MESSAGE: "${userMessage?.slice(0, 600) || "(unknown)"}"

AGENT'S RESPONSE: "${text.slice(0, 1500)}"

AUDIT TEST FOR THIS ROLE: ${audit}

Return EXACTLY this JSON: {"passed": true|false, "reason": "<one short sentence>"}`

  // Same hang guard as the orchestrate call — the audit runs inline on a turn,
  // so a stalled socket would block the agent's response from finalizing.
  const t = makeIdleTimeout()
  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
        signal: t.signal,
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        t.clear()
        console.warn("[OpenClaw audit] claude audit call failed — failing open", res.status, data?.error)
        return { passed: true, reason: `audit_error_claude_${res.status}`, audited: false }
      }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt" || modelConfig.provider === "grok") {
      const res = await fetch(`${PROXY}/${modelConfig.provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
        signal: t.signal,
      })
      raw = await streamToText(res, "gpt", t)
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
        signal: t.signal,
      })
      raw = await streamToText(res, "gemini", t)
    }
    t.clear()
    const parsed = extractJson(raw)
    if (parsed && typeof parsed.passed === "boolean") {
      return { passed: parsed.passed, reason: parsed.reason || "", audited: true }
    }
    console.warn("[OpenClaw audit] could not parse audit verdict — failing open", raw?.slice(0, 200))
    return { passed: true, reason: "audit_parse_failed", audited: false }
  } catch (e) {
    t.clear()
    console.warn("[OpenClaw audit] audit threw — failing open", isAbort(e) ? "timeout" : e?.message)
    return { passed: true, reason: isAbort(e) ? "audit_timeout" : "audit_exception", audited: false }
  }
}

export function buildRetryReminder(role, auditReason) {
  const roleDef = ROLE_POOL[role]
  if (!roleDef) return ""
  return `IMPORTANT — your previous response slipped out of role.
Audit feedback: ${auditReason || "you drifted toward generic helpfulness"}.
You were assigned: ${roleDef.name}.
Your job, restated: ${roleDef.purpose}
This time, do the job. ${role === 'skeptic' ? "Find the actual flaw. If you genuinely cannot, say so explicitly and explain why." : role === 'reality_checker' ? "Surface only what's unspoken. No opinions on whether the idea is good or bad." : role === 'steel_manner' ? "Make the strongest possible case. No hedging." : ""}`
}

// ── Memory inference ────────────────────────────────────────
export async function inferMemoriesFromConversation({ turns, existingMemories = [], settings }) {
  const modelConfig = selectOrchestrationModel(settings)
  if (!modelConfig) return { candidates: [], error: "no_model_key" }
  const transcript = turns.filter(t => t.text && (t.type === "user" || t.type === "agent"))
    .slice(-40).map(t => `${t.type === "user" ? "USER" : `AGENT(${t.agent || "?"})`}: ${t.text.slice(0, 600)}`).join("\n")
  if (!transcript.trim()) return { candidates: [], error: "empty_conversation" }
  const existingList = existingMemories.length ? existingMemories.slice(0, 30).map(m => `- ${m.title}: ${m.content?.slice(0, 200)}`).join("\n") : "(none yet)"
  const system = `You are OpenClaw's memory layer. Read a conversation and identify stable, useful facts about the user.

EXTRACT: durable preferences, profession, projects, communication style. Cite evidence.
SKIP: one-off curiosity, anything already in EXISTING MEMORIES, sensitive info unless explicitly asked.

OUTPUT JSON: {"candidates":[{"title":"...","content":"...","confidence":"high|medium|low","evidence":"..."}]}
Max 6 candidates.`
  const prompt = `EXISTING MEMORIES:\n${existingList}\n\nCONVERSATION:\n${transcript}\n\nExtract new memory candidates as JSON.`
  try {
    let raw = ""
    if (modelConfig.provider === "claude") {
      const res = await fetch(`${PROXY}/claude`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) }, body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }) })
      const data = await res.json()
      if (!res.ok || data.error) return { candidates: [], error: `claude_${res.status}` }
      raw = data.content?.[0]?.text || ""
    } else if (modelConfig.provider === "gpt" || modelConfig.provider === "grok") {
      const res = await fetch(`${PROXY}/${modelConfig.provider}`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${modelConfig.key}`, ...(await authHeader()) }, body: JSON.stringify({ messages: [{ role: "user", content: `${system}\n\n${prompt}` }] }) })
      raw = await streamToText(res, "gpt")
    } else if (modelConfig.provider === "gemini") {
      const res = await fetch(`${PROXY}/gemini`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": modelConfig.key, ...(await authHeader()) }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${prompt}` }] }] }) })
      raw = await streamToText(res, "gemini")
    }
    const parsed = extractJson(raw)
    return { candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [], error: null }
  } catch (e) { return { candidates: [], error: e?.message || "infer_failed" } }
}

export const SETUP_GUIDES = {
  anthropic: { name:"Claude", url:"https://console.anthropic.com/api-keys", keyPrefix:"sk-ant-" },
  openai:    { name:"ChatGPT", url:"https://platform.openai.com/api-keys", keyPrefix:"sk-proj-" },
  google:    { name:"Gemini", url:"https://aistudio.google.com/app/apikey", keyPrefix:"AIza" },
  xai:       { name:"Grok", url:"https://console.x.ai", keyPrefix:"xai-" },
  elevenlabs:{ name:"ElevenLabs", url:"https://elevenlabs.io/app/settings/api-keys", keyPrefix:null },
  stability: { name:"Stability AI", url:"https://platform.stability.ai/account/keys", keyPrefix:"sk-" },
  perplexity:{ name:"Perplexity", url:"https://www.perplexity.ai/settings/api", keyPrefix:"pplx-" },
}

export function diagnoseError(agentId, status) {
  const messages = {
    401: { claude:{msg:"Your Anthropic key isn't working.",fix:"anthropic"}, gpt:{msg:"Your OpenAI key isn't working.",fix:"openai"}, gemini:{msg:"Your Google AI key isn't working.",fix:"google"}, grok:{msg:"Your xAI key isn't working.",fix:"xai"} },
    429: { claude:{msg:"Claude is rate limited.",fix:null}, gpt:{msg:"ChatGPT hit its rate limit.",fix:null}, gemini:{msg:"Gemini's free tier is exhausted.",fix:"google_billing",url:"https://aistudio.google.com/app/plan"}, grok:{msg:"Grok is rate limited.",fix:null} },
    402: { grok:{msg:"Your xAI account has no credits.",fix:"xai"} },
  }
  return messages[status]?.[agentId] || { msg: `${agentId} returned an error. Check your API key.`, fix: null }
}

export function getProactiveNotices(settings) {
  const notices = []
  const agents = settings?.agents || {}
  const tools = settings?.tools || {}
  const connected = Object.values(agents).filter(a => a.key && a.enabled).length
  if (connected === 0) notices.push({ priority:"critical", message:"No AI agents connected. Add at least one API key to get started.", fix:"anthropic" })
  if (tools.dalle?.enabled && !agents.gpt?.key) notices.push({ priority:"high", message:"DALL-E is enabled but needs an OpenAI key in Agents → ChatGPT.", fix:"openai" })
  if (tools.elevenlabs?.enabled && !tools.elevenlabs?.key) notices.push({ priority:"medium", message:"ElevenLabs is enabled but needs an API key in Tools → Voice.", fix:"elevenlabs" })
  if (tools.perplexity?.enabled && !tools.perplexity?.key) notices.push({ priority:"medium", message:"Perplexity search is enabled but needs an API key in Tools → Search.", fix:"perplexity" })
  return notices.sort((a,b) => ({critical:0,high:1,medium:2,low:3})[a.priority] - ({critical:0,high:1,medium:2,low:3})[b.priority])
}
