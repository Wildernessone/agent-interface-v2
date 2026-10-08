import { test, expect } from '@playwright/test'
import { page as shell } from '../functions/_site.js'

/* The site chrome on a phone (Grok's phone pass, 2026-10-08, finding #6 + the MINOR tap targets).
   Every page on the reference site renders through page() in functions/_site.js, so the header is ONE
   class of bug: at 375 the four-link nav ran 2px past the screen and at 320 it ran 57px past it, so
   "LIBRARY" could not be reached at all, and every header/nav/footer link was 18-20px tall.

   The shell is rendered here directly (no server): this is the same HTML every SSR route returns.
   ⚠ Measured against the DEVICE width, never innerWidth. With isMobile the layout viewport grows to fit
   overflowing content, so the broken header read innerWidth 377 and scrollWidth 377 at a 320 screen —
   a check against innerWidth reports "no sideways scroll" on exactly the page that has it.
   ⛔ The shell POSTs a page_view beacon to the hub's analytics_events on every load, on any host. It is
   aborted here so a test run never writes a row into the numbers. */

const BEACON = /analytics_events|clarity\.ms|googletagmanager|google-analytics/

async function render(page) {
  await page.route(BEACON, r => r.abort())
  const res = shell({
    title: 'Phone nav fixture',
    desc: 'Fixture',
    path: '/guides/fixture',
    active: '/guides',
    crumbs: [['/', 'Agent Interface'], ['/guides', 'Guides'], ['/guides/fixture', 'A guide with a reasonably long title for a phone']],
    body: '<div class="demo"><div class="bar"><span class="ttl">Mode</span><button class="chip" type="button">Read-only</button><button class="chip on" type="button">Suggest</button></div></div>'
      + '<article><h1>A guide</h1>' + '<p>Body copy. '.repeat(40) + '</p></article>',
  })
  await page.setContent(await res.text(), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

/* Box, and whether the control's own centre is the topmost thing there (not covered, not off-screen). */
async function probe(page, selector) {
  return page.$$eval(selector, els => els.map(el => {
    document.documentElement.style.scrollBehavior = 'auto'
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const hit = document.elementFromPoint(cx, cy)
    return { text: el.textContent.trim(), left: r.left, right: r.right, top: r.top, w: r.width, h: r.height, onTop: !!hit && (hit === el || el.contains(hit)) }
  }))
}

for (const [W, H] of [[320, 568], [375, 667]]) {
  test.describe(`site chrome at ${W}x${H}`, () => {
    test.use({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

    test('no sideways scroll and the page is not zoomed out to fit the header', async ({ page }) => {
      await render(page)
      const m = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }))
      expect(m.inner, `layout viewport grew to ${m.inner} on a ${W} screen`).toBe(W)
      expect(m.scroll).toBeLessThanOrEqual(W)
    })

    test('every nav link is on screen and uncovered (LIBRARY included)', async ({ page }) => {
      await render(page)
      const links = await probe(page, 'header.site nav.main a')
      expect(links.map(l => l.text)).toEqual(['Hub', 'Tracker', 'Guides', 'Library'])
      for (const l of links) {
        expect(l.left, `${l.text} starts off-screen`).toBeGreaterThanOrEqual(0)
        expect(l.right, `${l.text} runs past the ${W}px screen`).toBeLessThanOrEqual(W)
        expect(l.onTop, `${l.text} is covered or unreachable`).toBe(true)
      }
    })

    test('every nav link is at least 44x44', async ({ page }) => {
      await render(page)
      for (const l of await probe(page, 'header.site nav.main a')) {
        expect(l.h, `${l.text} is ${l.h}px tall`).toBeGreaterThanOrEqual(44)
        expect(l.w, `${l.text} is ${l.w}px wide`).toBeGreaterThanOrEqual(44)
      }
    })

    test('the wordmark, breadcrumb, footer links and mode chips are 44px targets and on screen', async ({ page }) => {
      await render(page)
      for (const sel of ['header.site a.wordmark', 'nav.crumbs a', 'footer.site a', 'button.chip']) {
        const links = await probe(page, sel)
        expect(links.length, `${sel} matched nothing`).toBeGreaterThan(0)
        for (const l of links) {
          expect(l.right, `${sel} "${l.text}" runs past the screen`).toBeLessThanOrEqual(W)
          expect(l.onTop, `${sel} "${l.text}" is covered`).toBe(true)
          expect(l.h, `${sel} "${l.text}" is ${l.h}px tall`).toBeGreaterThanOrEqual(44)
          expect(l.w, `${sel} "${l.text}" is ${l.w}px wide`).toBeGreaterThanOrEqual(44)
        }
      }
    })
  })
}

test.describe('site chrome at 1280 (desktop must not change)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('one 56px header row: wordmark then all four links on the same line', async ({ page }) => {
    await render(page)
    const hdr = await page.locator('header.site').boundingBox()
    expect(Math.round(hdr.height)).toBe(57) // 56px row + 1px border, as before the phone fix
    const word = await probe(page, 'header.site a.wordmark')
    const links = await probe(page, 'header.site nav.main a')
    const mid = l => Math.round(l.top + l.h / 2)
    for (const l of links) {
      expect(Math.abs(mid(l) - mid(word[0])), `${l.text} left the wordmark's row`).toBeLessThanOrEqual(2)
      expect(l.left).toBeGreaterThan(word[0].right)
    }
  })
})
