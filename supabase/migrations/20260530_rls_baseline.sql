-- RLS baseline — capture the live security state in version control.
--
-- WHY THIS EXISTS
-- Every public table in the live project (oqbpuspnmznqxgkmyzyb) already has
-- RLS enabled with correct per-owner policies, but the DDL for most of those
-- tables/policies was applied via the dashboard and never committed. A fresh
-- `supabase db push` to a new project would therefore create UNPROTECTED
-- tables. This migration makes the repo the source of truth: running it against
-- the current DB is a no-op; running it against a fresh DB reproduces the same
-- protection.
--
-- WHAT IT DOES
--   1. Enables RLS on all 11 public tables.
--   2. (Re)creates the canonical `<table>_own_<cmd>` owner policies.
--   3. Drops two legacy duplicate policies on usage_events
--      ("users read own usage" / "users insert own usage") that were superseded
--      by the `usage_events_own_*` pair — they are functionally identical, so
--      removing them only consolidates naming.
--
-- SAFETY
--   - Idempotent: every policy is dropped-if-exists before being recreated.
--   - It does NOT create the tables themselves (they already exist and their
--     column DDL lives in the earlier migrations / dashboard). It only governs
--     access control.
--   - The policy bodies below match the live DB verbatim: every check is
--     `auth.uid() = user_id`, PERMISSIVE, role `public`.

-- Helper note on command coverage (mirrors live state exactly):
--   SELECT+INSERT+UPDATE+DELETE : agent_memory, conversations, projects,
--                                 prompt_library, storage_connections
--   SELECT+INSERT+DELETE        : project_files, role_outcomes, turns
--   SELECT+INSERT+UPDATE        : user_api_keys, user_settings
--   SELECT+INSERT               : usage_events  (append-only audit log)
-- NOTE: `turns` has no user_id column — it is scoped through its parent
--   `conversations` row via an EXISTS subquery (see section 9).

-- ── 1. Enable RLS on every public table ──────────────────────────────
alter table public.agent_memory          enable row level security;
alter table public.conversations         enable row level security;
alter table public.project_files         enable row level security;
alter table public.projects              enable row level security;
alter table public.prompt_library        enable row level security;
alter table public.role_outcomes         enable row level security;
alter table public.storage_connections   enable row level security;
alter table public.turns                 enable row level security;
alter table public.usage_events          enable row level security;
alter table public.user_api_keys         enable row level security;
alter table public.user_settings         enable row level security;

-- ── 2. agent_memory (SELECT/INSERT/UPDATE/DELETE) ────────────────────
drop policy if exists agent_memory_own_read   on public.agent_memory;
create policy agent_memory_own_read   on public.agent_memory for select using (auth.uid() = user_id);
drop policy if exists agent_memory_own_insert on public.agent_memory;
create policy agent_memory_own_insert on public.agent_memory for insert with check (auth.uid() = user_id);
drop policy if exists agent_memory_own_update on public.agent_memory;
create policy agent_memory_own_update on public.agent_memory for update using (auth.uid() = user_id);
drop policy if exists agent_memory_own_delete on public.agent_memory;
create policy agent_memory_own_delete on public.agent_memory for delete using (auth.uid() = user_id);

-- ── 3. conversations (SELECT/INSERT/UPDATE/DELETE) ───────────────────
drop policy if exists conversations_own_read   on public.conversations;
create policy conversations_own_read   on public.conversations for select using (auth.uid() = user_id);
drop policy if exists conversations_own_insert on public.conversations;
create policy conversations_own_insert on public.conversations for insert with check (auth.uid() = user_id);
drop policy if exists conversations_own_update on public.conversations;
create policy conversations_own_update on public.conversations for update using (auth.uid() = user_id);
drop policy if exists conversations_own_delete on public.conversations;
create policy conversations_own_delete on public.conversations for delete using (auth.uid() = user_id);

-- ── 4. project_files (SELECT/INSERT/DELETE) ──────────────────────────
drop policy if exists project_files_own_read   on public.project_files;
create policy project_files_own_read   on public.project_files for select using (auth.uid() = user_id);
drop policy if exists project_files_own_insert on public.project_files;
create policy project_files_own_insert on public.project_files for insert with check (auth.uid() = user_id);
drop policy if exists project_files_own_delete on public.project_files;
create policy project_files_own_delete on public.project_files for delete using (auth.uid() = user_id);

-- ── 5. projects (SELECT/INSERT/UPDATE/DELETE) ────────────────────────
drop policy if exists projects_own_read   on public.projects;
create policy projects_own_read   on public.projects for select using (auth.uid() = user_id);
drop policy if exists projects_own_insert on public.projects;
create policy projects_own_insert on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists projects_own_update on public.projects;
create policy projects_own_update on public.projects for update using (auth.uid() = user_id);
drop policy if exists projects_own_delete on public.projects;
create policy projects_own_delete on public.projects for delete using (auth.uid() = user_id);

-- ── 6. prompt_library (SELECT/INSERT/UPDATE/DELETE) ──────────────────
drop policy if exists prompt_library_own_read   on public.prompt_library;
create policy prompt_library_own_read   on public.prompt_library for select using (auth.uid() = user_id);
drop policy if exists prompt_library_own_insert on public.prompt_library;
create policy prompt_library_own_insert on public.prompt_library for insert with check (auth.uid() = user_id);
drop policy if exists prompt_library_own_update on public.prompt_library;
create policy prompt_library_own_update on public.prompt_library for update using (auth.uid() = user_id);
drop policy if exists prompt_library_own_delete on public.prompt_library;
create policy prompt_library_own_delete on public.prompt_library for delete using (auth.uid() = user_id);

-- ── 7. role_outcomes (SELECT/INSERT/DELETE) ──────────────────────────
drop policy if exists role_outcomes_own_read   on public.role_outcomes;
create policy role_outcomes_own_read   on public.role_outcomes for select using (auth.uid() = user_id);
drop policy if exists role_outcomes_own_insert on public.role_outcomes;
create policy role_outcomes_own_insert on public.role_outcomes for insert with check (auth.uid() = user_id);
drop policy if exists role_outcomes_own_delete on public.role_outcomes;
create policy role_outcomes_own_delete on public.role_outcomes for delete using (auth.uid() = user_id);

-- ── 8. storage_connections (SELECT/INSERT/UPDATE/DELETE) ─────────────
drop policy if exists storage_connections_own_read   on public.storage_connections;
create policy storage_connections_own_read   on public.storage_connections for select using (auth.uid() = user_id);
drop policy if exists storage_connections_own_insert on public.storage_connections;
create policy storage_connections_own_insert on public.storage_connections for insert with check (auth.uid() = user_id);
drop policy if exists storage_connections_own_update on public.storage_connections;
create policy storage_connections_own_update on public.storage_connections for update using (auth.uid() = user_id);
drop policy if exists storage_connections_own_delete on public.storage_connections;
create policy storage_connections_own_delete on public.storage_connections for delete using (auth.uid() = user_id);

-- ── 9. turns (SELECT/INSERT/DELETE — scoped via parent conversation) ──
-- `turns` has no user_id of its own; ownership is derived from the parent
-- conversations row. Matches the live EXISTS-subquery policies verbatim.
drop policy if exists turns_own_read   on public.turns;
create policy turns_own_read   on public.turns for select using (
  exists (select 1 from public.conversations c where c.id = turns.conversation_id and c.user_id = auth.uid())
);
drop policy if exists turns_own_insert on public.turns;
create policy turns_own_insert on public.turns for insert with check (
  exists (select 1 from public.conversations c where c.id = turns.conversation_id and c.user_id = auth.uid())
);
drop policy if exists turns_own_delete on public.turns;
create policy turns_own_delete on public.turns for delete using (
  exists (select 1 from public.conversations c where c.id = turns.conversation_id and c.user_id = auth.uid())
);

-- ── 10. usage_events (SELECT/INSERT — append-only) ───────────────────
-- Drop the legacy duplicate policies created in 20260526_tiers_and_usage.sql;
-- they are functionally identical to the _own_ pair below.
drop policy if exists "users read own usage"   on public.usage_events;
drop policy if exists "users insert own usage" on public.usage_events;
drop policy if exists usage_events_own_read   on public.usage_events;
create policy usage_events_own_read   on public.usage_events for select using (auth.uid() = user_id);
drop policy if exists usage_events_own_insert on public.usage_events;
create policy usage_events_own_insert on public.usage_events for insert with check (auth.uid() = user_id);
-- NOTE: no UPDATE/DELETE policy by design — with RLS on, this makes the table
-- append-only for clients (the enforce_free_tier_limits trigger relies on rows
-- never being deleted to count daily usage).

-- ── 11. user_api_keys (SELECT/INSERT/UPDATE) ─────────────────────────
-- Holds provider API keys. RLS isolates per user, but values are plaintext at
-- rest — consider Supabase Vault or app-side encryption as a follow-up.
drop policy if exists user_api_keys_own_read   on public.user_api_keys;
create policy user_api_keys_own_read   on public.user_api_keys for select using (auth.uid() = user_id);
drop policy if exists user_api_keys_own_insert on public.user_api_keys;
create policy user_api_keys_own_insert on public.user_api_keys for insert with check (auth.uid() = user_id);
drop policy if exists user_api_keys_own_update on public.user_api_keys;
create policy user_api_keys_own_update on public.user_api_keys for update using (auth.uid() = user_id);

-- ── 12. user_settings (SELECT/INSERT/UPDATE) ─────────────────────────
drop policy if exists user_settings_own_read   on public.user_settings;
create policy user_settings_own_read   on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists user_settings_own_insert on public.user_settings;
create policy user_settings_own_insert on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists user_settings_own_update on public.user_settings;
create policy user_settings_own_update on public.user_settings for update using (auth.uid() = user_id);
