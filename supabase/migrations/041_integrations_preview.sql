create table task_code_links(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,task_id uuid not null,
 url text not null check(url ~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(issues|pull)/[1-9][0-9]*$'),
 metadata jsonb not null default '{}',checked_at timestamptz,unique(task_id,url),
 foreign key(workspace_id,project_id,task_id) references tasks(workspace_id,project_id,id) on delete cascade
);
alter table task_code_links enable row level security;
grant select,insert,update,delete on task_code_links to authenticated;
create policy code_links_read on task_code_links for select to authenticated using(project_staff(workspace_id,project_id));
create policy code_links_manage on task_code_links for all to authenticated using(project_manager(workspace_id,project_id)) with check(project_manager(workspace_id,project_id));
create function public.create_assistant_task(p_project uuid,p_title text,p_description text,p_due date,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects; prior workflow_requests;result uuid;payload jsonb;begin
 select * into p from projects where id=p_project for update;
 if not found or not project_staff(p.workspace_id,p.id) or p.archived_at is not null or p.deleted_at is not null then raise exception 'Active project access required';end if;
 if p_request is null or length(trim(p_title)) not between 1 and 200 or length(p_description)>12000 then raise exception 'Invalid task';end if;
 payload:=jsonb_build_object('project',p_project,'title',p_title,'description',p_description,'due',p_due);
 select * into prior from workflow_requests where workspace_id=p.workspace_id and request_id=p_request;
 if found then if prior.actor<>auth.uid() or prior.kind<>'task' or prior.payload<>payload then raise exception 'Request key already used';end if;return prior.result_id;end if;
 insert into tasks(workspace_id,project_id,title,description,due_date,is_published,status) select p.workspace_id,p.id,trim(p_title),p_description,p_due,false,workflow_states[1] from workspaces where id=p.workspace_id returning id into result;
 insert into workflow_requests values(p.workspace_id,p_request,auth.uid(),'task',result,payload);
 insert into audit_log(workspace_id,action,entity) values(p.workspace_id,'Create private assistant task',result::text);return result;
end $$;
revoke all on function create_assistant_task(uuid,text,text,date,uuid) from public;
grant execute on function create_assistant_task(uuid,text,text,date,uuid) to authenticated;

-- Invoke existing row policies as the selected client, inside this read-only RPC only.
-- No client token is minted and the administrator session is never replaced.
create function public.preview_client_project(p_project uuid,p_client uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p projects; result jsonb; claims text:=current_setting('request.jwt.claims',true); sub text:=current_setting('request.jwt.claim.sub',true);begin
 select * into p from projects where id=p_project;
 if not found or workspace_role(p.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if not exists(select 1 from project_members pm join workspace_members wm using(workspace_id,user_id) where pm.project_id=p.id and pm.user_id=p_client and pm.role='guest' and wm.role='client') then raise exception 'Choose an invited client for this project';end if;
 perform set_config('request.jwt.claims',(coalesce(nullif(claims,''),'{}')::jsonb||jsonb_build_object('sub',p_client,'role','authenticated'))::text,true);
 perform set_config('request.jwt.claim.sub',p_client::text,true);
 result:=jsonb_build_object(
 'projects',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from projects t where id=p.id),
 'project_shared_briefs',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from project_shared_briefs t where project_id=p.id),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from tasks t where project_id=p.id),
 'comments',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from comments t where project_id=p.id),
 'approvals',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from approvals t where project_id=p.id),
 'project_files',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from project_files t where project_id=p.id),
 'project_members',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from project_members t where project_id=p.id),
 'members',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from workspace_members t where workspace_id=p.workspace_id),
 'deliverables',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from deliverables t where project_id=p.id),
 'deliverable_versions',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from deliverable_versions t where project_id=p.id),
 'review_feedback',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from review_feedback t where project_id=p.id),
 'review_stages',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from review_stages t where project_id=p.id),
 'scope_changes',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from scope_changes t where project_id=p.id));
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 return result;
exception when others then
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);raise;
end $$;
revoke all on function preview_client_project(uuid,uuid) from public;
grant execute on function preview_client_project(uuid,uuid) to authenticated;
-- Apply the same session gate as older tables to all new user-facing tables.
do $$ declare t text;begin foreach t in array array['invoice_sources','client_accounts','project_groups','task_allocations','task_code_links'] loop
 execute format('create policy pms_session_security on %I as restrictive for all to authenticated using ((select pms_session_ready())) with check ((select pms_session_ready()))',t);
end loop;end $$;
notify pgrst,'reload schema';
