-- Native studio workflows. All conversions and review decisions are atomic.
create table studio_blueprints (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
 name text not null check(length(trim(name)) between 1 and 120), description text not null default '',
 steps jsonb not null default '[]' check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 50),
 created_at timestamptz not null default now(), unique(workspace_id,id)
);
alter table tasks add column estimated_minutes integer not null default 0 check(estimated_minutes between 0 and 60000);
alter table tasks add column phase text not null default '';
create table work_requests (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
 title text not null check(length(trim(title)) between 1 and 200), kind text not null check(kind in ('Website','Brand identity','Campaign','Other')),
 brief text not null check(length(trim(brief)) between 1 and 12000), client_name text not null default '',
 desired_date date, details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 status text not null default 'Submitted' check(status in ('Submitted','Declined','Converted')),
 project_id uuid, created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references projects(workspace_id,id), unique(workspace_id,id)
);
create table deliverables (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200), current_version_id uuid,
 created_at timestamptz not null default now(), unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
alter table project_files add constraint files_project_identity unique(workspace_id,project_id,id);
create table deliverable_versions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, deliverable_id uuid not null,
 file_id uuid not null, version_number integer not null check(version_number>0),
 status text not null default 'Pending' check(status in ('Pending','Approved','Changes requested','Superseded')),
 is_published boolean not null default false, note text not null default '',
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 decided_by uuid references auth.users(id), decided_at timestamptz,
 unique(deliverable_id,version_number), unique(workspace_id,project_id,id),
 foreign key(workspace_id,project_id,deliverable_id) references deliverables(workspace_id,project_id,id),
 foreign key(workspace_id,project_id,file_id) references project_files(workspace_id,project_id,id)
);
alter table deliverables add foreign key(workspace_id,project_id,current_version_id) references deliverable_versions(workspace_id,project_id,id);
create table review_feedback (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, version_id uuid not null,
 body text not null check(length(trim(body)) between 1 and 4000), created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), foreign key(workspace_id,project_id,version_id) references deliverable_versions(workspace_id,project_id,id)
);
create table studio_notifications (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id),
 project_id uuid, title text not null, event_key text not null, read_at timestamptz, created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references projects(workspace_id,id), unique(user_id,event_key)
);
create table studio_ai_usage (
 workspace_id uuid not null references workspaces(id), user_id uuid not null references auth.users(id),
 window_start timestamptz not null, calls integer not null default 1, primary key(workspace_id,user_id,window_start)
);
do $$ declare t text;begin foreach t in array array['studio_blueprints','work_requests','deliverables','deliverable_versions','review_feedback','studio_notifications','studio_ai_usage'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create index on %I(workspace_id)',t);
 execute format('revoke all on %I from anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
end loop;end $$;
grant insert,update,delete on studio_blueprints to authenticated;
grant insert on work_requests,review_feedback to authenticated;
grant update(read_at) on studio_notifications to authenticated;
create policy blueprint_read on studio_blueprints for select to authenticated using(workspace_role(workspace_id) in ('owner','member','contractor'));
create policy blueprint_write on studio_blueprints for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create policy request_read on work_requests for select to authenticated using(workspace_role(workspace_id)='owner' or (workspace_role(workspace_id) is not null and created_by=auth.uid()));
create policy request_create on work_requests for insert to authenticated with check(workspace_role(workspace_id) is not null and created_by=auth.uid() and status='Submitted' and project_id is null);
create policy deliverable_read on deliverables for select to authenticated using(project_staff(workspace_id,project_id) or (project_guest(workspace_id,project_id,'approvals') and exists(select 1 from deliverable_versions v where v.deliverable_id=deliverables.id and v.is_published)));
create policy version_read on deliverable_versions for select to authenticated using(project_staff(workspace_id,project_id) or (is_published and project_guest(workspace_id,project_id,'approvals') and exists(select 1 from project_files f where f.id=file_id and f.is_published)));
create policy feedback_read on review_feedback for select to authenticated using(exists(select 1 from deliverable_versions v where v.id=version_id));
create policy feedback_create on review_feedback for insert to authenticated with check(created_by=auth.uid() and exists(select 1 from deliverable_versions v where v.id=version_id and v.workspace_id=review_feedback.workspace_id and v.project_id=review_feedback.project_id) and (project_staff(workspace_id,project_id) or project_guest(workspace_id,project_id,'approvals')));
create policy notification_read on studio_notifications for select to authenticated using(user_id=auth.uid() and workspace_role(workspace_id) is not null and (project_id is null or project_visible(workspace_id,project_id)));
create policy notification_update on studio_notifications for update to authenticated using(user_id=auth.uid() and workspace_role(workspace_id) is not null) with check(user_id=auth.uid() and workspace_role(workspace_id) is not null);

create function public.convert_work_request(request_id uuid, blueprint_id uuid default null, starts_on date default current_date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r work_requests; b studio_blueprints; p uuid; step jsonb; task_id uuid; previous_id uuid; initial_state text;
begin
 select * into r from work_requests where id=request_id for update;
 if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if r.project_id is not null then return r.project_id;end if;
 if r.status<>'Submitted' then raise exception 'Only submitted requests can become projects';end if;
 if starts_on is null then raise exception 'Choose a start date';end if;
 if blueprint_id is not null then
 select * into b from studio_blueprints where id=blueprint_id and workspace_id=r.workspace_id;
 if not found then raise exception 'Blueprint not found in this workspace';end if;end if;
 select workflow_states[1] into initial_state from workspaces where id=r.workspace_id;
 insert into projects(workspace_id,name,description,brief,client_name,start_date,due_date) values(r.workspace_id,r.title,r.kind||' request',r.brief||E'\n\nRequest details: '||r.details::text,r.client_name,starts_on,r.desired_date) returning id into p;
 for step in select value from jsonb_array_elements(coalesce(b.steps,'[]')) loop
 if length(trim(coalesce(step->>'title',''))) not between 1 and 200 or coalesce((step->>'offset_days')::integer,-1) not between 0 and 3650 or coalesce((step->>'estimated_minutes')::integer,-1) not between 0 and 60000 then raise exception 'Invalid blueprint step';end if;
 insert into tasks(workspace_id,project_id,title,description,status,due_date,phase,estimated_minutes) values(r.workspace_id,p,trim(step->>'title'),coalesce(step->>'description',''),coalesce(initial_state,'To do'),starts_on+(step->>'offset_days')::integer,coalesce(step->>'phase',''),(step->>'estimated_minutes')::integer) returning id into task_id;
 if coalesce((step->>'after_previous')::boolean,false) and previous_id is not null then insert into dependencies values(r.workspace_id,task_id,previous_id);end if;
 previous_id:=task_id;
 end loop;
 update work_requests set status='Converted',project_id=p where id=r.id;
 insert into studio_notifications(workspace_id,user_id,title,event_key) values(r.workspace_id,r.created_by,'Your request was accepted: '||r.title,'request-converted:'||r.id) on conflict do nothing;
 insert into audit_log(workspace_id,action,entity) values(r.workspace_id,'request_converted',r.id::text||':'||p::text);
 return p;
end $$;
create function public.decline_work_request(request_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r work_requests;begin select * into r from work_requests where id=request_id for update;
if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
if r.status<>'Submitted' then raise exception 'Request already reviewed';end if;
update work_requests set status='Declined' where id=r.id;
insert into studio_notifications(workspace_id,user_id,title,event_key) values(r.workspace_id,r.created_by,'Your request was declined: '||r.title,'request-declined:'||r.id) on conflict do nothing;
end $$;
create function public.add_deliverable_version(p uuid, file uuid, label text, deliverable uuid default null, shared boolean default false, version_note text default '') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare pr projects; d deliverables; f project_files; v uuid; n integer;
begin
 select * into pr from projects where id=p for update;
 if not found or not project_manager(pr.workspace_id,p) then raise exception 'Project owner access required';end if;
 if pr.archived_at is not null or pr.deleted_at is not null then raise exception 'Restore this project before requesting review';end if;
 select * into f from project_files where id=file and workspace_id=pr.workspace_id and project_id=p;
 if not found then raise exception 'Choose a file from this project';end if;
 if shared and (not f.is_published or not ('files'=any(pr.client_tools)) or not ('approvals'=any(pr.client_tools))) then raise exception 'Enable Files and Approvals for clients and share this file first';end if;
 if deliverable is null then insert into deliverables(workspace_id,project_id,title) values(pr.workspace_id,p,trim(label)) returning * into d;
 else select * into d from deliverables where id=deliverable and workspace_id=pr.workspace_id and project_id=p for update;
 if not found then raise exception 'Deliverable not found';end if;end if;
 if exists(select 1 from deliverable_versions where deliverable_id=d.id and file_id=file) then raise exception 'Upload a new file for a new version';end if;
 select coalesce(max(version_number),0)+1 into n from deliverable_versions where deliverable_id=d.id;
 update deliverable_versions set status='Superseded' where id=d.current_version_id and status='Pending';
 insert into deliverable_versions(workspace_id,project_id,deliverable_id,file_id,version_number,is_published,note) values(pr.workspace_id,p,d.id,file,n,shared,left(version_note,4000)) returning id into v;
 update deliverables set current_version_id=v where id=d.id;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key)
 select pr.workspace_id,m.user_id,p,'Ready for review: '||d.title||' · v'||n,'review:'||v from workspace_members m
 where m.workspace_id=pr.workspace_id and (m.role='owner' or exists(select 1 from project_members pm where pm.project_id=p and pm.user_id=m.user_id and (pm.role='owner' or (shared and pm.role='guest')))) on conflict do nothing;
 return v;
end $$;
create function public.decide_deliverable_version(version_id uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v deliverable_versions; d deliverables;begin
 -- Serialize decisions and new revisions on the same project lock.
 select * into v from deliverable_versions where id=version_id;
 if not found then raise exception 'Review not found';end if;
 perform 1 from projects where id=v.project_id for update;
 select * into v from deliverable_versions where id=version_id for update;
 select * into d from deliverables where id=v.deliverable_id;
 if not (project_manager(v.workspace_id,v.project_id) or (v.is_published and project_guest(v.workspace_id,v.project_id,'approvals') and project_guest(v.workspace_id,v.project_id,'files') and exists(select 1 from project_files where id=v.file_id and is_published))) then raise exception 'Not authorized';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' then raise exception 'This version is no longer awaiting a decision';end if;
 update deliverable_versions set status=decision,decided_by=auth.uid(),decided_at=now() where id=v.id;
 insert into audit_log(workspace_id,action,entity) values(v.workspace_id,'review:'||decision,v.id::text);
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,v.created_by,v.project_id,decision||': '||d.title||' · v'||v.version_number,'review-decision:'||v.id) on conflict do nothing;
end $$;
-- A review references immutable file content; existing files are never rewritten.
create function public.guard_review_file() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if exists(select 1 from deliverable_versions where file_id=old.id) and (tg_op='DELETE' or new.path is distinct from old.path or new.provider is distinct from old.provider or new.project_id is distinct from old.project_id or new.workspace_id is distinct from old.workspace_id) then raise exception 'This file is part of a review record. Upload a new version instead';end if;return coalesce(new,old);end $$;
create trigger preserve_review_files before update or delete on project_files for each row execute function guard_review_file();
create function public.notify_new_request() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
insert into studio_notifications(workspace_id,user_id,title,event_key) select new.workspace_id,user_id,'New request: '||new.title,'request:'||new.id from workspace_members where workspace_id=new.workspace_id and role='owner' on conflict do nothing;return new;end $$;
create trigger request_notification after insert on work_requests for each row execute function notify_new_request();
create function public.studio_due_reminders() returns void language sql security definer set search_path=public,pg_temp as $$
insert into studio_notifications(workspace_id,user_id,project_id,title,event_key)
select t.workspace_id,t.assignee_id,t.project_id,'Due soon: '||t.title,'due:'||t.id||':'||t.due_date from tasks t join projects p on p.id=t.project_id
where t.assignee_id is not null and t.status<>'Done' and t.due_date between current_date and current_date+1 and p.archived_at is null and p.deleted_at is null
on conflict do nothing;
$$;
-- Hosted in Postgres, independent of a running browser or local worker.
select cron.schedule('studio-due-reminders','0 * * * *','select public.studio_due_reminders()');
create function public.consume_studio_ai(w uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;begin
if workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
insert into studio_ai_usage values(w,auth.uid(),date_trunc('hour',now()),1) on conflict(workspace_id,user_id,window_start) do update set calls=studio_ai_usage.calls+1 returning calls into n;
if n>20 then raise exception 'AI hourly limit reached. Try again next hour';end if;
end $$;
do $$ declare fn regprocedure;begin foreach fn in array array['convert_work_request(uuid,uuid,date)'::regprocedure,'decline_work_request(uuid)'::regprocedure,'add_deliverable_version(uuid,uuid,text,uuid,boolean,text)'::regprocedure,'decide_deliverable_version(uuid,text)'::regprocedure,'consume_studio_ai(uuid)'::regprocedure] loop execute format('revoke all on function %s from public',fn);execute format('grant execute on function %s to authenticated',fn);end loop;end $$;
revoke all on function public.studio_due_reminders() from public,authenticated,anon;

create function public.is_reviewed_file(object_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select exists(select 1 from project_files f join deliverable_versions v on v.file_id=f.id where f.path=object_path);
$$;
revoke all on function public.is_reviewed_file(text) from public;
grant execute on function public.is_reviewed_file(text) to authenticated;
create policy preserve_review_objects on storage.objects as restrictive for delete to authenticated using(bucket_id<>'project-files' or not public.is_reviewed_file(name));
create policy preserve_review_object_updates on storage.objects as restrictive for update to authenticated using(bucket_id<>'project-files' or not public.is_reviewed_file(name)) with check(bucket_id<>'project-files' or not public.is_reviewed_file(name));
alter table comments add constraint comment_project_identity unique(workspace_id,project_id,id);
alter table tasks add column source_comment_id uuid;
alter table tasks add foreign key(workspace_id,project_id,source_comment_id) references comments(workspace_id,project_id,id) on delete set null (source_comment_id);
create unique index task_source_comment on tasks(source_comment_id) where source_comment_id is not null;
create function public.task_from_discussion(comment_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c comments; t uuid; initial_state text;begin
select * into c from comments where id=comment_id for update;
if not found or not project_staff(c.workspace_id,c.project_id) then raise exception 'Project staff access required';end if;
if exists(select 1 from projects where id=c.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Restore this project first';end if;
select id into t from tasks where source_comment_id=c.id;if found then return t;end if;
select workflow_states[1] into initial_state from workspaces where id=c.workspace_id;
insert into tasks(workspace_id,project_id,title,description,status,source_comment_id) values(c.workspace_id,c.project_id,left(c.body,120),c.body,coalesce(initial_state,'To do'),c.id) returning id into t;
return t;end $$;
revoke all on function public.task_from_discussion(uuid) from public;
grant execute on function public.task_from_discussion(uuid) to authenticated;
