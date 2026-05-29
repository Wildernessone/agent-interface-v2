-- Add a metadata jsonb column to usage_events so we can tag events with
-- arbitrary structured context (spend_mode, mode, agent counts, etc)
-- without inventing new event kinds for every dimension we want to track.
--
-- Backfill: every existing row gets {} so jsonb path queries don't break.

alter table public.usage_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- GIN index on metadata so we can filter on metadata->>'spend_mode' fast
-- (used by the analytics view that asks "what % of turns are frugal?")
create index if not exists idx_usage_events_metadata
  on public.usage_events using gin (metadata);
