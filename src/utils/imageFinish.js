// ── Image finishing layer ──────────────────────────────────────────
// A generated image is RAW MATERIAL until it's the right size for where it's
// going. This sizes a freshly-generated image to an EXACT spec (cover-crop,
// contain, or pad) so a build outputs a ready-to-use deliverable — a 1024×500
// Play feature graphic, a 1290×2796 iOS screenshot, a 1200×630 OG image — not
// a model-native 1024×1024 that someone has to crop by hand.

// Named output specs → exact pixel dimensions.
export const OUTPUT_SPECS = {
  app_icon:          { w: 1024, h: 1024, fit: 'cover' },
  play_feature:      { w: 1024, h: 500,  fit: 'cover' },  // Google Play feature graphic
  play_screenshot:   { w: 1080, h: 1920, fit: 'cover' },
  ios_screenshot_67: { w: 1290, h: 2796, fit: 'cover' },  // iPhone 6.7"
  ios_screenshot_65: { w: 1242, h: 2688, fit: 'cover' },
  og_image:          { w: 1200, h: 630,  fit: 'cover' },  // social / Open Graph
  square_1080:       { w: 1080, h: 1080, fit: 'cover' },
  instagram_story:   { w: 1080, h: 1920, fit: 'cover' },
  instagram_post:    { w: 1080, h: 1080, fit: 'cover' },
  youtube_thumb:     { w: 1280, h: 720,  fit: 'cover' },
  twitter_card:      { w: 1600, h: 900,  fit: 'cover' },
}

// Resolve a spec from a preset name OR an explicit { w, h, fit }.
export function resolveSpec(spec) {
  if (!spec) return null
  if (typeof spec === 'string') return OUTPUT_SPECS[spec.toLowerCase().replace(/[\s-]/g, '_')] || null
  if (typeof spec === 'object' && spec.w && spec.h) {
    return { w: Math.round(+spec.w), h: Math.round(+spec.h), fit: spec.fit || 'cover' }
  }
  return null
}

// Pick the generation size (from a provider's allowed set) whose aspect ratio is
// closest to the target, so the cover-crop discards as little as possible.
export function bestGenSize(spec, allowed = ['1024x1024', '1536x1024', '1024x1536']) {
  const s = resolveSpec(spec)
  if (!s) return null
  const target = s.w / s.h
  let best = allowed[0], bestDiff = Infinity
  for (const a of allowed) {
    const [w, h] = a.split('x').map(Number)
    const d = Math.abs((w / h) - target)
    if (d < bestDiff) { bestDiff = d; best = a }
  }
  return best
}

// Size a source image (data URL or URL) to an exact spec, in-browser via canvas.
// Returns a PNG data URL. Outside a browser (or on any failure) returns src
// unchanged so it never breaks a build.
export async function fitImageToSpec(src, spec, { bg = '#0b0b0f' } = {}) {
  const s = resolveSpec(spec)
  if (!s || typeof document === 'undefined' || !src) return src
  try {
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = s.w; canvas.height = s.h
    const ctx = canvas.getContext('2d')
    const srcRatio = img.width / img.height
    const tgtRatio = s.w / s.h
    let dw, dh
    const contain = s.fit === 'contain' || s.fit === 'pad'
    if (contain) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, s.w, s.h)
      if (srcRatio > tgtRatio) { dw = s.w; dh = s.w / srcRatio } else { dh = s.h; dw = s.h * srcRatio }
    } else { // cover — fill the frame, crop the overflow
      if (srcRatio > tgtRatio) { dh = s.h; dw = s.h * srcRatio } else { dw = s.w; dh = s.w / srcRatio }
    }
    ctx.drawImage(img, (s.w - dw) / 2, (s.h - dh) / 2, dw, dh)
    return canvas.toDataURL('image/png')
  } catch {
    return src
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}
