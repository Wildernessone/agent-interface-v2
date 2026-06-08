# Agent Interface — Mobile App Launch Roadmap

Turning the web app (React/Vite SPA on Cloudflare Pages, BYOK, Stripe web billing)
into paid iOS + Android apps. Recommended path: **Capacitor** (wrap the existing
web app in a native shell — one codebase, real store binaries, native APIs).

Status today: PWA foundation shipped (manifest, service worker, icons); no
Capacitor yet; video render is ffmpeg.wasm. Tiers: Free / Standard $10 / Pro $25.

---

## ⚠️ Phase 0 — The two decisions that gate everything

### 0a. Payments (the big one)
Apple **and** Google require their in-app purchase systems for digital
subscriptions consumed in the app, and take **15–30%**. **Your Stripe web
checkout will likely fail iOS review** for the Pro/Standard subscription.

- **Recommended: RevenueCat** + StoreKit (iOS) / Play Billing (Android). RevenueCat
  is the standard cross-platform IAP layer — handles receipts, entitlements, and
  cross-store sync, and can mirror entitlements to your backend via webhooks
  (so `user_settings.subscription_tier` stays the source of truth either way).
- Run **two billing systems**: Stripe on web, IAP in-app. RevenueCat → webhook →
  the same `user_settings` row your `effective_tier()` already reads. Minimal DB
  change — you already have the tier/trial machinery.
- **BYOK helps your case:** users pay the AI providers directly; the only thing
  *you* charge for is orchestration. That's the piece Apple wants its cut of —
  there's no clean way around IAP for it if the app gates Pro features.
- The 15-day Pro / 5-day Standard **trial already exists** and maps to store
  intro-offer / free-trial mechanics.

**Decision needed:** adopt RevenueCat + IAP (recommended), or attempt
external-purchase entitlement (regional, friction), before building.

### 0b. Developer accounts (start now — D-U-N-S has lead time)
- **Apple Developer Program** — $99/yr. Register under the **LLC** (org account
  needs the EIN **+ a D-U-N-S number** — request free from Dun & Bradstreet; can
  take several business days to a couple weeks). Start the D-U-N-S request first.
- **Google Play Console** — $25 one-time, org account.
- Android is faster + more lenient → **launch Android first.**

---

## Phase 1 — Capacitor scaffold (~1 day)
1. `npm i @capacitor/core @capacitor/cli && npx cap init` (appId e.g.
   `app.agentinterface`, appName "Agent Interface").
2. `npm i @capacitor/ios @capacitor/android && npx cap add ios android`.
3. Build web (`vite build`) → `npx cap copy` (bundles `dist/` into the native
   apps). Run on simulator/emulator: `npx cap run ios|android`.
4. Decide **bundled vs remote**: bundle `dist/` (offline-capable, store-update
   cadence) — recommended — vs `server.url` pointing at agentinterface.app
   (instant updates but more "thin wrapper" review risk). Start bundled.

## Phase 2 — Make it actually work in the webview (the real work)
These are the non-obvious blockers specific to *this* app:

- **OAuth redirects break in native.** Drive/Dropbox/Reddit + Supabase OAuth use
  `redirectTo: window.location.origin`. In Capacitor the origin is
  `capacitor://localhost` / `https://localhost`, which Google etc. won't accept.
  → Implement deep links (custom URL scheme / Universal Links + Android App
  Links) and use `@capacitor/browser` for the OAuth hop, then catch the callback
  via `App.addListener('appUrlOpen')`. Add the native redirect URIs to each
  provider's console + Supabase Auth redirect allow-list. **Budget real time here.**
- **The proxy worker CORS will block the app.** I just set `ALLOWED_ORIGINS`
  fail-closed to agentinterface.app + pages.dev + localhost. The native webview's
  Origin is `capacitor://localhost` / `https://localhost` → blocked. Fix: either
  add the Capacitor origins to `ALLOWED_ORIGINS`, or use `@capacitor/http` /
  CapacitorHttp (native HTTP, bypasses webview CORS) for proxy calls. Decide one.
- **Email confirmation / Resend** (the pending `todo-resend-email-setup`) matters
  more on mobile — deep-link the confirmation link back into the app.
- **Safe areas, status bar, keyboard** — `@capacitor/status-bar`,
  `@capacitor/keyboard`, CSS `env(safe-area-inset-*)`.

## Phase 3 — Native polish & "minimum functionality" (avoid 4.2 rejection)
Apple rejects thin web wrappers (guideline 4.2). Add native value:
- Push notifications (`@capacitor/push-notifications` + FCM/APNs) — e.g. "your
  build finished."
- Native share / save (`@capacitor/share`, `@capacitor/filesystem`) for the
  generated decks/videos.
- App icon + splash (`@capacitor/assets` generates all sizes from your existing
  launch icon).
- Optional: biometric app lock, haptics.

## Phase 4 — Native ffmpeg (perf upgrade, can ship after v1)
ffmpeg.wasm is slow in a mobile webview (and the module-worker/blob path is
fragile — see the ESM core fix). Swap to a native ffmpeg Capacitor plugin for
on-device video composition (in your brief). The web keeps ffmpeg.wasm as
fallback. Not a launch blocker — ship video as-is first if needed.

## Phase 5 — Store submission
- **Android (Play, first):** internal testing track → closed → production.
  Data safety form (you store conversations/projects/memory in Supabase; BYOK
  keys encrypted; declare accurately). Content rating questionnaire.
- **iOS (TestFlight → App Store):** Apple **privacy nutrition labels** (be
  precise: data stored, not sold, BYOK keys encrypted, AI-generated content),
  App Privacy details, and an account-deletion path (you have one — Settings →
  Account). Note AI/UGC content moderation expectations.
- Store assets both: screenshots per device size, description, keywords, support
  URL, marketing URL (agentinterface.app), privacy policy URL (`/privacy.html`).

---

## Suggested order & rough effort
1. Phase 0 decisions + accounts/D-U-N-S — **start today** (admin lead time)
2. Capacitor scaffold — ~1 day
3. OAuth deep links + worker CORS for native — **the real engineering**, a few days
4. Native polish for 4.2 — 1–2 days
5. Android internal-testing build → iterate
6. iOS TestFlight → submit
7. Native ffmpeg — post-launch

**Biggest risks:** (1) IAP/payments compliance, (2) OAuth-in-native rework,
(3) Apple 4.2 thin-wrapper rejection. None are blockers — all are known and
have standard solutions. The web app being solid (which it now is) is 70% of it.

## First concrete coding step when ready
`npx cap init` + add iOS/Android + get the existing build running on an emulator
— I can do that in one pass whenever you want to start.
