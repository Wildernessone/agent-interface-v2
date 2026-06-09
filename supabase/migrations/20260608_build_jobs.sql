-- Server-side builds, PHASE 1: durable build jobs + deliverable persistence.
--
-- Today a build runs entirely client-side; a tab close mid-build throws away the
-- work and (for storage-less users) the only copy of the finished file, because
-- conversations strip heavy data: URLs before saving. This records each build and
-- persists its finished deliverable BYTES to Supabase Storage, so they survive a
-- reload regardless of Drive/Dropbox — and is the foundation Phase 2 (server-side
-- execution) builds on (the job row becomes the unit of work the server runs).

create table if not exists public.build_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,            -- soft link (a brand-new conversation may not be saved yet)
  turn_id         text,            -- client build-turn id, to rehydrate the card in place
  status          text not null default 'running'
                    check (status in ('running','done','failed','canceled')),
  deliverable     text,
  request         text,
  files           jsonb not null default '[]'::jsonb,  -- [{label,type,filename,storagePath,savedLink,component}]
  errors          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists build_jobs_user_conv_idx
  on public.build_jobs (user_id, conversation_id, created_at desc);

alter table public.build_jobs enable row level security;
drop policy if exists build_jobs_own_read   on public.build_jobs;
create policy build_jobs_own_read   on public.build_jobs for select using (auth.uid() = user_id);
drop policy if exists build_jobs_own_insert on public.build_jobs;
create policy build_jobs_own_insert on public.build_jobs for insert with check (auth.uid() = user_id);
drop policy if exists build_jobs_own_update on public.build_jobs;
create policy build_jobs_own_update on public.build_jobs for update using (auth.uid() = user_id);
drop policy if exists build_jobs_own_delete on public.build_jobs;
create policy build_jobs_own_delete on public.build_jobs for delete using (auth.uid() = user_id);

-- Private bucket for deliverable bytes. Path convention: <user_id>/<job_id>/<filename>
-- so the RLS below scopes every object to its owner. Client reads via short-lived
-- signed URLs (createSignedUrl); nothing is publicly listable.
insert into storage.buckets (id, name, public)
values ('build-deliverables', 'build-deliverables', false)
on conflict (id) do nothing;

drop policy if exists build_deliverables_own_read on storage.objects;
create policy build_deliverables_own_read on storage.objects for select
  using (bucket_id = 'build-deliverables' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists build_deliverables_own_insert on storage.objects;
create policy build_deliverables_own_insert on storage.objects for insert
  with check (bucket_id = 'build-deliverables' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists build_deliverables_own_update on storage.objects;
create policy build_deliverables_own_update on storage.objects for update
  using (bucket_id = 'build-deliverables' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists build_deliverables_own_delete on storage.objects;
create policy build_deliverables_own_delete on storage.objects for delete
  using (bucket_id = 'build-deliverables' and (storage.foldername(name))[1] = auth.uid()::text);
