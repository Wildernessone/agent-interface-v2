-- Encrypt storage_connections OAuth tokens — PHASE 2: drop plaintext.
--
-- ⚠️ APPLY ONLY AFTER the accessor-based client is deployed AND a live re-auth of
-- each provider is verified (connect Drive, connect Dropbox, connect Reddit, and a
-- build saves to Drive — all working). Phase 1 dual-wrote enc+plaintext; this
-- redefines the accessors to stop touching plaintext, then drops the plaintext
-- columns. After this, an at-rest dump exposes only ciphertext.

-- Accessors: enc-only (no plaintext read/write).
create or replace function public.get_storage_connections()
returns table (provider text, access_token text, refresh_token text, expires_at timestamptz,
               root_folder_id text, agent_memory_folder_id text, projects_folder_id text)
language plpgsql security definer set search_path = '' as $$
declare k text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  return query
    select r.provider,
           coalesce(case when r.access_token_enc  is not null then extensions.pgp_sym_decrypt(r.access_token_enc, k)  end, ''),
           coalesce(case when r.refresh_token_enc is not null then extensions.pgp_sym_decrypt(r.refresh_token_enc, k) end, ''),
           r.expires_at, r.root_folder_id, r.agent_memory_folder_id, r.projects_folder_id
    from public.storage_connections r where r.user_id = uid;
end $$;

create or replace function public.set_storage_connection(
  p_provider text, p_access_token text, p_refresh_token text, p_expires_at timestamptz,
  p_root_folder_id text default null, p_agent_memory_folder_id text default null, p_projects_folder_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  insert into public.storage_connections as r
    (user_id, provider, access_token_enc, refresh_token_enc,
     expires_at, root_folder_id, agent_memory_folder_id, projects_folder_id, updated_at)
  values (uid, p_provider,
    case when nullif(p_access_token,'')  is not null then extensions.pgp_sym_encrypt(p_access_token, k)  end,
    case when nullif(p_refresh_token,'') is not null then extensions.pgp_sym_encrypt(p_refresh_token, k) end,
    p_expires_at, p_root_folder_id, p_agent_memory_folder_id, p_projects_folder_id, now())
  on conflict (user_id, provider) do update set
    access_token_enc       = excluded.access_token_enc,
    refresh_token_enc      = coalesce(excluded.refresh_token_enc, r.refresh_token_enc),
    expires_at             = excluded.expires_at,
    root_folder_id         = coalesce(excluded.root_folder_id, r.root_folder_id),
    agent_memory_folder_id = coalesce(excluded.agent_memory_folder_id, r.agent_memory_folder_id),
    projects_folder_id     = coalesce(excluded.projects_folder_id, r.projects_folder_id),
    updated_at             = now();
end $$;

create or replace function public.update_storage_tokens(p_provider text, p_access_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  update public.storage_connections set
    access_token_enc = case when nullif(p_access_token,'') is not null then extensions.pgp_sym_encrypt(p_access_token, k) end,
    expires_at = p_expires_at, updated_at = now()
  where user_id = uid and provider = p_provider;
end $$;

-- Drop the plaintext token columns.
alter table public.storage_connections
  drop column if exists access_token,
  drop column if exists refresh_token;
