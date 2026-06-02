-- Account deletion (GDPR/CCPA "right to erasure").
--
-- delete_my_account() erases the calling user and every row we hold for them.
-- It is SECURITY DEFINER so it can delete from auth.users, but it derives the
-- target strictly from auth.uid() — it never trusts a client-supplied id, so a
-- signed-in user can only ever delete themselves.
--
-- Children that reference conversations are deleted first to satisfy FKs,
-- regardless of whether those FKs were declared ON DELETE CASCADE. Deleting the
-- auth.users row last also cascades anything keyed directly to it.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Rows that FK to conversations (no direct user_id, or must precede the parent).
  delete from public.turns
    where conversation_id in (select id from public.conversations where user_id = uid);
  delete from public.role_outcomes where user_id = uid;

  -- Directly user-owned rows.
  delete from public.conversations      where user_id = uid;
  delete from public.project_files       where user_id = uid;
  delete from public.projects            where user_id = uid;
  delete from public.agent_memory        where user_id = uid;
  delete from public.prompt_library      where user_id = uid;
  delete from public.usage_events        where user_id = uid;
  delete from public.storage_connections where user_id = uid;  -- OAuth tokens
  delete from public.user_api_keys       where user_id = uid;  -- encrypted keys
  delete from public.user_settings       where user_id = uid;

  -- Finally the auth identity itself.
  delete from auth.users where id = uid;
end;
$$;

-- Only signed-in users may call it; never anon/public.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
