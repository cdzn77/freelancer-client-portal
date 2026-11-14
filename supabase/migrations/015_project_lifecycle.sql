alter table projects add column archived_at timestamptz;
alter table projects add column deleted_at timestamptz;
-- Trash is recoverable and never deletes related records or stored objects.
create function public.guard_project_trash() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if new.deleted_at is distinct from old.deleted_at and public.workspace_role(old.workspace_id) is distinct from 'owner' and auth.role() <> 'service_role' then raise exception 'Only administrators can move projects to or from Trash';end if;
return new;end $$;
create trigger project_trash_guard before update on projects for each row execute function guard_project_trash();
