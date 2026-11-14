-- Extend the existing blueprint and approval systems; preserve all applied plans.
alter table studio_blueprints add column setup jsonb not null default '{}' check(jsonb_typeof(setup)='object' and octet_length(setup::text)<2000);
alter table blueprint_applications add column setup jsonb not null default '{}';
alter table blueprint_applications add column assignments jsonb not null default '{}';
alter table tasks add column blueprint_application_id uuid references blueprint_applications(id) on delete set null;
alter table tasks add column approval_required boolean not null default false;
alter table tasks add column approval_version_id uuid references deliverable_versions(id);
alter table tasks add column approval_document_id uuid references client_documents(id);
alter table tasks add column approval_opened_at timestamptz;
alter table tasks add column reminder_workdays integer check(reminder_workdays between 0 and 10);
alter table tasks add column reminder_timezone text not null default 'UTC';
alter table tasks add constraint one_task_approval_source check(approval_version_id is null or approval_document_id is null);

create function playbook_approved(t tasks) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select not t.approval_required or
 exists(select 1 from deliverable_versions v join deliverables d on d.id=v.deliverable_id where v.id=t.approval_version_id and v.workspace_id=t.workspace_id and v.project_id=t.project_id and v.is_published and d.current_version_id=v.id and v.status='Approved') or
 exists(select 1 from client_documents d where d.id=t.approval_document_id and d.workspace_id=t.workspace_id and d.project_id=t.project_id and d.status='Approved')
$$;
create function guard_playbook_task() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or (new.approval_required,new.approval_version_id,new.approval_document_id,new.reminder_workdays,new.reminder_timezone,new.blueprint_application_id) is distinct from (old.approval_required,old.approval_version_id,old.approval_document_id,old.reminder_workdays,old.reminder_timezone,old.blueprint_application_id) then
  if (new.approval_required or new.approval_version_id is not null or new.approval_document_id is not null or new.reminder_workdays is not null or new.blueprint_application_id is not null or tg_op='UPDATE') and auth.role()='authenticated' and not project_manager(new.workspace_id,new.project_id) then raise exception 'Project owner access required to configure checkpoints';end if;
  if not exists(select 1 from pg_timezone_names where name=new.reminder_timezone) then raise exception 'Choose a valid reminder timezone';end if;
  if new.blueprint_application_id is not null and not exists(select 1 from blueprint_applications a where a.id=new.blueprint_application_id and a.project_id=new.project_id and a.workspace_id=new.workspace_id) then raise exception 'Invalid applied blueprint';end if;
  if new.approval_version_id is not null and not exists(select 1 from deliverable_versions v join deliverables d on d.id=v.deliverable_id join project_files f on f.id=v.file_id where v.id=new.approval_version_id and v.workspace_id=new.workspace_id and v.project_id=new.project_id and v.is_published and f.is_published and d.current_version_id=v.id) then raise exception 'Choose the current shared review version from this project';end if;
  if new.approval_document_id is not null and not exists(select 1 from client_documents d where d.id=new.approval_document_id and d.workspace_id=new.workspace_id and d.project_id=new.project_id and d.status in ('Shared','Discussion','Approved') and d.kind in ('Estimate','Contract','Project agreement','Creative brief')) then raise exception 'Choose a shared agreement or brief from this project';end if;
 end if;
 if tg_op='INSERT' or (new.approval_version_id,new.approval_document_id) is distinct from (old.approval_version_id,old.approval_document_id) then
  new.approval_opened_at:=case when new.approval_version_id is not null or new.approval_document_id is not null then now() else null end;
 elsif auth.role()='authenticated' then new.approval_opened_at:=old.approval_opened_at;
 end if;
 if new.approval_document_id is not null and (tg_op='INSERT' or new.approval_document_id is distinct from old.approval_document_id) and auth.role()='authenticated' and workspace_role(new.workspace_id)<>'owner' then raise exception 'Administrator access required for agreement links';end if;
 if new.status='Done' and (tg_op='INSERT' or new.status is distinct from old.status or (new.approval_required,new.approval_version_id,new.approval_document_id) is distinct from (old.approval_required,old.approval_version_id,old.approval_document_id)) and not playbook_approved(new) then raise exception 'Record approval of the linked agreement or review version before completing this checkpoint';end if;
 if tg_op='UPDATE' and new.blueprint_application_id is not null and new.status is distinct from old.status and new.status in ('In progress','Done') and exists(select 1 from dependencies d join tasks predecessor on predecessor.id=d.depends_on_id where d.task_id=new.id and (predecessor.status<>'Done' or not playbook_approved(predecessor))) then raise exception 'Complete the prerequisite tasks before starting or completing this task';end if;
 return new;
end $$;
create trigger playbook_task_guard before insert or update on tasks for each row execute function guard_playbook_task();

create function configure_task_checkpoint(p_task uuid,p_required boolean,p_version uuid default null,p_document uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;begin
 select * into t from tasks where id=p_task for update;
 if not pms_session_ready() or t.id is null or not project_manager(t.workspace_id,t.project_id) then raise exception 'Project owner access required';end if;
 if exists(select 1 from projects where id=t.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Restore project first';end if;
 if p_document is not null and workspace_role(t.workspace_id)<>'owner' then raise exception 'Administrator access required for agreement links';end if;
 if p_required is null or (not p_required and (p_version is not null or p_document is not null)) then raise exception 'Invalid checkpoint';end if;
 update tasks set approval_required=p_required,approval_version_id=p_version,approval_document_id=p_document where id=t.id;
 insert into audit_log(workspace_id,action,entity) values(t.workspace_id,'task_checkpoint_configured',t.id::text);
end $$;
create function task_checkpoint_snapshot(p_task uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;manager boolean;begin
 select * into t from tasks where id=p_task;
 if not pms_session_ready() or t.id is null or not exists(select 1 from projects where id=t.project_id and deleted_at is null) or not(project_staff(t.workspace_id,t.project_id) or(t.is_published and project_guest(t.workspace_id,t.project_id,'tasks'))) then raise exception 'Task unavailable';end if;
 manager:=project_manager(t.workspace_id,t.project_id);
 return jsonb_build_object('required',t.approval_required,'approved',playbook_approved(t),'manager',manager,
 'version',case when exists(select 1 from deliverable_versions v where v.id=t.approval_version_id and (project_staff(t.workspace_id,t.project_id) or (v.is_published and project_guest(t.workspace_id,t.project_id,'approvals') and project_guest(t.workspace_id,t.project_id,'files')))) then t.approval_version_id else null end,
 'document',case when exists(select 1 from client_documents d where d.id=t.approval_document_id and(workspace_role(t.workspace_id)='owner' or(d.client_id=auth.uid() and d.status<>'Draft'))) then t.approval_document_id else null end,
 'reviews',case when manager then(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',d.title||' · v'||v.version_number,'status',v.status)),'[]') from deliverable_versions v join deliverables d on d.current_version_id=v.id join project_files f on f.id=v.file_id where v.project_id=t.project_id and v.is_published and f.is_published) else '[]'::jsonb end,
 'documents',case when workspace_role(t.workspace_id)='owner' then(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title||' · v'||d.version,'status',d.status)),'[]') from client_documents d where d.project_id=t.project_id and d.status in('Shared','Discussion','Approved') and d.kind in('Estimate','Contract','Project agreement','Creative brief')) else '[]'::jsonb end);
end $$;

create function apply_studio_blueprint_plan(blueprint_id uuid,project_id uuid,starts_on date,assignments jsonb default '{}',timezone text default 'UTC') returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare b studio_blueprints;p projects;application uuid;step jsonb;ids uuid[]:='{}';tid uuid;who uuid;kind text;idx integer:=0;dep integer;initial text;d date;label text;hidden boolean;thread uuid;friday date;begin
 select * into p from projects where id=project_id for update;
 if not pms_session_ready() or p.id is null or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore the project before applying a blueprint';end if;
 select * into b from studio_blueprints where id=blueprint_id and workspace_id=p.workspace_id for share;
 if b.id is null or b.archived_at is not null or b.deleted_at is not null then raise exception 'Choose an active blueprint from this workspace';end if;
 select id into application from blueprint_applications a where a.project_id=p.id and a.blueprint_id=b.id;
 if found then return application;end if;
 if starts_on is null or jsonb_typeof(assignments)<>'object' or not exists(select 1 from pg_timezone_names where name=timezone) then raise exception 'Choose a start date, owners and timezone';end if;
 select s into initial from workspaces w,unnest(w.workflow_states) with ordinality x(s,n) where w.id=p.workspace_id and s<>'Done' order by n limit 1;
 insert into blueprint_applications(workspace_id,project_id,blueprint_id,blueprint_name,blueprint_revision,steps,starts_on,setup,assignments) values(p.workspace_id,p.id,b.id,b.name,b.revision,b.steps,starts_on,b.setup||jsonb_build_object('workdays',p.workdays,'holidays',p.holidays,'timezone',timezone),assignments) returning id into application;
 for step in select value from jsonb_array_elements(b.steps) loop
  idx:=idx+1;kind:=coalesce(step->>'owner_role','unassigned');who:=null;
  if length(trim(coalesce(step->>'title',''))) not between 1 and 200 or coalesce((step->>'offset_days')::integer,-1) not between 0 and 3650 or coalesce((step->>'estimated_minutes')::integer,-1) not between 0 and 60000 or kind not in('unassigned','lead','client','reviewer') or length(coalesce(step->>'description',''))>2000 then raise exception 'Invalid blueprint step %',idx;end if;
  if kind<>'unassigned' then
   who:=nullif(assignments->>kind,'')::uuid;
   if who is null and kind='lead' then who:=auth.uid();end if;
   if who is null then raise exception 'Choose a person for the % role before applying this blueprint',kind;end if;
   if not collab_person(p.workspace_id,p.id,who) then raise exception 'Invite each selected person to this project first';end if;
   if kind='client' then
    if not coalesce((step->>'shared')::boolean,false) or not exists(select 1 from workspace_members m join project_members pm on pm.workspace_id=m.workspace_id and pm.user_id=m.user_id where m.workspace_id=p.workspace_id and m.user_id=who and m.role='client' and pm.project_id=p.id and pm.role='guest') then raise exception 'Client steps must be shared and assigned to an invited client';end if;
   elsif not exists(select 1 from workspace_members where workspace_id=p.workspace_id and user_id=who and role in('owner','member','contractor')) then raise exception 'Select a team member for %',kind;end if;
  end if;
  -- Existing blueprints keep calendar-day offsets. The UX preset uses workdays.
  d:=case when coalesce((b.setup->>'ux_audit')::boolean,false) then shift_work_date(starts_on,(step->>'offset_days')::integer,p.workdays,p.holidays) else starts_on+(step->>'offset_days')::integer end;
  if coalesce((b.setup->>'ux_audit')::boolean,false) and (not extract(dow from d)::integer=any(p.workdays) or d=any(p.holidays)) then d:=shift_work_date(d,1,p.workdays,p.holidays);end if;
  insert into tasks(workspace_id,project_id,title,description,status,due_date,phase,estimated_minutes,assignee_id,is_published,blueprint_application_id,approval_required,reminder_workdays,reminder_timezone) values(p.workspace_id,p.id,trim(step->>'title'),coalesce(step->>'description',''),coalesce(initial,'To do'),d,coalesce(step->>'phase',''),(step->>'estimated_minutes')::integer,who,coalesce((step->>'shared')::boolean,false),application,coalesce((step->>'approval_gate')::boolean,false),case when kind='client' then 2 else null end,timezone) returning id into tid;
  ids:=array_append(ids,tid);
  if step ? 'depends_on' and jsonb_typeof(step->'depends_on')<>'array' then raise exception 'Invalid dependencies';end if;
  for dep in select distinct value::integer from jsonb_array_elements_text(coalesce(step->'depends_on','[]')) loop
   if dep<1 or dep>=idx then raise exception 'Step dependencies must point to an earlier step';end if;
   insert into dependencies values(p.workspace_id,tid,ids[dep]);
  end loop;
  if coalesce((step->>'after_previous')::boolean,false) and idx>1 then insert into dependencies values(p.workspace_id,tid,ids[idx-1]) on conflict do nothing;end if;
 end loop;
 if exists(select 1 from tasks where blueprint_application_id=application and is_published) then update projects set client_tools=array(select distinct unnest(client_tools||array['tasks'])) where id=p.id;end if;
 if coalesce((b.setup->>'ux_audit')::boolean,false) then
  update projects set client_tools=array(select distinct unnest(client_tools||array['discussions','approvals','files'])) where id=p.id;
  foreach label in array array['Kickoff questions','Decisions','Kickoff notes','Interview guide','Internal'] loop
   hidden:=label in('Interview guide','Internal');
   insert into discussion_threads(workspace_id,project_id,title,description,hidden_from_clients,pinned,created_by) values(p.workspace_id,p.id,label,case label
    when 'Decisions' then 'For each decision, add the date, decision, decision maker and a link to its source task or review. Record reversals as new entries. Use Review work or Documents & payments for formal approval.'
    when 'Kickoff notes' then 'Record agreed goals, scope, decision makers, client inputs and next steps. Do not include credentials or private interview details.'
    when 'Interview guide' then 'Internal interview plan. Record research goals, consent procedure and questions. Keep identifying participant details to the minimum needed.'
    when 'Internal' then 'Private staffing, QA and pricing discussion.' else 'Questions about the agreed UX audit and how to use this project workspace.' end,hidden,label in('Decisions','Kickoff notes'),auth.uid()) returning id into thread;
   insert into discussion_subscribers values(thread,auth.uid()) on conflict do nothing;
   if not hidden and nullif(assignments->>'client','') is not null then insert into discussion_subscribers values(thread,(assignments->>'client')::uuid) on conflict do nothing;end if;
  end loop;
  friday:=greatest(starts_on,(now() at time zone timezone)::date);while extract(dow from friday)<>5 loop friday:=friday+1;end loop;
  perform save_task_recurrence(p.id,'Weekly status','Post a reviewed update in the shared Kickoff questions thread: Done. Next. Waiting on the client. Never copy internal notes automatically.','Medium',coalesce(nullif(assignments->>'lead','')::uuid,auth.uid()),0,'weekly',timezone,friday,null);
 end if;
 insert into audit_log(workspace_id,action,entity) values(p.workspace_id,'blueprint_applied',application::text);
 return application;
end $$;
create or replace function apply_studio_blueprint(blueprint_id uuid,project_id uuid,starts_on date) returns uuid language sql security definer set search_path=public,pg_temp as $$select apply_studio_blueprint_plan(blueprint_id,project_id,starts_on,'{}','UTC')$$;

create function process_playbook_reminders() returns void language plpgsql security definer set search_path=public,pg_temp as $$begin
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,task_id)
 select t.workspace_id,t.assignee_id,t.project_id,'Client input due soon: '||t.title,'playbook-due:'||t.id||':'||t.due_date||':'||t.assignee_id,t.id
 from tasks t join projects p on p.id=t.project_id where t.reminder_workdays is not null and t.assignee_id is not null and t.is_published and 'tasks'=any(p.client_tools) and t.status<>'Done' and p.archived_at is null and p.deleted_at is null and collab_person(t.workspace_id,t.project_id,t.assignee_id)
 and (now() at time zone t.reminder_timezone)::date between shift_work_date(t.due_date,-t.reminder_workdays,p.workdays,p.holidays) and t.due_date on conflict do nothing;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,task_id)
 select t.workspace_id,m.user_id,t.project_id,'Approval follow-up: '||t.title,'playbook-review:'||t.id||':'||t.approval_opened_at,t.id
 from tasks t join projects p on p.id=t.project_id join workspace_members m on m.workspace_id=t.workspace_id and m.role='owner'
 where t.approval_required and t.approval_opened_at is not null and t.status<>'Done' and not playbook_approved(t) and p.archived_at is null and p.deleted_at is null
 and (now() at time zone t.reminder_timezone)::date>=shift_work_date((t.approval_opened_at at time zone t.reminder_timezone)::date,3,p.workdays,p.holidays) on conflict do nothing;
end $$;
select cron.schedule('studio-playbook-reminders','15 * * * *','select public.process_playbook_reminders()');
-- Hosted defaults may grant roles directly: revoke every internal helper explicitly.
revoke all on function playbook_approved(tasks),guard_playbook_task(),process_playbook_reminders(),apply_studio_blueprint_plan(uuid,uuid,date,jsonb,text),configure_task_checkpoint(uuid,boolean,uuid,uuid),task_checkpoint_snapshot(uuid),apply_studio_blueprint(uuid,uuid,date) from public,anon,authenticated;
grant execute on function apply_studio_blueprint_plan(uuid,uuid,date,jsonb,text),configure_task_checkpoint(uuid,boolean,uuid,uuid),task_checkpoint_snapshot(uuid),apply_studio_blueprint(uuid,uuid,date) to authenticated;
grant execute on function process_playbook_reminders() to service_role;
create or replace function revise_studio_blueprint() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if new.workspace_id<>old.workspace_id or new.id<>old.id then raise exception 'Blueprint identity cannot change';end if;
 new.revision:=old.revision+case when(new.name,new.description,new.steps,new.setup) is distinct from(old.name,old.description,old.steps,old.setup) then 1 else 0 end;return new;
end $$;
revoke all on function revise_studio_blueprint() from public,anon,authenticated;
notify pgrst,'reload schema';

-- Explicit project purge removes checkpoint references before its review graph.
do $$declare definition text;begin
 select pg_get_functiondef('public.purge_trash(uuid,text,uuid[])'::regprocedure) into definition;
 if position('pids:=ids;' in definition)=0 then raise exception 'Review project purge before extending it';end if;
 definition:=replace(definition,'pids:=ids;', 'pids:=ids; delete from task_allocations where workspace_id=w and project_id=any(pids); update tasks set assignee_id=null,approval_required=false,approval_version_id=null,approval_document_id=null,blueprint_application_id=null where workspace_id=w and project_id=any(pids);');
 execute definition;
end $$;
