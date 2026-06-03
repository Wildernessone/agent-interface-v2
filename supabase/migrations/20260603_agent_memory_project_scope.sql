-- ============================================================================
-- agent_memory: project scoping
-- ============================================================================
-- Memory rows could only be scoped to a user, so every project shared one
-- global memory pool — Project A's facts surfaced in Project B's prompts
-- (cross-contamination). Add an optional project_id so a memory can be tagged
-- to one project. NULL = global (a user-level fact that applies everywhere).
--
-- The client (useStore.saveMemory) stamps the active project_id on new rows;
-- the prompt-assembly layer (TheInterface scopedMemory) only injects rows whose
-- project_id is NULL or matches the active project. Existing rows have NULL and
-- stay global — backward-safe.
--
-- RLS is unchanged: the existing agent_memory policies are auth.uid() = user_id
-- and continue to cover this column. ON DELETE SET NULL keeps a project's
-- memories as global facts if the project itself is deleted, rather than
-- cascading them away.
-- ============================================================================

alter table public.agent_memory
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_agent_memory_user_project
  on public.agent_memory (user_id, project_id);
