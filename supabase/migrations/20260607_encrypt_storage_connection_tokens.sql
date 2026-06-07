-- Encrypt OAuth tokens in storage_connections at rest.
--
-- ⚠️  COUPLED CHANGE — DO NOT APPLY ALONE. This drops the plaintext
-- access_token/refresh_token columns. The client currently reads those columns
-- DIRECTLY (≈14 sites), so applying this without the client rewire below breaks
-- Google Drive, Dropbox and Reddit. Land the migration + client rewire together
-- and verify with a live re-auth of each provider before merging.
--
-- WHY: provider API keys were encrypted at rest (20260530_encrypt_user_api_keys),
-- but Drive/Dropbox/Reddit access_token + refresh_token sit here as PLAINTEXT.
-- The Drive scope includes gmail.send, so a long-lived refresh token in a leaked
-- pg_dump / dashboard view = durable account compromise. Same Vault-keyed
-- SECURITY-DEFINER accessor pattern as user_api_keys; only the two token columns
-- are secret — provider/expires_at/folder-ids stay plaintext.
--
-- CLIENT REWIRE CHECKLIST (do alongside this migration):
--   src/utils/cloudStorage.js:45,72       SELECT provider,access_token  → get_storage_connections()
--   src/utils/driveStorage.js:68          upsert (connect)              → set_storage_connection(...)
--   src/utils/driveStorage.js:106,243,265,434  token-refresh UPDATEs    → set_storage_connection(...) / update_storage_tokens(...)
--   src/utils/driveStorage.js:131         SELECT access_token,...        → get_storage_connections()
--   src/utils/dropboxStorage.js:106,127,159   upsert/select/update       → accessors
--   src/utils/redditAuth.js:97,119,139        upsert/select/update       → accessors
-- After rewire, no client code references access_token/refresh_token columns directly.

-- ── 1. Master key in Vault ───────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'storage_connections_master') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'storage_connections_master',
      'Symmetric key for pgp_sym_encrypt of public.storage_connections OAuth tokens'
    );
  end if;
end $$;

-- ── 2. Add ciphertext columns ────────────────────────────────────────
alter table public.storage_connections
  add column if not exists access_token_enc  bytea,
  add column if not exists refresh_token_enc bytea;

-- ── 3. Backfill plaintext → ciphertext (no-op once plaintext is gone) ─
do $$
declare k text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='storage_connections' and column_name='access_token'
  ) then
    select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
    execute $q$
      update public.storage_connections set
        access_token_enc  = case when nullif(access_token,'')  is not null then extensions.pgp_sym_encrypt(access_token, $1)  else access_token_enc end,
        refresh_token_enc = case when nullif(refresh_token,'') is not null then extensions.pgp_sym_encrypt(refresh_token, $1) else refresh_token_enc end
    $q$ using k;
  end if;
end $$;

-- ── 4. Drop the plaintext columns ────────────────────────────────────
alter table public.storage_connections
  drop column if exists access_token,
  drop column if exists refresh_token;

-- ── 5. SECURITY DEFINER accessors ────────────────────────────────────
-- READ: all of the caller's connections, tokens decrypted.
create or replace function public.get_storage_connections()
returns table (
  provider text, access_token text, refresh_token text, expires_at timestamptz,
  root_folder_id text, agent_memory_folder_id text, projects_folder_id text
)
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
    from public.storage_connections r
    where r.user_id = uid;
end $$;

-- WRITE: encrypt + upsert one provider connection. NULL/'' clears a token.
-- Pass-through nulls for folder ids leave existing values (coalesce on conflict).
create or replace function public.set_storage_connection(
  p_provider text, p_access_token text, p_refresh_token text, p_expires_at timestamptz,
  p_root_folder_id text default null, p_agent_memory_folder_id text default null, p_projects_folder_id text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  if k is null then raise exception 'storage_connections_master vault secret is missing'; end if;

  insert into public.storage_connections as r
    (user_id, provider, access_token_enc, refresh_token_enc, expires_at,
     root_folder_id, agent_memory_folder_id, projects_folder_id, updated_at)
  values (
    uid, p_provider,
    case when nullif(p_access_token,'')  is not null then extensions.pgp_sym_encrypt(p_access_token, k)  end,
    case when nullif(p_refresh_token,'') is not null then extensions.pgp_sym_encrypt(p_refresh_token, k) end,
    p_expires_at, p_root_folder_id, p_agent_memory_folder_id, p_projects_folder_id, now()
  )
  on conflict (user_id, provider) do update set
    access_token_enc       = excluded.access_token_enc,
    refresh_token_enc      = coalesce(excluded.refresh_token_enc, r.refresh_token_enc), -- refresh flows often omit it
    expires_at             = excluded.expires_at,
    root_folder_id         = coalesce(excluded.root_folder_id, r.root_folder_id),
    agent_memory_folder_id = coalesce(excluded.agent_memory_folder_id, r.agent_memory_folder_id),
    projects_folder_id     = coalesce(excluded.projects_folder_id, r.projects_folder_id),
    updated_at             = now();
end $$;

-- Light helper for token refresh: replace just the access token + expiry.
create or replace function public.update_storage_tokens(
  p_provider text, p_access_token text, p_expires_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare k text; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  update public.storage_connections
    set access_token_enc = case when nullif(p_access_token,'') is not null then extensions.pgp_sym_encrypt(p_access_token, k) end,
        expires_at = p_expires_at, updated_at = now()
    where user_id = uid and provider = p_provider;
end $$;

-- ── 6. Grants ────────────────────────────────────────────────────────
revoke all on function public.get_storage_connections()                                         from public, anon;
revoke all on function public.set_storage_connection(text,text,text,timestamptz,text,text,text)  from public, anon;
revoke all on function public.update_storage_tokens(text,text,timestamptz)                        from public, anon;
grant execute on function public.get_storage_connections()                                        to authenticated;
grant execute on function public.set_storage_connection(text,text,text,timestamptz,text,text,text) to authenticated;
grant execute on function public.update_storage_tokens(text,text,timestamptz)                      to authenticated;
