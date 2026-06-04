import { test, expect } from '@playwright/test'

// Unauthenticated smoke — runs today, no creds. Proves the deployed app boots,
// the auth screen renders, and the legal links are wired. This is also the
// canary for "did the deploy serve a broken bundle".
test.describe('public / unauthenticated', () => {
  test('app boots and shows the sign-in screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /agent interface/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    // Two "Sign in" controls exist (the tab toggle + the submit); assert at
    // least one is present.
    await expect(page.getByRole('button', { name: /^sign in$/i }).first()).toBeVisible()
  })

  test('OAuth options are offered', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue with apple/i })).toBeVisible()
  })

  test('terms + privacy links are present', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /terms/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /privacy/i })).toBeVisible()
  })

  test('no console errors on first paint', async ({ page }) => {
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /agent interface/i })).toBeVisible()
    // Allow benign third-party noise; fail on app-level errors only.
    const appErrors = errors.filter(e => !/favicon|analytics|beacon|net::ERR/i.test(e))
    expect(appErrors, appErrors.join('\n')).toHaveLength(0)
  })
})
