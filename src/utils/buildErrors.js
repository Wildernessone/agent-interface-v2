/**
 * Friendly error mapper — turns the technical error codes we throw
 * inside tools and the build pipeline into readable messages a normal
 * person can act on.
 *
 * The build card's "reason" field passes through here before render.
 * Unknown codes fall through to a generic "step failed" so we never
 * surface raw machine strings to the user.
 */

const FRIENDLY = {
  // Auth / connection
  save_failed:           "Couldn't save to your cloud storage. Your Drive token may have expired — reconnect in Settings → Storage.",
  drive_auth_expired:    "Drive connection expired. Reconnect Google Drive in Settings → Storage.",
  dropbox_auth_expired:  "Dropbox connection expired. Reconnect in Settings → Storage.",
  missing_key:           "This tool needs an API key. Add one in Settings.",
  no_model:              "No AI key available. Add Claude, ChatGPT, or Gemini in Settings → Agents.",
  no_token:              "Storage isn't connected. Connect Drive or Dropbox in Settings → Storage.",
  no_user:               "You're not signed in. Refresh and try again.",
  no_source:             "This tool needs a source image — generate or attach one first.",
  no_recipient:          "Email step needs a recipient — say 'send it to <email>' in your message.",

  // Build-pipeline structural
  dependency_failed:     "Skipped — an earlier step failed.",
  unknown_tool:          "The AI asked for a tool that doesn't exist yet.",
  build_cycle_detected:  "The build plan has a loop — try rephrasing your request.",

  // Tool-runner failures
  bad_response:          "The AI's response was malformed. Try retrying.",
  audit_error:           "The quality check failed — output not verified.",
  audit_exception:       "Quality check crashed — output not verified.",
}

// Some error codes embed a status suffix — e.g. claude_401, gpt_429.
// Map the suffix range to a friendly reason.
const STATUS_HINTS = {
  401: "Authentication failed. Check your API key in Settings.",
  403: "Permission denied. Your API key may be missing required scopes.",
  429: "Rate limit hit. Wait a minute and try again.",
  500: "The provider had a server error. Try again shortly.",
  502: "The upstream service is unreachable right now.",
  503: "The upstream service is overloaded — try again shortly.",
}

/**
 * Map a technical error string to a human-readable sentence.
 * Returns the original string if no mapping matches — better than
 * returning empty, but the goal is to add to FRIENDLY when we see one.
 */
export function friendlyError(reason) {
  if (!reason) return 'Step failed.'
  if (FRIENDLY[reason]) return FRIENDLY[reason]

  // Pattern: provider_NNN (e.g. claude_401)
  const m = String(reason).match(/^([a-z_]+)_(\d{3})$/i)
  if (m) {
    const [, provider, status] = m
    const hint = STATUS_HINTS[Number(status)]
    if (hint) return `${provider}: ${hint}`
  }

  // Common token-truncation symptom
  if (/unterminated/i.test(reason)) {
    return "The AI ran out of tokens before finishing. Try a smaller scope or fewer slides."
  }
  if (/parse/i.test(reason)) {
    return "The AI's response wasn't valid — try retrying."
  }
  if (/fetch/i.test(reason)) {
    return "Network problem reaching the AI. Check your connection and retry."
  }

  return reason
}

/**
 * Build a one-line summary of what the panel actually shipped.
 * Used in the build card to make the output legible at a glance.
 */
export function buildSummary({ deliverable, files, errors }) {
  const fileCount = files?.length || 0
  const errCount = errors?.length || 0

  if (fileCount === 0 && errCount > 0) {
    return `Build failed — ${errCount} step${errCount === 1 ? '' : 's'} couldn't complete.`
  }
  if (fileCount === 0) {
    return `No files produced yet.`
  }

  // Look for a slide-count signal in the outputs (set by agent_synth / pptxgen)
  let slideCount = 0
  for (const f of files) {
    const meta = f?.output?.meta || {}
    if (meta.slideCount) { slideCount = Math.max(slideCount, meta.slideCount) }
  }

  const filenames = files
    .map(f => f.output?.filename || f.label)
    .filter(Boolean)

  const head = slideCount > 0
    ? `Built a ${slideCount}-slide deck`
    : `Built ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`

  const tail = errCount > 0
    ? ` (${errCount} step${errCount === 1 ? '' : 's'} skipped)`
    : ''

  return head + tail
}

/**
 * Extract slide titles for inline preview in the chat. Returns an
 * empty array if no slide-bearing output is in the build.
 */
export function extractSlideTitles(files) {
  for (const f of files || []) {
    const titles = f?.output?.meta?.slideTitles
    if (Array.isArray(titles) && titles.length) return titles
  }
  return []
}
