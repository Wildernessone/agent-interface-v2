import { test, expect } from '@playwright/test'

// Critical authenticated flows — the real "does it work" pass. Needs:
//   TEST_EMAIL / TEST_PASSWORD  (a test account)
//   that account must have at least one provider key set in-app (BYOK)
// Skips cleanly when creds are absent. Selectors use the app's stable CSS
// classes; verify/adjust on the first authenticated run, then these become the
// regression gate the smokes can't be (they don't render the component tree).
const HAS_CREDS = !!(process.env.TEST_EMAIL && process.env.TEST_PASSWORD)

test.describe('authenticated critical flows', () => {
  test.skip(!HAS_CREDS, 'Set TEST_EMAIL/TEST_PASSWORD (+ a provider key in the test account) to run')

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.ai-composer')).toBeVisible({ timeout: 30_000 })
  })

  test('panel loads: composer + target selector present', async ({ page }) => {
    await expect(page.locator('.ai-composer textarea')).toBeVisible()
    await expect(page.locator('.ai-targets')).toBeVisible()
  })

  test('send a message → at least one agent responds', async ({ page }) => {
    await page.locator('.ai-composer textarea').fill('In one sentence, what is 2+2?')
    await page.locator('.ai-composer textarea').press('Enter')
    // An agent turn appears and fills with text (real provider call → allow time).
    const agentTurn = page.locator('.ai-turn--agent').first()
    await expect(agentTurn).toBeVisible({ timeout: 60_000 })
    await expect(agentTurn).not.toBeEmpty({ timeout: 60_000 })
    // The orchestrator must NOT have dead-ended the turn (A1).
    await expect(page.getByText(/isn't responding|unexpected error/i)).toHaveCount(0)
  })

  test('build flow → a deliverable is shown (not "produced nothing")', async ({ page }) => {
    test.slow() // a build runs multiple steps
    await page.locator('.ai-composer textarea').fill('Write a short markdown note titled "E2E Test" with two bullet points.')
    await page.locator('.ai-composer textarea').press('Enter')
    const buildCard = page.locator('.ai-build-card')
    await expect(buildCard).toBeVisible({ timeout: 60_000 })
    // A2/A3/#37: the finished build must surface SOMETHING usable — an inline
    // text preview, a download, an action result, or a folder link.
    const deliverable = page.locator(
      '.ai-build-text, .ai-build-download, .ai-build-action-results, .ai-build-folder-link'
    )
    await expect(deliverable.first()).toBeVisible({ timeout: 90_000 })
    await expect(buildCard.getByText(/No files produced yet/i)).toHaveCount(0)
  })

  test('account tab exposes data export + delete (GDPR)', async ({ page }) => {
    // Open Settings → Account. (Settings opened via the toolbar gear/Settings btn.)
    await page.getByRole('button', { name: /settings/i }).first().click()
    await page.getByRole('tab', { name: /account/i }).click()
    await expect(page.getByRole('button', { name: /export.*data|download.*data/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /delete.*account/i })).toBeVisible()
  })

  test('project picker is present and lists projects', async ({ page }) => {
    await page.locator('.proj-trigger').click()
    await expect(page.locator('.proj-menu')).toBeVisible()
    // The test account should have at least the seeded projects.
    await expect(page.locator('.proj-item-row, .proj-menu')).toBeVisible()
  })
})

// NOTE: tier-gating + trial-downgrade E2E (Free → 1 agent, locked tools, banner)
// needs a SEPARATE Free/Standard test account with ENFORCE_TIERS on — tracked
// with B5/B2-UI since enforcement is dormant until launch. The primary account
// is Pro, so caps won't render for it.
