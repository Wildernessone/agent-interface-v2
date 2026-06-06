import { test, expect } from '@playwright/test'
import { agentConnected, NO_AGENT_SKIP } from './_helpers'

// Voice mid-session toggle (Step 2). Headless can't assert audio, so this
// verifies the visible UX contract: toggling voice ON while a response is in
// flight shows the "activates next message" badge (priming + the live-read fix
// are exercised by the same path). Skips without creds.
const HAS_CREDS = !!(process.env.TEST_EMAIL && process.env.TEST_PASSWORD)

test.describe('voice mid-session', () => {
  test.skip(!HAS_CREDS, 'Set TEST_EMAIL/TEST_PASSWORD (+ a provider key) to run')

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.ai-composer')).toBeVisible({ timeout: 30_000 })
  })

  test('toggling voice ON mid-response shows the "next message" badge', async ({ page }) => {
    test.skip(!(await agentConnected(page)), NO_AGENT_SKIP)
    await page.locator('.ai-composer textarea').fill('Write three short sentences about coffee.')
    await page.locator('.ai-composer textarea').press('Enter')
    // While the panel is responding, flip voice on — the badge should appear
    // (it only shows when a response is in flight).
    await page.getByRole('button', { name: /voice mode off/i }).click()
    await expect(page.getByText(/voice activates next message/i)).toBeVisible({ timeout: 8000 })
  })

  test('toggling voice OFF clears the badge immediately', async ({ page }) => {
    test.skip(!(await agentConnected(page)), NO_AGENT_SKIP)
    await page.locator('.ai-composer textarea').fill('Name two coffee origins.')
    await page.locator('.ai-composer textarea').press('Enter')
    await page.getByRole('button', { name: /voice mode off/i }).click()
    await expect(page.getByText(/voice activates next message/i)).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /voice mode on/i }).click()
    await expect(page.getByText(/voice activates next message/i)).toHaveCount(0)
  })
})
