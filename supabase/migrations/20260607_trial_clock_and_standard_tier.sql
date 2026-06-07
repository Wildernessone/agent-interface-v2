-- Trial clock + Standard tier — make the DB enforce what the client already
-- models in src/utils/tier.js (Pro days 1–15, Standard 16–20, Free 21+).
--
-- ⚠️  REVIEW BEFORE APPLYING. Changes a CHECK constraint and the free-tier
-- enforcement trigger on the live DB (oqbpuspnmznqxgkmyzyb). Apply via the
-- Supabase SQL editor or `supabase db push` after review — NOT auto-applied.
--
-- Fixes three launch bugs the audit + data surfaced:
--   • subscription_tier CHECK lacked 'standard' → every Standard subscription
--     write threw, the webhook 500'd, the paid user stayed Free.
--   • trial_starts_at was read by the client but never created/written → every
--     user looked like a permanent "fresh Pro" to tier.js.
--   • the DB free-tier trigger ignored the trial entirely → a brand-new
--     (subscription_tier='free') user was capped at 20 msg/day from day one,
--     breaking the advertised 20-day trial.

-- 1. Allow 'standard'.
alter table public.user_settings
  drop constraint if exists user_settings_subscription_tier_check;
alter table public.user_settings
  add constraint user_settings_subscription_tier_check
    check (subscription_tier in ('free', 'standard', 'pro'));

-- 2. Trial anchor. Default now() anchors at row creation (≈ signup); the
--    backfill gives existing rows a trial window too.
alter table public.user_settings
  add column if not exists trial_starts_at timestamptz not null default now();

-- 3. Effective tier — a paid active subscription wins, else the trial clock.
--    Mirrors src/utils/tier.js (proDays=15, standardEndsDay=20).
create or replace function public.effective_tier(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.subscription_status = 'active'
         and s.subscription_tier in ('pro', 'standard') then s.subscription_tier
    when extract(epoch from (now() - coalesce(s.trial_starts_at, now()))) / 86400 < 15 then 'pro'
    when extract(epoch from (now() - coalesce(s.trial_starts_at, now()))) / 86400 < 20 then 'standard'
    else 'free'
  end
  from public.user_settings s
  where s.user_id = p_user_id
$$;

-- 4. current_tier() returns the EFFECTIVE tier now (was raw subscription_tier,
--    which ignored the trial clock).
create or replace function public.current_tier()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.effective_tier(auth.uid()), 'free')
$$;

-- 5. Free-tier daily limit respects the trial: during the 20-day trial
--    (effective pro OR standard) there is no message cap; only a genuine Free
--    user (trial expired, no paid sub) hits the 20/day limit.
--    NOTE for review: this treats Standard as uncapped on message COUNT — the
--    Standard/Pro difference is enforced as agent/tool caps client-side
--    (config/tiers.js), not as a daily message limit. Confirm that's intended
--    before applying if you later want a separate Standard message cap.
create or replace function public.enforce_free_tier_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tier text;
  used integer;
  daily_limit integer := 20;
begin
  tier := public.effective_tier(new.user_id);

  if tier in ('pro', 'standard') then
    return new;
  end if;

  if new.kind = 'agent_message' then
    select count(*) into used
    from public.usage_events
    where user_id = new.user_id
      and kind = 'agent_message'
      and created_at >= date_trunc('day', now());

    if used >= daily_limit then
      raise exception 'free_tier_daily_limit_reached'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
