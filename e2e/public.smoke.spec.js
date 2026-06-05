import { test, expect } from '@playwright/test'

// Unauthenticated smoke — runs without creds. Verifies the landing renders at /
// and the sign-in screen is reachable at /login. Also the deploy canary (a
// broken bundle throws on first paint).
test.describe('public / unauthenticated', () => {
  test('landing renders at /', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /one interface/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /start 20-day free trial|start free trial/i }).first()).toBeVisible()
  })

  test('landing shows the panel + pricing sections', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /disagreement is the feature/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /start with everything/i })).toBeVisible()
    // loss-aversion pricing order puts Pro ($25) first
    await expect(page.getByText('$25').first()).toBeVisible()
  })

  test('sign-in screen reachable at /login', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^sign in$/i }).first()).toBeVisible()
  })

  test('no console errors on first paint', async ({ page }) => {
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /one interface/i })).toBeVisible()
    const appErrors = errors.filter(e => !/favicon|analytics|beacon|net::ERR|fonts\.googleapis/i.test(e))
    expect(appErrors, appErrors.join('\n')).toHaveLength(0)
  })
})
