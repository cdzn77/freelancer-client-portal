-- Reversible removal preserves linked project plans and review evidence.
alter table studio_blueprints add column archived_at timestamptz, add column deleted_at timestamptz;
alter table work_requests add column archived_at timestamptz, add column deleted_at timestamptz;
alter table deliverables add column archived_at timestamptz, add column deleted_at timestamptz;
alter table studio_notifications add column archived_at timestamptz, add column deleted_at timestamptz;
revoke delete on studio_blueprints from authenticated;
create function public.set_studio_item_state(item_kind text, item_id uuid, next_state text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare w uuid; permitted boolean:=false; r work_requests; d deliverables; n studio_notifications; target_table text;
begin
 if next_state is null or next_state not in ('archive','trash','restore') then raise exception 'Invalid action';end if;
 case item_kind
 when 'blueprint' then
   target_table:='studio_blueprints';
   select workspace_id into w from studio_blueprints where id=item_id for update;
   permitted:=workspace_role(w)='owner';
 when 'request' then
   target_table:='work_requests';
   select * into r from work_requests where id=item_id for update;w:=r.workspace_id;
   permitted:=workspace_role(w)='owner' or (workspace_role(w) is not null and r.created_by=auth.uid() and r.status='Submitted');
 when 'deliverable' then
   target_table:='deliverables';
   select * into d from deliverables where id=item_id;
   perform 1 from projects where id=d.project_id for update;
   select * into d from deliverables where id=item_id for update;w:=d.workspace_id;
   permitted:=project_manager(w,d.project_id);
 when 'notification' then
   target_table:='studio_notifications';
   select * into n from studio_notifications where id=item_id for update;w:=n.workspace_id;
   permitted:=n.user_id=auth.uid() and workspace_role(w) is not null;
 else raise exception 'Invalid item type';
 end case;
 if w is null or permitted is distinct from true then raise exception 'Not authorized to manage this item';end if;
 execute format('update %I set archived_at=case when $2=''archive'' then now() else null end, deleted_at=case when $2=''trash'' then now() else null end where id=$1',target_table) using item_id,next_state;
 insert into audit_log(workspace_id,action,entity) values(w,'studio_'||next_state,item_kind||':'||item_id::text);
end $$;
revoke all on function public.set_studio_item_state(text,uuid,text) from public;
grant execute on function public.set_studio_item_state(text,uuid,text) to authenticated;
create or replace function public.apply_studio_blueprint(blueprint_id uuid, project_id uuid, starts_on date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare b studio_blueprints; p projects; application_id uuid; step jsonb; tid uuid; previous_id uuid; initial_state text;
begin
 select * into p from projects where id=project_id for update;
 if not found or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore the project before applying a blueprint';end if;
 select * into b from studio_blueprints where id=blueprint_id and workspace_id=p.workspace_id for share;
 if not found then raise exception 'Blueprint not found in this workspace';end if;
 if b.archived_at is not null or b.deleted_at is not null then raise exception 'Restore the blueprint before applying it';end if;
 select a.id into application_id from blueprint_applications a where a.project_id=p.id and a.blueprint_id=b.id;
 if found then return application_id;end if;
 if starts_on is null then raise exception 'Choose a start date';end if;
 insert into blueprint_applications(workspace_id,project_id,blueprint_id,blueprint_name,blueprint_revision,steps,starts_on) values(p.workspace_id,p.id,b.id,b.name,b.revision,b.steps,starts_on) returning id into application_id;
 select workflow_states[1] into initial_state from workspaces where id=p.workspace_id;
 for step in select value from jsonb_array_elements(b.steps) loop
 if length(trim(coalesce(step->>'title',''))) not between 1 and 200 or coalesce((step->>'offset_days')::integer,-1) not between 0 and 3650 or coalesce((step->>'estimated_minutes')::integer,-1) not between 0 and 60000 then raise exception 'Invalid blueprint step';end if;
 insert into tasks(workspace_id,project_id,title,description,status,due_date,phase,estimated_minutes) values(p.workspace_id,p.id,trim(step->>'title'),coalesce(step->>'description',''),coalesce(initial_state,'To do'),starts_on+(step->>'offset_days')::integer,coalesce(step->>'phase',''),(step->>'estimated_minutes')::integer) returning id into tid;
 if coalesce((step->>'after_previous')::boolean,false) and previous_id is not null then insert into dependencies values(p.workspace_id,tid,previous_id);end if;
 previous_id:=tid;
 end loop;
 insert into audit_log(workspace_id,action,entity) values(p.workspace_id,'blueprint_applied',application_id::text);
 return application_id;
end $$;
create or replace function public.convert_work_request(request_id uuid, blueprint_id uuid default null, starts_on date default current_date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r work_requests; p uuid;
begin
 select * into r from work_requests where id=request_id for update;
 if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if r.archived_at is not null or r.deleted_at is not null then raise exception 'Restore the request first';end if;
 if r.project_id is not null then return r.project_id;end if;
 if r.status<>'Submitted' then raise exception 'Only submitted requests can become projects';end if;
 if starts_on is null then raise exception 'Choose a start date';end if;
 insert into projects(workspace_id,name,description,brief,client_name,start_date,due_date) values(r.workspace_id,r.title,r.kind||' request',r.brief||E'\n\nRequest details: '||r.details::text,r.client_name,starts_on,r.desired_date) returning id into p;
 if blueprint_id is not null then perform apply_studio_blueprint(blueprint_id,p,starts_on);end if;
 update work_requests set status='Converted',project_id=p where id=r.id;
 insert into studio_notifications(workspace_id,user_id,title,event_key) values(r.workspace_id,r.created_by,'Your request was accepted: '||r.title,'request-converted:'||r.id) on conflict do nothing;
 insert into audit_log(workspace_id,action,entity) values(r.workspace_id,'request_converted',r.id::text||':'||p::text);
 return p;
end $$;

create or replace function public.decline_work_request(request_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r work_requests;begin select * into r from work_requests where id=request_id for update;
if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
if r.archived_at is not null or r.deleted_at is not null then raise exception 'Restore the request first';end if;
 if r.status<>'Submitted' then raise exception 'Request already reviewed';end if;
update work_requests set status='Declined' where id=r.id;
insert into studio_notifications(workspace_id,user_id,title,event_key) values(r.workspace_id,r.created_by,'Your request was declined: '||r.title,'request-declined:'||r.id) on conflict do nothing;
end $$;

create or replace function public.add_deliverable_version(p uuid, file uuid, label text, deliverable uuid default null, shared boolean default false, version_note text default '') returns uuid
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
 if d.archived_at is not null or d.deleted_at is not null then raise exception 'Restore the deliverable first';end if;
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

create or replace function public.decide_deliverable_version(version_id uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v deliverable_versions; d deliverables;begin
 -- Serialize decisions and new revisions on the same project lock.
 select * into v from deliverable_versions where id=version_id;
 if not found then raise exception 'Review not found';end if;
 perform 1 from projects where id=v.project_id for update;
 select * into v from deliverable_versions where id=version_id for update;
 select * into d from deliverables where id=v.deliverable_id;
 if not (project_manager(v.workspace_id,v.project_id) or (v.is_published and project_guest(v.workspace_id,v.project_id,'approvals') and project_guest(v.workspace_id,v.project_id,'files') and exists(select 1 from project_files where id=v.file_id and is_published))) then raise exception 'Not authorized';end if;
 if d.archived_at is not null or d.deleted_at is not null then raise exception 'Restore the deliverable first';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' then raise exception 'This version is no longer awaiting a decision';end if;
 update deliverable_versions set status=decision,decided_by=auth.uid(),decided_at=now() where id=v.id;
 insert into audit_log(workspace_id,action,entity) values(v.workspace_id,'review:'||decision,v.id::text);
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,v.created_by,v.project_id,decision||': '||d.title||' · v'||v.version_number,'review-decision:'||v.id) on conflict do nothing;
end $$;

create function public.guard_inactive_review_feedback() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from deliverables d join deliverable_versions v on v.deliverable_id=d.id where v.id=new.version_id and d.archived_at is null and d.deleted_at is null for share of d;
 if not found then raise exception 'Restore the deliverable before adding feedback';end if;
 return new;
end $$;
create trigger active_review_feedback before insert on review_feedback for each row execute function guard_inactive_review_feedback();
