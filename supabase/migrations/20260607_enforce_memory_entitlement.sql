-- Server-side entitlement enforcement for MEMORY.
--
-- agent_memory is the one paid capability that lives in OUR database, so it's
-- the one that can be enforced server-side (unbypassable). TIERS.free.memory =
-- false, but saveMemory was a plain RLS-guarded INSERT — any signed-in user
-- (incl. Free, and anyone editing the client billing object) could persist
-- memory. This trigger rejects agent_memory inserts for an effective-Free user,
-- mirroring enforce_free_tier_limits. During the trial everyone is Pro/Standard,
-- so it only bites genuine Free users after the 20-day trial.
--
-- (Storage saves go client→the user's own Drive, not through our backend, so
-- they can't be gated here; agent/tool per-turn caps stay client-side — see the
-- enforcement notes. Memory + the existing message-count limit are the DB gates.)

create or replace function public.enforce_memory_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.effective_tier(new.user_id) = 'free' then
    raise exception 'memory_not_in_plan'
      using errcode = 'P0001',
            hint = 'Memory is a Standard/Pro feature.';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_memory_enforce_entitlement on public.agent_memory;
create trigger agent_memory_enforce_entitlement
  before insert on public.agent_memory
  for each row execute function public.enforce_memory_entitlement();
