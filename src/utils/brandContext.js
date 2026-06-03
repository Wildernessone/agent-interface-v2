/**
 * BRAND CONTEXT
 * =============
 * Single source of truth for "does this project carry a real brand brief, and
 * does this build NEED one?" — used to stop the panel from fabricating an
 * entire product identity when it's handed only a name.
 *
 * The failure this guards against: given just "Timberline Deal Tracker" (a
 * shopping deal/coupon tracker) the panel invented a real-estate investing
 * platform, a BiggerPockets audience, and a "prior brainstorm" that never
 * happened. The fix is a hard gate: brand-facing builds require a real brief
 * (from the project description OR pasted into the message) before they run.
 */

// The labelled scaffold ProjectPicker offers via "Insert template". Kept here
// so the gate and the form share ONE definition — an unfilled template must NOT
// count as a real brief.
export const BRIEF_TEMPLATE = `What it is:
Audience:
Voice & tone:
Differentiator:
Avoid: `

// A brief needs at least this many characters of *filled-in* content (after the
// bare template labels are stripped) to count. ~100 per the product spec — a
// one-liner like "deal site" is not enough to generate on-brand content from.
export const MIN_BRAND_CONTEXT_CHARS = 100

// Generators whose output is inherently brand-facing: a deck, landing page,
// social/blog post, image set, or video ad must match a specific identity.
// Deliberately EXCLUDES neutral artifacts (xlsxgen data tables, codezip, the
// ambiguous docgen/pdfgen — those are gated by the dispatcher's explicit
// requires_brand_context flag instead, not by tool presence).
export const BRAND_CREATIVE_TOOLS = new Set([
  'image_per_slide', 'ad_render', 'video_render', 'capcut_bundle',
  'htmlgen', 'mdgen', 'pptxgen',
])

// Strip the template's empty label lines so "What it is:\nAudience:\n..." with
// nothing filled in measures as empty. A label line is only stripped when it
// has no value after the colon (i.e. the user never filled it).
function strippedMeaningfulLength(text) {
  return text
    .replace(/^(what it is|audience|voice(\s*(&|and)\s*tone)?|differentiator|avoid)\s*:?\s*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim()
    .length
}

/**
 * Returns the project's brand brief IF it carries real, usable content
 * (>= MIN_BRAND_CONTEXT_CHARS of filled-in text), else "". An empty string
 * means "no brand context on file" — the caller should not proceed with a
 * brand-facing build.
 */
export function brandBriefFrom(project) {
  const text = (project?.description || '').trim()
  if (!text) return ''
  if (strippedMeaningfulLength(text) < MIN_BRAND_CONTEXT_CHARS) return ''
  return text
}

/**
 * True when a build's output must align to a specific brand/product identity.
 * The dispatcher's own `requires_brand_context` judgment wins when present;
 * when it's absent we back-stop on the plan's tools (a deck/page/ad is brand-
 * facing regardless of what the model said). A verbose prompt about HOW to
 * market is irrelevant here — this asks only whether the OUTPUT is brand-bound.
 */
export function buildRequiresBrandContext({ requiresBrandFlag, steps = [] }) {
  if (requiresBrandFlag === true) return true
  if (requiresBrandFlag === false) return false  // trust an explicit "no"
  return steps.some(s => BRAND_CREATIVE_TOOLS.has(s?.tool))
}

/**
 * The orchestrator's message when a brand-facing build is blocked for lack of
 * context. Wording is the product spec's, parameterized by project name.
 */
export function brandContextBlockMessage(projectName) {
  const name = projectName || 'this project'
  return `I don't have enough context about ${name} to generate on-brand content. ` +
    `Please add a description to this project covering what it is, who it's for, voice, ` +
    `and key differentiators. Or paste a brand brief here and I'll use it for this build only.`
}
