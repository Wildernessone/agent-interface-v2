import { defineConfig, devices } from '@playwright/test'

/**
 * E2E for Agent Interface v2.
 * ===========================
 * Runs against a DEPLOYED url (set BASE_URL=https://agent-interface-v2.pages.dev)
 * or, by default, a local dev server it starts itself.
 *
 * Projects:
 *   - public : unauthenticated specs (public.*.spec.js). Run NOW, no creds.
 *   - setup  : logs in once and saves a session (needs TEST_EMAIL/TEST_PASSWORD
 *              + a test account whose BYOK provider keys are set in-app).
 *   - authed : the critical-flow specs (authed.*.spec.js), reusing that session.
 *
 * Run:
 *   npm run e2e:public                      # smoke, no creds (works today)
 *   BASE_URL=https://agent-interface-v2.pages.dev npm run e2e:public
 *   TEST_EMAIL=… TEST_PASSWORD=… npm run e2e   # full suite
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const useDeployed = !!process.env.BASE_URL

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'public', testMatch: /public\..*\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'setup', testMatch: /auth\.setup\.js/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'authed',
      testMatch: /authed\..*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  // When targeting a deployed URL we don't start a server. Locally, boot Vite.
  ...(useDeployed ? {} : {
    webServer: {
      command: 'npm run dev',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  }),
})
