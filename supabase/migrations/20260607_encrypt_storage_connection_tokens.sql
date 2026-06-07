-- Encrypt storage_connections OAuth tokens — PHASE 1 (additive, NON-breaking).
--
-- Drive/Dropbox/Reddit access_token + refresh_token were plaintext while provider
-- API keys were encrypted (Drive scope includes gmail.send → a leaked dump = durable
-- account compromise). This adds encrypted columns + Vault-keyed SECURITY-DEFINER
-- accessors and BACKFILLS, but keeps the plaintext columns and DUAL-WRITES, so the
-- currently-deployed client (which reads plaintext directly) keeps working through
-- the rollout. Phase 2 (20260608_drop_storage_plaintext_tokens) drops plaintext once
-- the accessor-based client is deployed + a live re-auth of each provider is verified.
-- Safe to apply anytime.

-- 1. Master key in Vault
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'storage_connections_master') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'storage_connections_master', 'Symmetric key for storage_connections OAuth tokens');
  end if;
end $$;

-- 2. Ciphertext columns (plaintext kept for now)
alter table public.storage_connections
  add column if not exists access_token_enc  bytea,
  add column if not exists refresh_token_enc bytea;

-- 3. Backfill plaintext → ciphertext
do $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'storage_connections_master';
  update public.storage_connections set
    access_token_enc  = case when nullif(access_token,'')  is not null then extensions.pgp_sym_encrypt(access_token, k)  else access_token_enc end,
    refresh_token_enc = case when nullif(refresh_token,'') is not null then extensions.pgp_sym_encrypt(refresh_token, k) else refresh_token_enc end;
end $$;

-- 4. Accessors — dual-write (enc + plaintext) so old + new client coexist.
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
           coalesce(case when r.access_token_enc  is not null then extensions.pgp_sym_decrypt(r.access_token_enc, k)  end, r.access_token, ''),
           coalesce(case when r.refresh_token_enc is not null then extensions.pgp_sym_decrypt(r.refresh_token_enc, k) end, r.refresh_token, ''),
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
    (user_id, provider, access_token, refresh_token, access_token_enc, refresh_token_enc,
     expires_at, root_folder_id, agent_memory_folder_id, projects_folder_id, updated_at)
  values (uid, p_provider, p_access_token, p_refresh_token,
    case when nullif(p_access_token,'')  is not null then extensions.pgp_sym_encrypt(p_access_token, k)  end,
    case when nullif(p_refresh_token,'') is not null then extensions.pgp_sym_encrypt(p_refresh_token, k) end,
    p_expires_at, p_root_folder_id, p_agent_memory_folder_id, p_projects_folder_id, now())
  on conflict (user_id, provider) do update set
    access_token           = excluded.access_token,
    refresh_token          = coalesce(excluded.refresh_token, r.refresh_token),
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
    access_token     = p_access_token,
    access_token_enc = case when nullif(p_access_token,'') is not null then extensions.pgp_sym_encrypt(p_access_token, k) end,
    expires_at = p_expires_at, updated_at = now()
  where user_id = uid and provider = p_provider;
end $$;

-- 5. Grants
revoke all on function public.get_storage_connections()                                         from public, anon;
revoke all on function public.set_storage_connection(text,text,text,timestamptz,text,text,text)  from public, anon;
revoke all on function public.update_storage_tokens(text,text,timestamptz)                        from public, anon;
grant execute on function public.get_storage_connections()                                        to authenticated;
grant execute on function public.set_storage_connection(text,text,text,timestamptz,text,text,text) to authenticated;
grant execute on function public.update_storage_tokens(text,text,timestamptz)                      to authenticated;
