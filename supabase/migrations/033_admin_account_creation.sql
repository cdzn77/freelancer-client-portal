-- Public registration is closed. Only the server-side admin creation flow can
-- set app metadata; signup data supplied by visitors is user metadata.
create or replace function public.require_admin_provisioning() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 -- Auth attaches app metadata after inserting the identity in the same transaction.
 -- Check the final row at commit, not the initial INSERT snapshot.
 if (select raw_app_meta_data->>'pms_admin_provisioned' from auth.users where id=new.id) is distinct from 'true' then
  raise exception 'Public registration is closed. Contact your workspace administrator.';
 end if;
 return new;
end $$;
revoke all on function public.require_admin_provisioning() from public,anon,authenticated;
drop trigger if exists pms_admin_accounts_only on auth.users;
create constraint trigger pms_admin_accounts_only after insert on auth.users
deferrable initially deferred for each row execute function public.require_admin_provisioning();

-- Atomic membership plus optional project access. Repeating a request must not
-- duplicate memberships or silently change the role of an existing member.
create or replace function public.provision_workspace_member(w uuid,member_email text,member_role text,project uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; display text; existing text; assigned text;
begin
 perform 1 from workspaces where id=w for update;
 if public.workspace_role(w) is distinct from 'owner' then raise exception 'Only administrators can add members'; end if;
 if member_role is null or member_role not in ('owner','member','client') then raise exception 'Choose a valid member role'; end if;
 if project is not null and not exists(select 1 from projects where id=project and workspace_id=w and deleted_at is null) then raise exception 'Choose a project in this workspace'; end if;
 select id,coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),split_part(email,'@',1)) into u,display
 from auth.users where lower(email)=lower(trim(member_email));
 if u is null then raise exception 'Account not found. Choose Create account instead.'; end if;
 select role into existing from workspace_members where workspace_id=w and user_id=u;
 assigned=coalesce(existing,member_role);
 insert into workspace_members(workspace_id,user_id,role,display_name) values(w,u,assigned,left(display,100)) on conflict do nothing;
 if project is not null then
  insert into project_members(workspace_id,project_id,user_id,role) values(w,project,u,case when assigned='client' then 'guest' else 'member' end) on conflict do nothing;
 end if;
 insert into audit_log(workspace_id,action,entity) values(w,'member_access_added:'||assigned,u::text);
 return jsonb_build_object('user_id',u,'already_member',existing is not null,'role',assigned);
end $$;
revoke all on function public.provision_workspace_member(uuid,text,text,uuid) from public,anon;
grant execute on function public.provision_workspace_member(uuid,text,text,uuid) to authenticated;
