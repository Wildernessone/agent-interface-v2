-- council_pages — the AI Council SEO flywheel store.
-- Each published row is rendered SSR at /council/<slug> (functions/council/[slug].js)
-- and listed at /library (functions/library/index.js). Drafts are written by the in-app
-- admin "Publish to library" button AND by the autonomous author (scripts/council-author.mjs),
-- then approved (status → 'published') by James.
--
-- NOTE: this table was first applied to the live project (oqbpuspnmznqxgkmyzyb) via the
-- Supabase MCP during the PR #3a build; this file is the tracked, idempotent equivalent so
-- the schema lives in the repo. Safe to re-run.

create table if not exists public.council_pages (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  question     text not null,
  topic        text,
  verdict      text not null,
  chairman     text,
  members      text[] not null default '{}',
  answers      jsonb  not null default '[]'::jsonb,
  ranking      jsonb  not null default '[]'::jsonb,
  og_image     text,
  author       text   not null default 'The AI Council',
  status       text   not null default 'draft' check (status in ('draft','published','archived')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists council_pages_status_idx on public.council_pages (status);

alter table public.council_pages enable row level security;

-- Anyone (anon included) may read PUBLISHED pages — that's the public SSR path.
drop policy if exists council_pages_public_read on public.council_pages;
create policy council_pages_public_read on public.council_pages
  for select using (status = 'published');

-- Admin (James) has full control — approve drafts, edit, archive.
drop policy if exists council_pages_admin_all on public.council_pages;
create policy council_pages_admin_all on public.council_pages
  for all
  using ((auth.jwt() ->> 'email') = 'jamesreed@tutamail.com')
  with check ((auth.jwt() ->> 'email') = 'jamesreed@tutamail.com');

-- A signed-in user may insert their OWN draft (the in-app "Publish to library" seed flow).
-- The headless author bypasses RLS via the service key, so it isn't covered here.
drop policy if exists council_pages_user_insert on public.council_pages;
create policy council_pages_user_insert on public.council_pages
  for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'draft');

-- Stamp published_at the moment a row first becomes published.
create or replace function public.council_pages_stamp_published()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'published' and (old.status is distinct from 'published') and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_council_published on public.council_pages;
create trigger trg_council_published
  before update on public.council_pages
  for each row execute function public.council_pages_stamp_published();
