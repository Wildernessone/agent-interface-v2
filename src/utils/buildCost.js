/**
 * BUILD COST ESTIMATOR
 * ====================
 * Rough per-step cost estimates so users see "≈ $0.42" on a build card
 * before clicking through it. Real billing comes off the user's own keys
 * — this is informational, not authoritative.
 *
 * Estimates are deliberately on the high side so users aren't surprised
 * by their actual bill. Browser-side tools (pptxgen, docgen, htmlgen…)
 * cost $0 since they don't hit any API.
 *
 * Add a row when you add a new tool. If you skip, total just under-counts
 * that step (logged as null), which is safer than over-counting.
 *
 * Reference pricing (USD, May 2026):
 *   - DALL-E (gpt-image-1, high)  ~$0.19/image at 1024px
 *   - DALL-E (gpt-image-1, med)   ~$0.07/image
 *   - Claude Sonnet synth         ~$0.03/call (4K tokens out)
 *   - ElevenLabs Turbo v2.5       ~$0.30/1K chars
 *   - Suno                        ~$0.05/song (varies by provider)
 *   - Runway gen3 turbo           ~$0.05/sec generated
 *   - Perplexity                  ~$0.005/query
 *   - Google Sheets/Cal/Gmail     $0 (free tier)
 *   - Notion                      $0 (free tier)
 */

// Returns cents (integer) for a single step. Null means "unknown — don't count".
export function estimateStepCents(step) {
  if (!step?.tool) return 0
  const input = step.input
  const struct = typeof input === 'object' && input !== null ? input : null

  switch (step.tool) {
    // Browser-side — no API cost
    case 'pptxgen':
    case 'docgen':
    case 'pdfgen':
    case 'xlsxgen':
    case 'htmlgen':
    case 'mdgen':
    case 'codezip':
      return 0

    // Free actions (Google/Notion free tiers)
    case 'gmail':
    case 'gsheets':
    case 'gcal':
    case 'notion':
      return 0

    // Single AI calls
    case 'agent_synth':
      return 3        // ~$0.03 Claude synth
    case 'perplexity':
    case 'tavily':
      return 1        // ~$0.01 per query

    // Image generation
    case 'dalle': {
      const q = struct?.quality || 'high'
      return q === 'low' ? 4 : q === 'medium' ? 7 : 19
    }
    case 'stability':
    case 'ideogram':
    case 'flux':
    case 'recraft':
      return 5         // ~$0.05 per image across these providers

    case 'image_per_slide': {
      const slides = struct?.slides?.length || 0
      const q = struct?.quality || 'high'
      const perImage = q === 'low' ? 4 : q === 'medium' ? 7 : 19
      return slides * perImage
    }

    // Audio
    case 'elevenlabs': {
      const chars = (struct?.text || '').length || 500
      return Math.ceil((chars / 1000) * 30)  // $0.30/1K chars
    }
    case 'narrate_per_slide': {
      const slides = struct?.slides || []
      const totalChars = slides.reduce((sum, s) => {
        const t = s?.notes || `${s?.title || ''}. ${(s?.bullets || []).join('. ')}`
        return sum + t.length
      }, 0) || (slides.length * 500)  // fall back to ~500 chars/slide est
      return Math.ceil((totalChars / 1000) * 30)
    }
    case 'suno':
      return 5        // ~$0.05 per song

    // Video
    case 'runway': {
      const dur = struct?.duration === 10 ? 10 : 5
      return dur * 5   // ~$0.05/sec
    }

    // Image editing
    case 'removebg':
    case 'clipdrop':
      return 2        // ~$0.02 per edit

    default:
      return null     // unknown — don't count, log so it shows up
  }
}

/**
 * Sum the per-step estimates. Returns { totalCents, knownSteps, unknownSteps }.
 * unknownSteps lets the UI say "≈ $0.42 (+ 1 step with unknown cost)".
 */
export function estimateBuildCents(steps = []) {
  let total = 0
  let known = 0
  let unknown = 0
  for (const s of steps) {
    const c = estimateStepCents(s)
    if (c == null) unknown++
    else { total += c; known++ }
  }
  return { totalCents: total, knownSteps: known, unknownSteps: unknown }
}

/**
 * Format cents as "$0.42" or "≈ $0.05" with sensible rounding.
 */
export function formatCents(cents) {
  if (cents == null) return '?'
  if (cents === 0) return 'free'
  if (cents < 10) return `~$0.0${cents}`
  return `~$${(cents / 100).toFixed(2)}`
}
