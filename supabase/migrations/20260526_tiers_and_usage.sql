-- Tier model + usage tracking
-- Run this in the Supabase SQL editor (or via `supabase db push` locally).

-- 1. Subscription tier on user_settings
alter table public.user_settings
  add column if not exists subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro'));

alter table public.user_settings
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_period_end timestamptz;

create index if not exists idx_user_settings_stripe_customer
  on public.user_settings(stripe_customer_id);

-- 2. Usage events — every model call, every tool call
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('agent_message', 'tool_call', 'orchestrate')),
  provider text not null,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_cents integer not null default 0,
  success boolean not null default true,
  error_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user_created
  on public.usage_events(user_id, created_at desc);

create index if not exists idx_usage_events_user_kind_created
  on public.usage_events(user_id, kind, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "users read own usage" on public.usage_events;
create policy "users read own usage" on public.usage_events
  for select using (auth.uid() = user_id);

drop policy if exists "users insert own usage" on public.usage_events;
create policy "users insert own usage" on public.usage_events
  for insert with check (auth.uid() = user_id);

-- 3. Daily usage rollup view — used by tier enforcement
create or replace view public.user_usage_today as
select
  user_id,
  count(*) filter (where kind = 'agent_message') as messages_today,
  count(*) filter (where kind = 'tool_call') as tool_calls_today,
  sum(tokens_out) as tokens_out_today
from public.usage_events
where created_at >= date_trunc('day', now())
group by user_id;

-- 4. Helper: current tier for the calling user
create or replace function public.current_tier()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(subscription_tier, 'free')
  from public.user_settings
  where user_id = auth.uid()
$$;

-- 5. Free-tier daily limits enforced at insert
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
  select coalesce(subscription_tier, 'free') into tier
  from public.user_settings where user_id = new.user_id;

  if tier = 'pro' then
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

drop trigger if exists usage_events_enforce_limits on public.usage_events;
create trigger usage_events_enforce_limits
  before insert on public.usage_events
  for each row execute function public.enforce_free_tier_limits();

-- 6. Drop the suno_key column if it still exists (mentioned in earlier cleanup)
alter table public.user_api_keys drop column if exists suno_key;
alter table public.user_api_keys drop column if exists playht_key;
alter table public.user_api_keys drop column if exists udio_key;
alter table public.user_api_keys drop column if exists runway_key;
