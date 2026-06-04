# E2E (Playwright)

End-to-end tests for the real app — what the `scripts/smoke-*.mjs` unit smokes
can't cover (they don't render the component tree). This is the "does it
actually work" gate (punch-list D1).

## One-time setup
```bash
npm install                      # installs @playwright/test (devDependency)
npx playwright install chromium  # browser binary
```

## Run

**Public smoke (no account needed — works today):**
```bash
npm run e2e:public
# against the deployed app:
BASE_URL=https://agent-interface-v2.pages.dev npm run e2e:public
```

**Full suite (needs a test account + a provider key set in-app):**
```bash
TEST_EMAIL='you@example.com' TEST_PASSWORD='…' \
  BASE_URL=https://agent-interface-v2.pages.dev npm run e2e
```
Without `BASE_URL`, Playwright boots a local `npm run dev` server.

## What's covered
- `public.smoke.spec.js` — app boots, sign-in screen + OAuth + legal links, no console errors. **Runs now.**
- `authed.flows.spec.js` — send→agent responds (A1), build→deliverable shown (A2/A3), Account export+delete, project picker. **Skips without creds.**

## Notes
- `auth.setup.js` logs in once and reuses the session (`e2e/.auth/user.json`, gitignored).
- Selectors use the app's stable CSS classes; verify on the first authenticated run.
- **Tier-gating / trial-downgrade E2E** needs a separate Free/Standard account with `ENFORCE_TIERS` on — deferred with B5 (enforcement is dormant until launch; the primary account is Pro).
