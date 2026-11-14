-- Check current server-owned state, never editable user metadata or stale JWT flags.
create or replace function public.pms_security_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'password_required', coalesce((select raw_app_meta_data->>'pms_password_change_required'='true' from auth.users where id=auth.uid()),false),
  'mfa_enrolled', exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'),
  'mfa_required', exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2'
 );
$$;
revoke all on function public.pms_security_status() from public,anon;
grant execute on function public.pms_security_status() to authenticated;

create or replace function public.pms_session_ready() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null
 and not coalesce((select raw_app_meta_data->>'pms_password_change_required'='true' from auth.users where id=auth.uid()),false)
 and (coalesce(auth.jwt()->>'aal','aal1')='aal2' or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'));
$$;
revoke all on function public.pms_session_ready() from public,anon;
grant execute on function public.pms_session_ready() to authenticated;

-- Changing editable profile metadata cannot dismiss a temporary-password requirement.
create or replace function public.pms_password_changed() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if old.encrypted_password is distinct from new.encrypted_password and coalesce(old.encrypted_password,'')<>'' then
  new.raw_app_meta_data=coalesce(new.raw_app_meta_data,'{}'::jsonb)-'pms_password_change_required';
  new.raw_user_meta_data=coalesce(new.raw_user_meta_data,'{}'::jsonb)-'pms_password_choice';
 end if;
 return new;
end $$;
revoke all on function public.pms_password_changed() from public,anon,authenticated;
create trigger pms_password_changed before update of encrypted_password on auth.users
 for each row execute function public.pms_password_changed();

-- Protect direct table access, storage, and permission helpers in addition to the UI.
create or replace function public.workspace_role(w uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select role from workspace_members where workspace_id=w and user_id=auth.uid() and public.pms_session_ready();
$$;
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('create policy pms_session_security on public.%I as restrictive for all to authenticated using ((select public.pms_session_ready())) with check ((select public.pms_session_ready()))',t.relname);
 end loop;
end $$;
create policy pms_session_security on storage.objects as restrictive for all to authenticated
 using ((select public.pms_session_ready())) with check ((select public.pms_session_ready()));

-- Security-definer RPCs also pass this API gate. Service workers remain separate.
create or replace function public.pms_check_request() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()='authenticated' and current_setting('request.path',true) is distinct from '/rpc/pms_security_status'
  and not public.pms_session_ready() then
  raise sqlstate 'PT403' using message='Complete your password change or two-factor verification before opening the workspace.';
 end if;
end $$;
revoke all on function public.pms_check_request() from public;
grant execute on function public.pms_check_request() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='public.pms_check_request';
notify pgrst,'reload config';
notify pgrst,'reload schema';
