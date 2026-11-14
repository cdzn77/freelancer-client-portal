alter table studio_blueprints add column revision integer not null default 1;
create function public.revise_studio_blueprint() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if new.workspace_id<>old.workspace_id or new.id<>old.id then raise exception 'Blueprint identity cannot change';end if;
new.revision:=old.revision+case when (new.name,new.description,new.steps) is distinct from (old.name,old.description,old.steps) then 1 else 0 end;
return new;end $$;
create trigger blueprint_revision before update on studio_blueprints for each row execute function revise_studio_blueprint();
create table blueprint_applications (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, blueprint_id uuid not null,
 blueprint_name text not null, blueprint_revision integer not null, steps jsonb not null,
 starts_on date not null, created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references projects(workspace_id,id), foreign key(workspace_id,blueprint_id) references studio_blueprints(workspace_id,id),
 unique(project_id,blueprint_id)
);
alter table blueprint_applications enable row level security;
revoke all on blueprint_applications from anon,authenticated;
grant select on blueprint_applications to authenticated;
create index on blueprint_applications(workspace_id);
create policy application_read on blueprint_applications for select to authenticated using(project_staff(workspace_id,project_id));
create function public.apply_studio_blueprint(blueprint_id uuid, project_id uuid, starts_on date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare b studio_blueprints; p projects; application_id uuid; step jsonb; tid uuid; previous_id uuid; initial_state text;
begin
 select * into p from projects where id=project_id for update;
 if not found or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore the project before applying a blueprint';end if;
 select * into b from studio_blueprints where id=blueprint_id and workspace_id=p.workspace_id for share;
 if not found then raise exception 'Blueprint not found in this workspace';end if;
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
revoke all on function public.apply_studio_blueprint(uuid,uuid,date) from public;
grant execute on function public.apply_studio_blueprint(uuid,uuid,date) to authenticated;
create or replace function public.convert_work_request(request_id uuid, blueprint_id uuid default null, starts_on date default current_date) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r work_requests; p uuid;
begin
 select * into r from work_requests where id=request_id for update;
 if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
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
