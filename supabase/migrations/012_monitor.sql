create table monitor_records (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
 source text not null default 'portal-desk', kind text not null, source_id text not null,
 title text not null, body jsonb not null, source_updated_at text, imported_at timestamptz not null default now(),
 linked_project_id uuid, linked_task_id uuid,
 unique(workspace_id,source,kind,source_id),
 foreign key(workspace_id,linked_project_id) references projects(workspace_id,id),
 foreign key(workspace_id,linked_task_id) references tasks(workspace_id,id) on delete set null (linked_task_id)
);
alter table monitor_records enable row level security;
grant select,insert,update,delete on monitor_records to authenticated;
create policy monitor_admin on monitor_records for all to authenticated using(public.workspace_role(workspace_id)='owner') with check(public.workspace_role(workspace_id)='owner');
create function public.monitor_create_task(record_id uuid, project uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare r monitor_records; t uuid;
begin
 select * into r from monitor_records where id=record_id for update;
 if r.id is null or public.workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Only administrators can connect Desk records';end if;
 if r.linked_task_id is not null then return r.linked_task_id;end if;
 if not exists(select 1 from projects where id=project and workspace_id=r.workspace_id) then raise exception 'Choose a project in this workspace';end if;
 insert into tasks(workspace_id,project_id,title,description,custom_fields) values(r.workspace_id,project,r.title,coalesce(r.body->>'notes',r.body->>'description',r.body->>'summary','')||E'\n\nImported from an external workspace ('||r.kind||' / '||r.source_id||'). Review the source record before planning or sharing.',jsonb_build_object('desk_source_id',r.source_id,'desk_kind',r.kind)) returning id into t;
 update monitor_records set linked_project_id=project,linked_task_id=t where id=r.id;
 return t;
end $$;
revoke all on function public.monitor_create_task(uuid,uuid) from public;
grant execute on function public.monitor_create_task(uuid,uuid) to authenticated;
