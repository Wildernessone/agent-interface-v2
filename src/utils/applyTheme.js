/**
 * applyTheme — turn the user's display preferences into real CSS the
 * page can read. Sets data-theme on <html>, and overrides accent /
 * font / bubble variables on :root so the whole UI re-renders live
 * when settings change.
 *
 * Called from a single useEffect in App.jsx whenever settings change.
 */

const FONT_SCALE = {
  Small:  '13px',
  Medium: '15px',
  Large:  '17px',
}

const BUBBLE_RADIUS = {
  Rounded: '12px',
  Square:  '4px',
  Pill:    '20px',
}

// Light-mix helper: blend an accent hex toward white by `pct` (0-1).
function lighten(hex, pct) {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c) => Math.round(c + (255 - c) * pct)
  return rgbToHex(mix(r), mix(g), mix(b))
}

// Dark-mix helper: blend toward black.
function darken(hex, pct) {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c) => Math.round(c * (1 - pct))
  return rgbToHex(mix(r), mix(g), mix(b))
}

function hexToRgb(hex) {
  const m = hex.replace('#', '')
  const v = m.length === 3
    ? m.split('').map(c => c + c).join('')
    : m
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyTheme(settings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const themeId = settings?.themeId || 'dark'
  const accent  = settings?.accent || '#2A6EF5'
  const font    = settings?.fontSize || 'Medium'
  const bubble  = settings?.bubbleStyle || 'Rounded'
  const isLight = themeId === 'light'

  // Theme palette via data attribute → tokens.css handles the rest
  root.setAttribute('data-theme', themeId)

  // Accent family — derived from the chosen color
  // Hover = slightly brighter (dark themes) / darker (light theme)
  // Soft  = transparent wash for backgrounds
  // Ring  = focus outline color
  const hover  = isLight ? darken(accent, 0.10) : lighten(accent, 0.12)
  const active = isLight ? darken(accent, 0.18) : darken(accent, 0.10)
  root.style.setProperty('--color-accent',        accent)
  root.style.setProperty('--color-accent-hover',  hover)
  root.style.setProperty('--color-accent-active', active)
  root.style.setProperty('--color-accent-soft',   rgba(accent, isLight ? 0.08 : 0.14))
  root.style.setProperty('--color-accent-ring',   rgba(accent, 0.25))
  root.style.setProperty('--color-border-focus',  accent)

  // Font size — applies to chat bubbles + input
  root.style.setProperty('--chat-font-size', FONT_SCALE[font] || FONT_SCALE.Medium)

  // Bubble shape — corner radius on message bubbles
  root.style.setProperty('--bubble-radius', BUBBLE_RADIUS[bubble] || BUBBLE_RADIUS.Rounded)
}
