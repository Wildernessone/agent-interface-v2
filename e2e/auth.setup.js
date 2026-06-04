import { test as setup, expect } from '@playwright/test'
import fs from 'fs'

// Logs in once and persists the session for the `authed` project. Always writes
// the state file (even logged-out, when no creds) so the authed project can
// load — those specs skip themselves when creds are absent.
const authFile = 'e2e/.auth/user.json'
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD

setup('authenticate', async ({ page, context }) => {
  fs.mkdirSync('e2e/.auth', { recursive: true })

  if (!EMAIL || !PASSWORD) {
    // No creds — save an empty (logged-out) state. authed.* specs skip.
    await context.storageState({ path: authFile })
    return
  }

  await page.goto('/')
  await page.getByRole('textbox', { name: /email/i }).fill(EMAIL)
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD)
  await page.getByRole('button', { name: /^sign in$/i }).click()

  // Past the login screen → the composer's "To" target row is visible.
  await expect(page.locator('.ai-composer')).toBeVisible({ timeout: 30_000 })
  await context.storageState({ path: authFile })
})
