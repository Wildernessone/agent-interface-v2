-- Encrypt user_api_keys provider keys at rest (closes issue #2).
--
-- WHY THIS EXISTS
-- public.user_api_keys stored third-party provider keys (Claude/GPT/Gemini/Grok
-- plus a tool_keys JSON) as PLAINTEXT columns. RLS already isolates rows per
-- user, but anyone with direct DB access (dashboard, a pg_dump backup, a leaked
-- service-role key, or a SQL path that bypasses RLS) could read every key
-- verbatim. This migration encrypts those columns at rest with pgcrypto's
-- pgp_sym_encrypt, keyed by a master secret held in Supabase Vault.
--
-- WHY VAULT FOR THE KEY
-- The master key lives in vault.secrets, encrypted by a root key that Supabase
-- manages OUTSIDE the database. It is therefore NOT present in a pg_dump / table
-- export — a stolen backup yields only ciphertext for both the key columns and
-- the master secret. Only the vault.decrypted_secrets view (reachable by the
-- SECURITY DEFINER accessors below, which run as the function owner) can recover
-- the key.
--
-- ACCESS MODEL
-- Clients no longer SELECT/UPSERT the table directly. They call:
--   * public.get_user_api_keys()  -> returns the caller's decrypted keys
--   * public.set_user_api_keys(..) -> encrypts and upserts the caller's keys
-- Both are SECURITY DEFINER, filter strictly on auth.uid() (never a passed-in
-- user_id), and run with search_path = '' (every identifier fully qualified) so
-- they cannot be hijacked by a malicious search_path. Direct table reads still
-- work under RLS but only ever expose bytea ciphertext.
--
-- RESIDUAL RISK (documented, not closed here)
-- A Postgres superuser, the service_role, or anything that can execute the
-- accessor functions can still obtain plaintext — this is inherent to keys the
-- app must use at runtime. The win is at-rest protection: dashboards, backups,
-- and raw table dumps no longer reveal the keys. Removing in-browser plaintext
-- entirely would require moving key custody into the proxy (out of scope).
--
-- SAFETY
--   * Idempotent column adds/drops (add/drop ... if [not] exists).
--   * Backfill runs only while the plaintext columns still exist, so re-running
--     after the drop is a no-op.
--   * DDL is transactional in Postgres; if any step fails the whole migration
--     rolls back, so the table is never left half-converted.

-- ── 1. Master key in Vault (created once) ────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'user_api_keys_master') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'user_api_keys_master',
      'Symmetric key for pgp_sym_encrypt of public.user_api_keys columns'
    );
  end if;
end $$;

-- ── 2. Add ciphertext columns ────────────────────────────────────────
alter table public.user_api_keys
  add column if not exists claude_key_enc bytea,
  add column if not exists gpt_key_enc    bytea,
  add column if not exists gemini_key_enc bytea,
  add column if not exists grok_key_enc   bytea,
  add column if not exists tool_keys_enc  bytea;

-- ── 3. Backfill existing plaintext → ciphertext ──────────────────────
-- Guarded on the plaintext columns still existing so this is a no-op on a
-- second run (or a fresh DB where the table was created without them).
do $$
declare k text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_api_keys' and column_name = 'claude_key'
  ) then
    select decrypted_secret into k from vault.decrypted_secrets where name = 'user_api_keys_master';
    execute $q$
      update public.user_api_keys set
        claude_key_enc = case when nullif(claude_key,'') is not null then extensions.pgp_sym_encrypt(claude_key, $1) else claude_key_enc end,
        gpt_key_enc    = case when nullif(gpt_key,'')    is not null then extensions.pgp_sym_encrypt(gpt_key, $1)    else gpt_key_enc end,
        gemini_key_enc = case when nullif(gemini_key,'') is not null then extensions.pgp_sym_encrypt(gemini_key, $1) else gemini_key_enc end,
        grok_key_enc   = case when nullif(grok_key,'')   is not null then extensions.pgp_sym_encrypt(grok_key, $1)   else grok_key_enc end,
        tool_keys_enc  = case when tool_keys is not null and tool_keys::text <> '{}' then extensions.pgp_sym_encrypt(tool_keys::text, $1) else tool_keys_enc end
    $q$ using k;
  end if;
end $$;

-- ── 4. Drop the plaintext columns ────────────────────────────────────
alter table public.user_api_keys
  drop column if exists claude_key,
  drop column if exists gpt_key,
  drop column if exists gemini_key,
  drop column if exists grok_key,
  drop column if exists tool_keys;

-- ── 5. SECURITY DEFINER accessors ────────────────────────────────────
-- READ: returns the caller's own decrypted keys (empty string / '{}' when unset).
create or replace function public.get_user_api_keys()
returns table (claude_key text, gpt_key text, gemini_key text, grok_key text, tool_keys jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  k   text;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'user_api_keys_master';
  return query
    select
      coalesce(case when r.claude_key_enc is not null then extensions.pgp_sym_decrypt(r.claude_key_enc, k) end, ''),
      coalesce(case when r.gpt_key_enc    is not null then extensions.pgp_sym_decrypt(r.gpt_key_enc, k)    end, ''),
      coalesce(case when r.gemini_key_enc is not null then extensions.pgp_sym_decrypt(r.gemini_key_enc, k) end, ''),
      coalesce(case when r.grok_key_enc   is not null then extensions.pgp_sym_decrypt(r.grok_key_enc, k)   end, ''),
      coalesce(case when r.tool_keys_enc  is not null then extensions.pgp_sym_decrypt(r.tool_keys_enc, k)::jsonb end, '{}'::jsonb)
    from public.user_api_keys r
    where r.user_id = uid;
end $$;

-- WRITE: encrypts and upserts the caller's keys. Empty string / NULL clears a
-- key (stored as NULL ciphertext). Replaces all columns each call, matching the
-- prior client upsert behaviour.
create or replace function public.set_user_api_keys(
  p_claude    text,
  p_gpt       text,
  p_gemini    text,
  p_grok      text,
  p_tool_keys jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k   text;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'user_api_keys_master';
  if k is null then
    raise exception 'user_api_keys_master vault secret is missing';
  end if;

  insert into public.user_api_keys as r
    (user_id, claude_key_enc, gpt_key_enc, gemini_key_enc, grok_key_enc, tool_keys_enc, updated_at)
  values (
    uid,
    case when nullif(p_claude,'') is not null then extensions.pgp_sym_encrypt(p_claude, k) end,
    case when nullif(p_gpt,'')    is not null then extensions.pgp_sym_encrypt(p_gpt, k)    end,
    case when nullif(p_gemini,'') is not null then extensions.pgp_sym_encrypt(p_gemini, k) end,
    case when nullif(p_grok,'')   is not null then extensions.pgp_sym_encrypt(p_grok, k)   end,
    case when p_tool_keys is not null and p_tool_keys::text <> '{}' then extensions.pgp_sym_encrypt(p_tool_keys::text, k) end,
    now()
  )
  on conflict (user_id) do update set
    claude_key_enc = excluded.claude_key_enc,
    gpt_key_enc    = excluded.gpt_key_enc,
    gemini_key_enc = excluded.gemini_key_enc,
    grok_key_enc   = excluded.grok_key_enc,
    tool_keys_enc  = excluded.tool_keys_enc,
    updated_at     = now();
end $$;

-- ── 6. Grants — owner-only execution by authenticated users ──────────
revoke all on function public.get_user_api_keys()                              from public, anon;
revoke all on function public.set_user_api_keys(text, text, text, text, jsonb) from public, anon;
grant execute on function public.get_user_api_keys()                              to authenticated;
grant execute on function public.set_user_api_keys(text, text, text, text, jsonb) to authenticated;
