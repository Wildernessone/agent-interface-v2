// Phone-size walk — the standing pass (James, 2026-10-08), run against any served copy of the site.
//
//   BASE_URL=http://127.0.0.1:8788 node scripts/phone-walk.mjs            # local `wrangler pages dev public`
//   BASE_URL=https://<branch>.agent-interface-v2.pages.dev node scripts/phone-walk.mjs
//   SHOTS=/some/dir node scripts/phone-walk.mjs                           # also save a viewport shot per page
//
// Every URL in the served /sitemap.xml (rewritten onto BASE_URL) plus /library, at 320x568 and 375x667,
// with touch (isMobile + hasTouch). It fails the run on:
//   1. sideways scroll            documentElement.scrollWidth, or innerWidth itself, wider than the DEVICE.
//                                 ⚠ Measured against the width we asked for, never against innerWidth: with
//                                 isMobile the layout viewport GROWS to fit overflowing content (the page is
//                                 zoomed out to fit, as on a real phone), so at a 320 viewport this site
//                                 reported innerWidth 377 and scrollWidth 377 — "no sideways scroll" — while
//                                 the header ran 57px past the screen.
//   2. clipped content            an element sticking out past the viewport edge that NO scroll container
//                                 of its own can bring back. ⚠ This is the check that matters here: body
//                                 has overflow-x:hidden, which propagates to the viewport, so a nav running
//                                 off the right edge produces NO sideways scroll — check 1 alone passed the
//                                 page whose LIBRARY link could not be reached.
//   3. covered controls           elementFromPoint at a header/nav/footer control's centre is not that control
//   4. small tap targets          a header/nav/footer control under 44x44 CSS px (inline body links exempt)
//   5. iOS zoom                   an input/select/textarea with font-size under 16px
// Sheets/modals: the site has none; the count is printed so a future one is noticed.
//
// ⛔ Beacons are ABORTED: the shell POSTs a page_view to the hub's analytics_events on every load, on any
//    host, so an un-aborted walk writes test rows into the numbers it is meant to protect. Clarity and GA
//    are host-gated to production already; they are aborted anyway.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '')
const SHOTS = process.env.SHOTS || ''
const SIZES = [[320, 568], [375, 667]]
const EXTRA = ['/library']

const BEACON = /supabase\.co\/rest\/v1\/analytics_events|clarity\.ms|googletagmanager|google-analytics/i

async function paths() {
  const r = await fetch(BASE + '/sitemap.xml', { headers: { 'user-agent': 'Mozilla/5.0 phone-walk' } })
  if (!r.ok) throw new Error(`sitemap.xml answered ${r.status} — refusing to walk an empty denominator`)
  const xml = await r.text()
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname)
  if (locs.length < 5) throw new Error(`only ${locs.length} sitemap URLs — the sweep broke, which would make this vacuous`)
  return [...new Set([...locs, ...EXTRA])]
}

// Runs in the page. W = the device width requested. Returns { sideways, clipped[], covered[], small[], zoom[], sheets }.
function audit(W) {
  // html{scroll-behavior:smooth} would make scrollIntoView ASYNC, so every rect read after it would be
  // the pre-scroll position and every footer link would read as off-screen.
  document.documentElement.style.scrollBehavior = 'auto'
  const vw = W
  const out = { vw, innerW: window.innerWidth, scrollW: document.documentElement.scrollWidth, sideways: false, clipped: [], covered: [], small: [], zoom: [], sheets: 0 }
  out.sideways = document.documentElement.scrollWidth > vw || window.innerWidth > vw
  const name = el => {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${t ? ` "${t}"` : ''}`
  }
  const visible = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 }
  // An ancestor that clips or scrolls on x, short of the root. Content inside one is either reachable
  // (overflow auto/scroll — a table wrapper) or deliberately masked (the ticker marquee).
  const ownClipper = el => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox !== 'visible') return p
    }
    return null
  }
  // 2. clipped content — leaf-ish elements only, so one overflowing parent is not reported N times.
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'path', 'BR'].includes(el.tagName)) continue
    if (el.closest('svg') || el.id === 'wagent' || el.closest('#wagent')) continue // the wandering agent walks off-screen on purpose
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    if (s.position === 'fixed' && s.pointerEvents === 'none') continue // decorative full-screen layers
    const r = el.getBoundingClientRect()
    const off = r.right > vw + 0.5 || r.left < -0.5
    if (!off) continue
    if (ownClipper(el)) continue
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    const control = el.matches('a,button,input,select,textarea,summary')
    if (!hasText && !control) continue
    out.clipped.push(`${name(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`)
  }
  // 3 + 4. header / nav / footer controls.
  const controls = [...document.querySelectorAll('header a, header button, nav a, nav button, footer a, footer button')].filter(visible)
  for (const el of controls) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const hit = cx >= 0 && cx < vw && cy >= 0 && cy < innerHeight ? document.elementFromPoint(cx, cy) : null
    if (!hit || (hit !== el && !el.contains(hit))) out.covered.push(`${name(el)} centre (${Math.round(cx)},${Math.round(cy)}) → ${hit ? name(hit) : 'off-screen'}`)
  }
  window.scrollTo(0, 0)
  // 5. iOS zoom.
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 16) out.zoom.push(`${name(el)} ${fs}px`)
  }
  out.sheets = document.querySelectorAll('dialog, [role=dialog], .sheet, .modal').length
  return out
}

const list = await paths()
const browser = await chromium.launch()
const rows = []
let fails = 0
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await ctx.route('**/*', route => (BEACON.test(route.request().url()) ? route.abort() : route.continue()))
  const page = await ctx.newPage()
  for (const p of list) {
    const res = await page.goto(BASE + p, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts && document.fonts.ready)
    const a = await page.evaluate(audit, w)
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      const slug = p === '/' ? 'hub' : p.replace(/^\/|\/$/g, '').replace(/\//g, '_')
      await page.screenshot({ path: join(SHOTS, `${slug}-${w}x${h}.png`) })
    }
    const bad = (res && res.status() >= 400) || a.sideways || a.clipped.length || a.covered.length || a.small.length || a.zoom.length
    if (bad) fails++
    rows.push({ size: `${w}x${h}`, path: p, status: res ? res.status() : 0, ...a })
  }
  await ctx.close()
}
await browser.close()

for (const r of rows) {
  const f = []
  if (r.status >= 400) f.push(`HTTP ${r.status}`)
  if (r.sideways) f.push(`sideways scroll / zoomed out: scrollWidth ${r.scrollW}, innerWidth ${r.innerW}, device ${r.vw}`)
  if (r.clipped.length) f.push(`clipped: ${r.clipped.join(' | ')}`)
  if (r.covered.length) f.push(`covered: ${r.covered.join(' | ')}`)
  if (r.small.length) f.push(`under 44px: ${r.small.join(' | ')}`)
  if (r.zoom.length) f.push(`iOS zoom: ${r.zoom.join(' | ')}`)
  console.log(`${f.length ? 'FAIL' : 'pass'}  ${r.size}  ${r.path}${f.length ? '\n      ' + f.join('\n      ') : ''}`)
}
const pages = rows.length / SIZES.length
console.log(`\nwalked ${pages} page(s) x ${SIZES.length} size(s) = ${rows.length} renders on ${BASE}; ${fails} failing; inputs checked: ${rows.reduce((n, r) => n + r.zoom.length, 0)} under 16px; sheets/modals present: ${Math.max(0, ...rows.map(r => r.sheets))}`)
process.exit(fails ? 1 : 0)
