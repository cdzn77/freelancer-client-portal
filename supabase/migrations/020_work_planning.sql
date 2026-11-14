-- Personal saved views, durable recurring tasks, and explicit capacity inputs.
create table saved_task_views (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id), name text not null check(length(trim(name)) between 1 and 80),
 scope text not null check(length(scope) between 1 and 100), filters jsonb not null check(jsonb_typeof(filters)='object' and octet_length(filters::text)<8000),
 unique(workspace_id,user_id,scope,name)
);
alter table saved_task_views enable row level security;
grant select,insert,update,delete on saved_task_views to authenticated;
create policy own_saved_views on saved_task_views for all to authenticated using(user_id=auth.uid() and workspace_role(workspace_id) in ('owner','member','contractor')) with check(user_id=auth.uid() and workspace_role(workspace_id) in ('owner','member','contractor'));

create table task_recurrences (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '' check(length(description)<=12000),
 priority text not null default 'Medium' check(priority in ('Low','Medium','High')), assignee_id uuid references auth.users(id) on delete set null,
 estimated_minutes integer not null default 0 check(estimated_minutes between 0 and 60000),
 cadence text not null check(cadence in ('daily','weekly','monthly')), timezone text not null,
 starts_on date not null, next_on date not null, enabled boolean not null default true,
 created_by uuid not null default auth.uid() references auth.users(id), last_error text,
 unique(workspace_id,project_id,id), foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade
);
create table task_recurrence_runs (
 recurrence_id uuid not null references task_recurrences(id) on delete cascade, occurrence date not null,
 task_id uuid references tasks(id) on delete set null, primary key(recurrence_id,occurrence)
);
alter table task_recurrences enable row level security;
alter table task_recurrence_runs enable row level security;
grant select on task_recurrences,task_recurrence_runs to authenticated;
create policy recurrence_read on task_recurrences for select to authenticated using(project_staff(workspace_id,project_id));
create policy recurrence_runs_read on task_recurrence_runs for select to authenticated using(exists(select 1 from task_recurrences r where r.id=recurrence_id));
create function public.save_task_recurrence(project uuid, title text, description text, priority text, assignee uuid, estimated_minutes integer, cadence text, timezone text, starts_on date, recurrence uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects; rid uuid;
begin
 select * into p from projects where id=project for update;
 if not found or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore the project first';end if;
 if not exists(select 1 from pg_timezone_names t where t.name=timezone) then raise exception 'Choose a valid timezone';end if;
 if starts_on<(now() at time zone timezone)::date then raise exception 'Choose today or a future start date';end if;
 if assignee is not null and not exists(select 1 from workspace_members m where m.workspace_id=p.workspace_id and m.user_id=assignee and (m.role='owner' or (m.role in ('member','contractor') and (p.access_type='workspace' or exists(select 1 from project_members pm where pm.project_id=p.id and pm.user_id=assignee and pm.role in ('owner','member')))))) then raise exception 'Choose a team member with project access';end if;
 if recurrence is null then
 insert into task_recurrences(workspace_id,project_id,title,description,priority,assignee_id,estimated_minutes,cadence,timezone,starts_on,next_on) values(p.workspace_id,p.id,trim(title),description,priority,assignee,estimated_minutes,cadence,timezone,starts_on,starts_on) returning id into rid;
 else
 update task_recurrences r set title=trim(save_task_recurrence.title),description=save_task_recurrence.description,priority=save_task_recurrence.priority,assignee_id=assignee,estimated_minutes=save_task_recurrence.estimated_minutes,cadence=save_task_recurrence.cadence,timezone=save_task_recurrence.timezone,starts_on=coalesce(save_task_recurrence.starts_on,r.starts_on),next_on=coalesce(save_task_recurrence.starts_on,r.next_on),last_error=null where r.id=recurrence and r.project_id=p.id returning id into rid;
 if not found then raise exception 'Schedule not found';end if;
 end if;
 return rid;
end $$;
create function public.pause_task_recurrence(recurrence uuid, paused boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r task_recurrences;begin
 select * into r from task_recurrences where id=recurrence for update;
 if not found or not project_manager(r.workspace_id,r.project_id) then raise exception 'Project owner access required';end if;
 update task_recurrences set enabled=not paused,last_error=null where id=r.id;
end $$;
-- Advance monthly dates from the original day, so Jan 31 -> Feb 28 -> Mar 31.
create function public.next_recurrence_date(current_day date, cadence text, anchor_day integer) returns date language sql immutable as $$
 select case cadence when 'daily' then current_day+1 when 'weekly' then current_day+7 else
 (date_trunc('month',current_day)+interval '1 month')::date + (least(anchor_day,extract(day from date_trunc('month',current_day)+interval '2 months - 1 day')::integer)-1) end
$$;
create function public.run_task_recurrences(at_time timestamptz default now(), only_workspace uuid default null) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r task_recurrences; p projects; today date; due_day date; assignee uuid; tid uuid; made integer:=0; initial_state text;
begin
 for r in select * from task_recurrences where enabled and (only_workspace is null or workspace_id=only_workspace) for update skip locked loop
 begin
 select * into p from projects where id=r.project_id;
 if p.archived_at is not null or p.deleted_at is not null then continue;end if;
 if not exists(select 1 from workspace_members m where m.workspace_id=r.workspace_id and m.user_id=r.created_by and (m.role='owner' or (m.role in ('member','contractor') and exists(select 1 from project_members pm where pm.project_id=r.project_id and pm.user_id=r.created_by and pm.role='owner')))) then
 update task_recurrences set enabled=false,last_error='Schedule owner no longer manages this project. Ask an administrator to recreate the schedule.' where id=r.id;continue;end if;
 today:=(at_time at time zone r.timezone)::date;
 due_day:=r.next_on;
 -- Skip missed dates after pauses, outages or project archival; never flood a project with a backlog.
 if due_day<today and r.cadence in ('daily','weekly') then
 due_day:=due_day+((today-due_day+(case r.cadence when 'daily' then 1 else 7 end)-1)/(case r.cadence when 'daily' then 1 else 7 end))*(case r.cadence when 'daily' then 1 else 7 end);
 else
 while due_day<today loop due_day:=next_recurrence_date(due_day,r.cadence,extract(day from r.starts_on)::integer);end loop;
 end if;
 if due_day=today then
 insert into task_recurrence_runs(recurrence_id,occurrence) values(r.id,due_day) on conflict do nothing;
 if found then
 assignee:=null;
 if exists(select 1 from workspace_members m where m.workspace_id=r.workspace_id and m.user_id=r.assignee_id and (m.role='owner' or (m.role in ('member','contractor') and (p.access_type='workspace' or exists(select 1 from project_members pm where pm.project_id=p.id and pm.user_id=r.assignee_id and pm.role in ('owner','member')))))) then assignee:=r.assignee_id;end if;
 select workflow_states[1] into initial_state from workspaces where id=r.workspace_id;
 insert into tasks(workspace_id,project_id,title,description,priority,assignee_id,estimated_minutes,due_date,status,created_by) values(r.workspace_id,r.project_id,r.title,r.description,r.priority,assignee,r.estimated_minutes,due_day,coalesce(initial_state,'To do'),r.created_by) returning id into tid;
 update task_recurrence_runs set task_id=tid where recurrence_id=r.id and task_recurrence_runs.occurrence=due_day;
 made:=made+1;
 end if;
 due_day:=next_recurrence_date(due_day,r.cadence,extract(day from r.starts_on)::integer);
 end if;
 update task_recurrences set next_on=due_day,last_error=null where id=r.id;
 exception when others then
 update task_recurrences set enabled=false,last_error='Task creation failed. Check the schedule and project access, then resume.' where id=r.id;
 end;
 end loop;
 return made;
end $$;
revoke all on function public.save_task_recurrence(uuid,text,text,text,uuid,integer,text,text,date,uuid),public.pause_task_recurrence(uuid,boolean),public.run_task_recurrences(timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.save_task_recurrence(uuid,text,text,text,uuid,integer,text,text,date,uuid),public.pause_task_recurrence(uuid,boolean) to authenticated;
grant execute on function public.run_task_recurrences(timestamptz,uuid) to service_role;
select cron.schedule('studio-recurring-tasks','*/15 * * * *','select public.run_task_recurrences()');

create table team_capacity (
 workspace_id uuid not null, user_id uuid not null, daily_minutes integer not null check(daily_minutes between 0 and 1440),
 weekdays integer[] not null check(weekdays <@ array[0,1,2,3,4,5,6]), primary key(workspace_id,user_id),
 foreign key(workspace_id,user_id) references workspace_members(workspace_id,user_id) on delete cascade
);
create table team_time_off (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid not null,
 starts_on date not null, ends_on date not null, check(ends_on>=starts_on and ends_on-starts_on<=366),
 foreign key(workspace_id,user_id) references workspace_members(workspace_id,user_id) on delete cascade
);
alter table team_capacity enable row level security;
alter table team_time_off enable row level security;
grant select,insert,update,delete on team_capacity,team_time_off to authenticated;
create policy capacity_admin on team_capacity for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create policy time_off_admin on team_time_off for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');

create function public.delete_task_recurrence(recurrence uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r task_recurrences;begin
 select * into r from task_recurrences where id=recurrence for update;
 if not found or not project_manager(r.workspace_id,r.project_id) then raise exception 'Project owner access required';end if;
 delete from task_recurrences where id=r.id;
 insert into audit_log(workspace_id,action,entity) values(r.workspace_id,'recurrence_deleted',r.id::text);
end $$;
revoke all on function public.delete_task_recurrence(uuid) from public;
grant execute on function public.delete_task_recurrence(uuid) to authenticated;
