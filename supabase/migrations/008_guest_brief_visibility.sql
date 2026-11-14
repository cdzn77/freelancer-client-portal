-- A disabled guest brief must be hidden even when requesting raw project rows.
create table project_shared_briefs(workspace_id uuid not null, project_id uuid not null, body text not null default '', primary key(workspace_id,project_id),foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade);
insert into project_shared_briefs select workspace_id,id,shared_brief from projects;
update projects set shared_brief='';
alter table project_shared_briefs enable row level security;
grant select,insert,update on project_shared_briefs to authenticated;
create policy shared_brief_read on project_shared_briefs for select to authenticated using(public.project_staff(workspace_id,project_id) or public.project_guest(workspace_id,project_id,'brief'));
create policy shared_brief_insert on project_shared_briefs for insert to authenticated with check(public.project_manager(workspace_id,project_id));
create policy shared_brief_update on project_shared_briefs for update to authenticated using(public.project_manager(workspace_id,project_id)) with check(public.project_manager(workspace_id,project_id));
create function public.keep_shared_brief_private() returns trigger language plpgsql as $$ begin if new.shared_brief<>'' then raise exception 'Save guest briefs in project_shared_briefs';end if;return new;end $$;
create trigger project_shared_brief_guard before insert or update on projects for each row execute function keep_shared_brief_private();
-- Guests may see their own account membership and people in invited projects, not the whole directory.
drop policy members_read on workspace_members;
create policy members_read on workspace_members for select to authenticated using(user_id=auth.uid() or public.workspace_role(workspace_id) in ('owner','member','contractor') or exists(select 1 from project_members pm where pm.workspace_id=workspace_members.workspace_id and pm.user_id=workspace_members.user_id and public.project_guest(pm.workspace_id,pm.project_id)));
