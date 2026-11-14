create function public.validate_task_assignee_access() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
if new.assignee_id is null then return new;end if;
if tg_op='UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new;end if;
if not exists(select 1 from workspace_members m join projects p on p.workspace_id=m.workspace_id and p.id=new.project_id where m.workspace_id=new.workspace_id and m.user_id=new.assignee_id and (m.role='owner' or (m.role in ('member','contractor') and (p.access_type='workspace' or exists(select 1 from project_members pm where pm.workspace_id=new.workspace_id and pm.project_id=new.project_id and pm.user_id=m.user_id and pm.role in ('member','owner')))))) then raise exception 'Invite this team member to the project before assigning tasks';end if;
return new;end $$;
create trigger tasks_assignee_access before insert or update on tasks for each row execute function validate_task_assignee_access();
