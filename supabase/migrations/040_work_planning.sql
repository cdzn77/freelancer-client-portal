alter table tasks add column start_date date;
alter table tasks add column schedule_pinned boolean not null default false;
alter table tasks add constraint task_dates_ordered check(start_date is null or due_date is null or due_date>=start_date);
alter table projects add column workdays integer[] not null default array[1,2,3,4,5] check(cardinality(workdays) between 1 and 7 and workdays <@ array[0,1,2,3,4,5,6]);
alter table projects add column holidays date[] not null default '{}';
create table task_allocations(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,task_id uuid not null,user_id uuid not null,
 work_date date not null,minutes integer not null check(minutes between 1 and 1440),
 unique(task_id,work_date),foreign key(workspace_id,project_id,task_id) references tasks(workspace_id,project_id,id) on delete cascade,
 foreign key(workspace_id,user_id) references workspace_members(workspace_id,user_id) on delete cascade
);
alter table task_allocations enable row level security;
grant select on task_allocations to authenticated;
create policy allocations_staff on task_allocations for select to authenticated using(project_staff(workspace_id,project_id));
create function public.planning_fingerprint(p_project uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select md5(jsonb_build_object('project',(select jsonb_build_array(workdays,holidays,archived_at,deleted_at) from projects where id=p_project),
 'tasks',(select jsonb_agg(to_jsonb(t) order by id) from tasks t where project_id=p_project),
 'dependencies',(select jsonb_agg(to_jsonb(d) order by task_id,depends_on_id) from dependencies d where task_id in(select id from tasks where project_id=p_project) or depends_on_id in(select id from tasks where project_id=p_project)),
 'allocations',(select jsonb_agg(to_jsonb(a) order by id) from task_allocations a where project_id=p_project))::text)
$$;
revoke all on function planning_fingerprint(uuid) from public;
create function public.shift_work_date(p_day date,p_delta integer,p_workdays integer[],p_holidays date[]) returns date language plpgsql immutable as $$
declare result date:=p_day; remaining integer:=abs(p_delta); direction integer:=case when p_delta<0 then -1 else 1 end; n integer:=0;begin
 if p_day is null then return null;end if;
 if remaining>3660 or cardinality(p_workdays)=0 then raise exception 'Schedule shift is too large';end if;
 while remaining>0 loop
  result:=result+direction;n:=n+1;if n>15000 then raise exception 'No working dates in range';end if;
  if extract(dow from result)::integer=any(p_workdays) and not(result=any(p_holidays)) then remaining:=remaining-1;end if;
 end loop;return result;
end $$;
revoke all on function shift_work_date(date,integer,integer[],date[]) from public;
create function public.preview_task_schedule(p_task uuid,p_start date,p_due date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare root tasks;p projects;t tasks;r record;delta integer;plan jsonb:='[]';warnings jsonb:='[]';ids uuid[];new_start date;new_due date;begin
 select * into root from tasks where id=p_task;
 if not found or not project_manager(root.workspace_id,root.project_id) then raise exception 'Project owner access required';end if;
 select * into p from projects where id=root.project_id;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore project first';end if;
 if p_start is null or p_due is null or p_due<p_start or abs(p_due-coalesce(root.due_date,p_due))>3660 then raise exception 'Choose a valid bounded date range';end if;
 if root.status='Done' or root.schedule_pinned then raise exception 'Unpin or reopen this task before rescheduling';end if;
 with recursive descendants(id) as (select root.id union select d.task_id from dependencies d join descendants x on d.depends_on_id=x.id)
 select array_agg(id) into ids from descendants;
 if cardinality(ids)>500 then raise exception 'Reschedule at most 500 tasks at once';end if;
 if exists(select 1 from tasks where id=any(ids) and project_id<>p.id) then raise exception 'Cross-project dependencies need separate planning';end if;
 select count(*)::integer into delta from generate_series(least(coalesce(root.due_date,p_due),p_due)+1,greatest(coalesce(root.due_date,p_due),p_due),interval '1 day') day
 where extract(dow from day)::integer=any(p.workdays) and not(day::date=any(p.holidays));
 if p_due<root.due_date then delta:=-delta;end if;
 for t in select * from tasks where id=any(ids) order by id loop
  if t.id=root.id then new_start:=p_start;new_due:=p_due;
  elsif t.status='Done' or t.schedule_pinned then new_start:=t.start_date;new_due:=t.due_date;
  else new_start:=shift_work_date(coalesce(t.start_date,t.due_date),delta,p.workdays,p.holidays);new_due:=shift_work_date(t.due_date,delta,p.workdays,p.holidays);end if;
  if new_due is null then warnings:=warnings||jsonb_build_array('Add dates to '||t.title);end if;
  plan:=plan||jsonb_build_array(jsonb_build_object('id',t.id,'title',t.title,'old_start',t.start_date,'old_due',t.due_date,'start',new_start,'due',new_due,'fixed',t.status='Done' or t.schedule_pinned));
 end loop;
 for r in select a.title,b.title as predecessor,coalesce(pa.value->>'start',a.start_date::text,a.due_date::text)::date as starts,coalesce(pb.value->>'due',b.due_date::text)::date as ends
 from dependencies d join tasks a on a.id=d.task_id join tasks b on b.id=d.depends_on_id
 left join jsonb_array_elements(plan) pa on pa.value->>'id'=a.id::text
 left join jsonb_array_elements(plan) pb on pb.value->>'id'=b.id::text
 where (a.id=any(ids) or b.id=any(ids)) and a.project_id=p.id and b.project_id=p.id loop
  if r.starts<r.ends then warnings:=warnings||jsonb_build_array(r.title||' would overlap predecessor '||r.predecessor);end if;
 end loop;
 if exists(select 1 from task_allocations where task_id=any(ids)) then warnings:=warnings||jsonb_build_array('Clear daily allocations on affected tasks before moving the schedule');end if;
 return jsonb_build_object('project_id',p.id,'fingerprint',planning_fingerprint(p.id),'tasks',plan,'warnings',warnings,'can_apply',jsonb_array_length(warnings)=0,'workday_shift',delta);
end $$;
create function public.apply_task_schedule(p_task uuid,p_start date,p_due date,p_fingerprint text,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;plan jsonb;r jsonb;prior workflow_requests;payload jsonb;begin
 select * into t from tasks where id=p_task;
 if not found or not project_manager(t.workspace_id,t.project_id) then raise exception 'Project owner access required';end if;
 perform 1 from projects where id=t.project_id for update;
 payload:=jsonb_build_object('task',p_task,'start',p_start,'due',p_due,'fingerprint',p_fingerprint);
 select * into prior from workflow_requests where workspace_id=t.workspace_id and request_id=p_request;
 if found then if prior.actor<>auth.uid() or prior.kind<>'schedule' or prior.payload<>payload then raise exception 'Request key already used';end if;return jsonb_build_object('applied',true,'duplicate',true);end if;
 if p_request is null then raise exception 'Request key required';end if;
 perform 1 from tasks where project_id=t.project_id order by id for update;
 if planning_fingerprint(t.project_id) is distinct from p_fingerprint then raise exception 'The plan changed. Preview the schedule again';end if;
 plan:=preview_task_schedule(p_task,p_start,p_due);
 if not (plan->>'can_apply')::boolean then raise exception 'Resolve schedule warnings before applying';end if;
 for r in select value from jsonb_array_elements(plan->'tasks') loop
  if not (r->>'fixed')::boolean then update tasks set start_date=(r->>'start')::date,due_date=(r->>'due')::date where id=(r->>'id')::uuid;end if;
 end loop;
 insert into workflow_requests values(t.workspace_id,p_request,auth.uid(),'schedule',t.id,payload);
 insert into audit_log(workspace_id,action,entity) values(t.workspace_id,'Apply dependency schedule',t.project_id::text);
 return plan||jsonb_build_object('applied',true);
end $$;
create function public.save_task_allocations(p_task uuid,p_days jsonb,p_fingerprint text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;v jsonb;total integer:=0;begin
 select * into t from tasks where id=p_task;
 if not found or not project_manager(t.workspace_id,t.project_id) then raise exception 'Project owner access required';end if;
 perform 1 from projects where id=t.project_id and archived_at is null and deleted_at is null for update;
 if not found then raise exception 'Restore project first';end if;
 perform 1 from tasks where id=t.id for update;
 if planning_fingerprint(t.project_id) is distinct from p_fingerprint then raise exception 'The plan changed. Reload allocations';end if;
 if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days)>367 then raise exception 'Invalid daily allocation';end if;
 if jsonb_array_length(p_days)>0 then
  if t.assignee_id is null or t.start_date is null or t.due_date is null or t.status='Done' then raise exception 'Assign an open task with start and due dates first';end if;
  if exists(select 1 from jsonb_array_elements(p_days) a(value) group by a.value->>'date' having count(*)>1) then raise exception 'Duplicate allocation dates';end if;
  for v in select value from jsonb_array_elements(p_days) loop
   if (v->>'date')::date not between t.start_date and t.due_date or (v->>'minutes')::integer not between 1 and 1440 or v->>'date' is null or v->>'minutes' is null then raise exception 'Use positive daily minutes within task dates';end if;
   total:=total+(v->>'minutes')::integer;
  end loop;
  if total<>coalesce(t.remaining_minutes,t.estimated_minutes,0) then raise exception 'Daily minutes must equal the task remaining effort or estimate';end if;
 end if;
 delete from task_allocations where task_id=t.id;
 insert into task_allocations(workspace_id,project_id,task_id,user_id,work_date,minutes) select t.workspace_id,t.project_id,t.id,t.assignee_id,(a.value->>'date')::date,(a.value->>'minutes')::integer from jsonb_array_elements(p_days) a(value);
 insert into audit_log(workspace_id,action,entity) values(t.workspace_id,'Set daily task allocations',t.id::text);
end $$;
create function public.get_project_planning(p_project uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects;begin select * into p from projects where id=p_project;if not found or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;return jsonb_build_object('fingerprint',planning_fingerprint(p.id));end $$;
create function public.guard_planning_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='tasks' then
  perform 1 from projects where id=coalesce(new.project_id,old.project_id) for update;
  if tg_op='UPDATE' and (new.assignee_id,new.start_date,new.due_date,new.remaining_minutes,new.estimated_minutes) is distinct from (old.assignee_id,old.start_date,old.due_date,old.remaining_minutes,old.estimated_minutes) and exists(select 1 from task_allocations where task_id=old.id) then raise exception 'Clear daily allocations before changing task dates, assignee or effort';end if;
 elsif tg_table_name='dependencies' then
  perform 1 from projects where id in(select project_id from tasks where id in(coalesce(new.task_id,old.task_id),coalesce(new.depends_on_id,old.depends_on_id))) order by id for update;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger planning_task before insert or update or delete on tasks for each row execute function guard_planning_change();
create trigger planning_dependency before insert or update or delete on dependencies for each row execute function guard_planning_change();
revoke all on function preview_task_schedule(uuid,date,date),apply_task_schedule(uuid,date,date,text,uuid),save_task_allocations(uuid,jsonb,text),get_project_planning(uuid) from public;
grant execute on function preview_task_schedule(uuid,date,date),apply_task_schedule(uuid,date,date,text,uuid),save_task_allocations(uuid,jsonb,text),get_project_planning(uuid) to authenticated;
