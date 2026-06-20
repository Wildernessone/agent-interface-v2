-- DeepSeek joins the council: encrypted-at-rest BYOK column + RPC support.
-- Mirrors the existing claude/gpt/gemini/grok handling exactly (pgp_sym_encrypt
-- keyed by the vault 'user_api_keys_master' secret — see 20260530_encrypt_user_api_keys).
-- p_deepseek is DEFAULTED so the currently-deployed 5-arg frontend keeps resolving
-- during the deploy window (one function, no overload ambiguity).
-- Applied live to oqbpuspnmznqxgkmyzyb via Supabase MCP; this file tracks it.

alter table public.user_api_keys add column if not exists deepseek_key_enc bytea;

drop function if exists public.get_user_api_keys();
create function public.get_user_api_keys()
  returns table(claude_key text, gpt_key text, gemini_key text, grok_key text, deepseek_key text, tool_keys jsonb)
  language plpgsql security definer set search_path to ''
as $function$
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
      coalesce(case when r.claude_key_enc   is not null then extensions.pgp_sym_decrypt(r.claude_key_enc, k)   end, ''),
      coalesce(case when r.gpt_key_enc      is not null then extensions.pgp_sym_decrypt(r.gpt_key_enc, k)      end, ''),
      coalesce(case when r.gemini_key_enc   is not null then extensions.pgp_sym_decrypt(r.gemini_key_enc, k)   end, ''),
      coalesce(case when r.grok_key_enc     is not null then extensions.pgp_sym_decrypt(r.grok_key_enc, k)     end, ''),
      coalesce(case when r.deepseek_key_enc is not null then extensions.pgp_sym_decrypt(r.deepseek_key_enc, k) end, ''),
      coalesce(case when r.tool_keys_enc    is not null then extensions.pgp_sym_decrypt(r.tool_keys_enc, k)::jsonb end, '{}'::jsonb)
    from public.user_api_keys r
    where r.user_id = uid;
end $function$;

drop function if exists public.set_user_api_keys(text, text, text, text, jsonb);
create function public.set_user_api_keys(p_claude text, p_gpt text, p_gemini text, p_grok text, p_tool_keys jsonb, p_deepseek text default '')
  returns void
  language plpgsql security definer set search_path to ''
as $function$
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
    (user_id, claude_key_enc, gpt_key_enc, gemini_key_enc, grok_key_enc, deepseek_key_enc, tool_keys_enc, updated_at)
  values (
    uid,
    case when nullif(p_claude,'')   is not null then extensions.pgp_sym_encrypt(p_claude, k)   end,
    case when nullif(p_gpt,'')      is not null then extensions.pgp_sym_encrypt(p_gpt, k)      end,
    case when nullif(p_gemini,'')   is not null then extensions.pgp_sym_encrypt(p_gemini, k)   end,
    case when nullif(p_grok,'')     is not null then extensions.pgp_sym_encrypt(p_grok, k)     end,
    case when nullif(p_deepseek,'') is not null then extensions.pgp_sym_encrypt(p_deepseek, k) end,
    case when p_tool_keys is not null and p_tool_keys::text <> '{}' then extensions.pgp_sym_encrypt(p_tool_keys::text, k) end,
    now()
  )
  on conflict (user_id) do update set
    claude_key_enc   = excluded.claude_key_enc,
    gpt_key_enc      = excluded.gpt_key_enc,
    gemini_key_enc   = excluded.gemini_key_enc,
    grok_key_enc     = excluded.grok_key_enc,
    deepseek_key_enc = excluded.deepseek_key_enc,
    tool_keys_enc    = excluded.tool_keys_enc,
    updated_at       = now();
end $function$;

revoke all on function public.get_user_api_keys() from public, anon;
revoke all on function public.set_user_api_keys(text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.get_user_api_keys() to authenticated;
grant execute on function public.set_user_api_keys(text, text, text, text, jsonb, text) to authenticated;
