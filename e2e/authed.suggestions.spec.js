import { test, expect } from '@playwright/test'
import { agentConnected, NO_AGENT_SKIP } from './_helpers'

// Coverage for the state-aware suggested prompts + project-brief auto-detect
// (shipped 2026-06-05). Both surfaces live behind login, so they're gated on
// the same creds as the other authed flows and skip cleanly without them.
//
// Kept deterministic: we assert the empty-state suggestions RENDER (the feature
// wiring) without depending on WHICH bucket shows or on a live classifier call —
// those depend on the test account's history and would be flaky/costly.
const HAS_CREDS = !!(process.env.TEST_EMAIL && process.env.TEST_PASSWORD)

test.describe('suggested prompts + project-brief detection', () => {
  test.skip(!HAS_CREDS, 'Set TEST_EMAIL/TEST_PASSWORD (+ a provider key in the test account) to run')

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.ai-composer')).toBeVisible({ timeout: 30_000 })
  })

  test('empty state renders state-aware suggested prompts', async ({ page }) => {
    // Suggestions only render once an agent is connected (otherwise the empty
    // state shows the onboarding "connect an agent" panel instead).
    test.skip(!(await agentConnected(page)), NO_AGENT_SKIP)
    // A fresh thread shows the empty state with at least one suggestion card.
    await expect(page.locator('.ai-empty')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.sp-card').first()).toBeVisible()
    // Each card carries an icon + a label (the shape SuggestedPrompts renders).
    await expect(page.locator('.sp-card .sp-label').first()).toBeVisible()
  })

  test('clicking a suggestion acts (populates composer or starts a turn)', async ({ page }) => {
    test.skip(!(await agentConnected(page)), NO_AGENT_SKIP)
    await expect(page.locator('.ai-empty')).toBeVisible({ timeout: 30_000 })
    const card = page.locator('.sp-card').first()
    await expect(card).toBeVisible()
    await card.click()
    // A click does exactly one of: fills the composer (starter populate), starts
    // a turn (continue/example auto-send), or opens Settings (setup cards like
    // "Connect Drive" route to a settings surface). Any of the three means it
    // acted — poll until one is true (state updates aren't synchronous).
    await expect(async () => {
      const filled = (await page.locator('.ai-composer textarea').inputValue()).trim().length > 0
      const started = (await page.locator('.ai-turn--user, .ai-claw').count()) > 0
      const settings = (await page.locator('.settings-dialog').count()) > 0
      expect(filled || started || settings).toBeTruthy()
    }).toPass({ timeout: 10_000 })
  })
})
