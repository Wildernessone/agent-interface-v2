# Agent Interface v2 — Stripe go-live checklist

Branch: `feat/billing-upsert-hardening` (worktree `~/worktrees/agent-interface-v2/feat/billing-upsert-hardening`).
**v2 uses its OWN plain Stripe account — NO Connect** (users pay you directly; this is a SaaS
subscription, not a marketplace). Separate from Wilderness (SideWRK) per the per-brand-separation plan.
Pricing (already in code): **Standard $10/mo · Pro $25/mo**, 20-day trial (Pro days 0–14, Standard 15–19,
Free 20+). BYOK means the subscription gates **capability** (agents/tools/memory/storage), not inference.

## Already built (no work needed)
- Edge functions: `create-checkout-session`, `create-portal-session`, `stripe-webhook` (`supabase/functions/`)
- Tier/trial schema on `user_settings` (`subscription_tier/status`, `stripe_customer_id/subscription_id`,
  `subscription_period_end`, `trial_starts_at`) + `effective_tier()` + free-tier usage trigger
- Client gating (`src/utils/entitlements.js`, `tier.js`, `config/tiers.js`), AccountTab UI, post-checkout poll

## Changed this session (committed on this branch)
- **Webhook hardening** (`stripe-webhook`): `applySub` now **upserts** `user_settings` on `user_id` instead
  of update — a user who upgrades before ever saving a setting has no row, and a plain update silently
  no-ops → *paid but stuck on free*. (Only `user_id` is NOT NULL; all else defaults, so upsert is safe.)
- **Checkout hardening** (`create-checkout-session`): caches `stripe_customer_id` via upsert too, so a
  rowless new user doesn't mint a fresh Stripe customer on every checkout attempt.

## Your go-live steps
1. **Create a separate Stripe account** for Agent Interface (plain account, no Connect needed).
2. **Create two recurring Prices** (USD/month): Standard **$10**, Pro **$25**. Note the `price_…` ids.
3. **Set Supabase secrets** on project `oqbpuspnmznqxgkmyzyb`:
   ```
   supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_xxx \
     STRIPE_WEBHOOK_SECRET=whsec_xxx \
     STRIPE_PRICE_STANDARD=price_xxx \
     STRIPE_PRICE_PRO=price_xxx \
     --project-ref oqbpuspnmznqxgkmyzyb
   ```
4. **Deploy the edge functions** (webhook MUST skip JWT; the other two verify the user's JWT themselves):
   ```
   supabase functions deploy create-checkout-session --project-ref oqbpuspnmznqxgkmyzyb
   supabase functions deploy create-portal-session   --project-ref oqbpuspnmznqxgkmyzyb
   supabase functions deploy stripe-webhook --no-verify-jwt --project-ref oqbpuspnmznqxgkmyzyb
   ```
5. **Register the webhook** in the v2 Stripe dashboard →
   URL `https://oqbpuspnmznqxgkmyzyb.supabase.co/functions/v1/stripe-webhook`
   Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
   → copy the signing secret into `STRIPE_WEBHOOK_SECRET` (step 3).
6. **Configure the Customer Portal** (Billing → Customer portal): enable cancel + plan switching between
   the Standard/Pro prices (the "Manage billing" button uses it).
7. **Turn on the free daily-message cap** when ready: in `src/utils/telemetry.js`, `FREE_DAILY_MESSAGES`
   is `Infinity` (paywall soft-off). Set a positive number to enforce the free-tier daily limit. (The
   capability caps — agents/tools/memory/storage — are already active via the trial clock.)
8. Deploy the app (Cloudflare Pages from `main` after merge). No new frontend env vars — the upgrade
   buttons call `create-checkout-session`, which returns `invalid_tier` until the prices exist.

## Decide before charging (NOT done here)
- **Server-side entitlement enforcement** — today the agents/tools caps are applied client-side in the
  send path (`entitlements.js`); a technical user could bypass them by calling the `claude-proxy` worker
  directly. The worker already verifies the Supabase JWT, so the clean fix is to read `subscription_tier`
  there and cap agents/tools server-side. This is the one real integrity gap; it's a worker change (touches
  the AI-proxy path) so I left it for an explicit go-ahead. Until then the paywall is bypassable.
- **Mobile (iOS/Android)** — Apple/Google require IAP; plan is RevenueCat syncing to the same
  `user_settings.subscription_tier`. Web Stripe (this doc) is independent of that.

## Smoke test (test mode first, or a refundable card)
- Upgrade from AccountTab → Checkout → pay → webhook upserts `subscription_tier`/`status=active`; the app
  polls `loadSettings` post-redirect until active. "Manage billing" opens the portal. Cancel →
  `customer.subscription.deleted` → back to `free`.
