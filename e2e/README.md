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
- `authed.suggestions.spec.js` — state-aware suggested prompts render in the empty state and a click acts. **Skips without creds.**
- `authed.voice.spec.js` — voice mid-session badge ON/OFF. **Skips without creds.**

## CI gate
`.github/workflows/ci.yml` runs on every push/PR to `main`: **build → `npm run smoke:all` (all 16 deterministic, network-mocked smokes) → `npm run e2e:public` (Playwright) → lint (non-blocking)**. The public E2E boots Vite itself with a dummy `.env` (the landing/login routes don't need a live backend). Authed flows are NOT in the push gate — they need a test account; run them manually (above) or wire `TEST_EMAIL`/`TEST_PASSWORD` secrets into a scheduled job. `smoke:live` stays manual (real paid APIs).

## Notes
- `auth.setup.js` logs in once and reuses the session (`e2e/.auth/user.json`, gitignored).
- Selectors use the app's stable CSS classes; verify on the first authenticated run.
- **Tier-gating / trial-downgrade E2E** needs a separate Free/Standard account with `ENFORCE_TIERS` on — deferred with B5 (enforcement is dormant until launch; the primary account is Pro).
