-- Avoid the SQL CURRENT_ROLE keyword when checking the target membership.
create or replace function public.manage_workspace_member(w uuid,target uuid,new_role text default null,remove_member boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare member_existing_role text;begin
perform 1 from workspaces where id=w for update;
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Only administrators can manage account members';end if;
select role into member_existing_role from workspace_members where workspace_id=w and user_id=target;if member_existing_role is null then raise exception 'Member not found';end if;
if not remove_member and (new_role is null or new_role not in ('owner','member','client')) then raise exception 'Choose Administrator, Regular user, or Client/Guest';end if;
if member_existing_role='owner' and (remove_member or new_role<>'owner') and (select count(*) from workspace_members where workspace_id=w and role='owner')<=1 then raise exception 'Keep at least one administrator';end if;
if remove_member then update tasks set assignee_id=null where workspace_id=w and assignee_id=target;delete from project_members where workspace_id=w and user_id=target;delete from workspace_members where workspace_id=w and user_id=target;
else update workspace_members set role=new_role where workspace_id=w and user_id=target;update project_members set role=case when new_role='client' then 'guest' when role='guest' then 'member' else role end where workspace_id=w and user_id=target;end if;
insert into audit_log(workspace_id,action,entity) values(w,case when remove_member then 'member_removed' else 'role_changed:'||new_role end,target::text);end $$;
