/**
 * BUILD CLASSIFICATION — mechanical vs subjective.
 * ================================================
 * The panel IS the product. A subjective build (one that has to REASON content
 * into existence — strategy, opinion, an argument, an ad) must debate first and
 * then offer options, not silently build a single-AI answer. A mechanical build
 * (transform/format/compile content that already exists) skips the panel and
 * builds directly.
 *
 * Default is SUBJECTIVE: building without panel input is the exception, reserved
 * for purely mechanical tasks. The dispatcher LLM also classifies (build_class);
 * this is the backstop and the single source of truth for the keyword signals.
 */

// Pure transformation/formatting of content that already exists.
const MECHANICAL_RE = new RegExp([
  '\\b(convert|reformat|format|compose into|compile|package|assemble|collate)\\b',
  '\\bturn (this|that|it|these|those) into\\b',
  '\\bput (this|that|it|these|those) (in|into)\\b',
  '\\b(from|using) what we (discussed|talked about|said|covered)\\b',
  '\\borgani[sz]e (this|that|these|those|the above|what we)\\b',
  '\\b(make|build|create) (a|the)? ?(spreadsheet|table|csv|xlsx) (of|from|with)\\b',
  '\\bclean (this|that|it) up\\b',
].join('|'), 'i')

// Generated opinion / judgment / strategy / argument — content reasoned into
// existence, where a single AI gives the same average answer as ChatGPT alone.
const SUBJECTIVE_RE = new RegExp([
  '\\bpros and cons\\b',
  '\\b(recommend|recommendation|advise|suggest the best)\\b',
  '\\b(pitch|sell|sales? (deck|page|copy)|market)\\b',
  '\\b(argue|argument|make the case|strongest case|steel ?man)\\b',
  '\\bbest (approach|way|strategy|option)\\b',
  '\\bplan (a|my|the|out)? ?(campaign|launch|strategy|rollout|go.?to.?market)\\b',
  '\\bwrite (me )?an? (ad|advert|campaign|pitch|essay|manifesto|landing|op.?ed)\\b',
  '\\bshould (i|we|you)\\b',
  '\\b(strategy|strategi[sz]e|brainstorm|ideate|come up with|design (a|an)|concept for)\\b',
  '\\b(which (is|should|one)|compare|evaluate|judge|critique|review (my|this))\\b',
  '\\b(name|naming|tagline|slogan|positioning)\\b',
].join('|'), 'i')

const REFERS_BACK_RE = /\b(this|that|these|those|the above|what we|it)\b/i

/**
 * classifyBuildIntent(userMessage, { hasPriorDiscussion, hasAttachments })
 *   → 'mechanical' | 'subjective'
 */
export function classifyBuildIntent(userMessage = '', opts = {}) {
  const { hasPriorDiscussion = false, hasAttachments = false } = opts
  const m = String(userMessage || '')

  if (MECHANICAL_RE.test(m)) return 'mechanical'
  if (SUBJECTIVE_RE.test(m)) return 'subjective'

  // Transforming content that already exists (a prior discussion or an
  // attachment the message points at) is mechanical structuring.
  if ((hasPriorDiscussion || hasAttachments) && REFERS_BACK_RE.test(m)) return 'mechanical'

  // Default: the content has to be reasoned into existence → subjective.
  return 'subjective'
}

// Resolve the LLM's build_class flag (if any) against the heuristic. The
// dispatcher's explicit call wins; otherwise the keyword heuristic decides.
export function resolveBuildClass(llmClass, userMessage, opts) {
  if (llmClass === 'mechanical' || llmClass === 'subjective') return llmClass
  return classifyBuildIntent(userMessage, opts)
}
