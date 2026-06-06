# E4 — Cohort Launch & Telemetry Watch

The go-live runbook for opening Agent Interface to a first cohort and watching
whether it actually works. Grounded in what the app emits: rich `usage_events`
(this project's DB), lightweight `analytics_events` → the hub → Command Center,
and Sentry. Since Stripe isn't wired yet, E4 validates **does it work + do they
come back**, not revenue.

Live telemetry surface: **Command Center → Launch tab** (reads the
`launch_metrics` RPC below). Support mail: **Command Center → Support**.

---

## Phase 0 — Pre-flight
- [ ] CI green on `main` (build + smokes + public E2E)
- [ ] Authed E2E green against a keyed account (14/14)
- [ ] claude-proxy worker live with `dall-e-3` default + grok-4.3 fallback + `/refresh_google`
- [ ] Support reachable both ways — email `support@agentinterface.app` **and** the in-app Help-drawer form → both land in Command Center → Support
- [ ] Legal live: `/terms.html`, `/privacy.html` (CA governing law)
- [ ] Sentry receiving — confirm `VITE_SENTRY_DSN` set in the **Production** Pages env; throw a test error and see it land
- [ ] Cloudflare API tokens rolled (any pasted during setup)
- [ ] Trial expectation set: cohort gets **Pro days 1–15**, Standard 16–20, Free 21+

## Phase 1 — Define the cohort
- [ ] Small: 5–15 people who'll actually use it and give feedback
- [ ] They must bring their own API key (BYOK) — pre-warn; this is the #1 drop-off
- [ ] No invite gating exists; control is word-of-mouth (add a waitlist/code if you want a harder gate)
- [ ] Send a short "add your first key + what the panel does" note

## Phase 2 — Metrics that matter
| Signal | Where | Healthy |
|---|---|---|
| Activation (% signups who get a real agent reply) | Launch tab · `activated_users` | most signups |
| Agent-message success rate | Launch tab · `agent_messages.rate` | high (>90%) |
| Build-step success rate | Launch tab · `build_steps.rate` | high |
| Provider success mix | Launch tab · by-provider | no provider lagging badly |
| Orchestrator fallbacks | Launch tab · `orchestrator_fallbacks` | rare |
| Exceptions | Sentry | flat, no recurring stack |
| Traffic / logins / feature use | Command Center · Traffic/Products/Engagement | rising, repeat logins |
| Support volume | Command Center · Support | low, and replied to |

## Phase 3 — Launch-day runbook
- [ ] Invite in one small wave
- [ ] Watch Sentry live the first hour
- [ ] Spot-check the Launch tab after the first signups (agent/build success true?)
- [ ] Keep Support tab open
- [ ] Rollback ready: CF Pages → instant rollback to the prior deployment

## Phase 4 — Daily watch (first 1–2 weeks)
- [ ] Sentry new issues; top `error_type`; new support messages
- [ ] Activation trend — are people getting past key setup?
- [ ] Log every "stuck at X" (BYOK key setup is the likely wall)
- [ ] Watch day 15 (Pro→Standard) and day 20 (→Free) for cap reactions

## Phase 5 — Go / no-go for wider launch
- [ ] Activation ≥ your bar, build + agent success high, Sentry quiet
- [ ] Support themes addressed
- [ ] Then wire Stripe (B5/B6) before charging

---

## Copy-paste SQL (run against this project — `oqbpuspnmznqxgkmyzyb`)

The Command Center Launch tab calls `launch_metrics(p_days)`, which wraps these.
Run them directly in the Supabase SQL editor for ad-hoc digging. Adjust the
`14` day window as needed.

```sql
-- Activation: signups that reached a real agent reply, vs all active users
select
  count(distinct user_id)                                            as active_users,
  count(distinct user_id) filter (where kind='agent_message' and success) as activated_users
from usage_events
where created_at >= now() - interval '14 days';
```

```sql
-- Agent-message success rate
select count(*) as total,
       count(*) filter (where success) as ok,
       round(100.0*count(*) filter (where success)/nullif(count(*),0)) as pct
from usage_events
where kind='agent_message' and created_at >= now() - interval '14 days';
```

```sql
-- Build-step success rate (tool_call rows)
select count(*) as total,
       count(*) filter (where success) as ok,
       round(100.0*count(*) filter (where success)/nullif(count(*),0)) as pct
from usage_events
where kind='tool_call' and created_at >= now() - interval '14 days';
```

```sql
-- Error mix (what's actually failing)
select error_type, count(*) as n
from usage_events
where success=false and error_type is not null
  and created_at >= now() - interval '14 days'
group by error_type order by n desc;
```

```sql
-- Agent-message success by provider (catches a single provider degrading)
select provider, count(*) as n,
       round(100.0*count(*) filter (where success)/nullif(count(*),0)) as pct
from usage_events
where kind='agent_message' and provider is not null
  and created_at >= now() - interval '14 days'
group by provider order by n desc;
```

```sql
-- Orchestrator fallbacks (smart routing briefly unavailable)
select count(*) from usage_events
where kind='orchestrate' and error_type='orchestrator_fallback'
  and created_at >= now() - interval '14 days';
```

---

## Known gaps E4 will likely expose
- **BYOK onboarding friction** — no key = empty product. A guided first-run
  walkthrough (connect a key → enable agents → first message → connect Drive) is
  the highest-leverage pre-launch polish.
- **No invite gating** — anyone with the URL can sign up.
- **Sentry env** — verify the DSN is set in Production, or errors go unseen.
