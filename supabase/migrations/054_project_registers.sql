create table project_registers(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,project_id uuid not null references projects(id) on delete cascade,
 kind text not null check(kind in('Decision','Finding')),title text not null check(length(title) between 1 and 200),details jsonb not null default '{}',
 status text not null,record_date date not null,source_kind text,source_id uuid,is_published boolean not null default false,
 superseded_by uuid references project_registers(id) on delete set null,revision integer not null default 1,created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(num_nonnulls(source_kind,source_id) in(0,2)),check(source_kind is null or source_kind in('Task','Discussion','Review','Document','File')),check(octet_length(details::text)<=40000),check(jsonb_typeof(details)='object')
);
create table project_register_history(
 record_id uuid not null references project_registers(id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade,project_id uuid not null references projects(id) on delete cascade,
 revision integer not null,snapshot jsonb not null,actor uuid not null references auth.users(id),changed_at timestamptz not null default now(),primary key(record_id,revision)
);
create function register_source_allowed(p uuid,k text,s uuid,for_client boolean) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$declare w uuid;begin
 if s is null and k is null then return true;end if;
 select workspace_id into w from projects where id=p;
 case k
 when 'Task' then return exists(select 1 from tasks where id=s and project_id=p and workspace_id=w and(not for_client or(is_published and project_guest(w,p,'tasks'))));
 when 'Discussion' then return exists(select 1 from discussion_threads where id=s and project_id=p and workspace_id=w and deleted_at is null and(not for_client or collab_can_read(s,auth.uid())));
 when 'Review' then return exists(select 1 from deliverable_versions v join project_files f on f.id=v.file_id where v.id=s and v.project_id=p and v.workspace_id=w and(not for_client or(v.is_published and f.is_published and project_guest(w,p,'approvals') and project_guest(w,p,'files'))));
 when 'Document' then return exists(select 1 from client_documents where id=s and project_id=p and workspace_id=w and(not for_client or(client_id=auth.uid() and status in('Shared','Approved','Declined'))));
 when 'File' then return exists(select 1 from project_files where id=s and project_id=p and workspace_id=w and(not for_client or(is_published and project_guest(w,p,'files'))));
 else return false;end case;
end$$;
create function register_visible(r project_registers) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select pms_session_ready() and exists(select 1 from projects where id=r.project_id and workspace_id=r.workspace_id and deleted_at is null and archived_at is null) and(project_staff(r.workspace_id,r.project_id) or(r.is_published and project_guest(r.workspace_id,r.project_id,'discussions') and register_source_allowed(r.project_id,r.source_kind,r.source_id,true) and(r.superseded_by is null or exists(select 1 from project_registers n where n.id=r.superseded_by and n.is_published and register_source_allowed(n.project_id,n.source_kind,n.source_id,true)))));
$$;
alter table project_registers enable row level security;
alter table project_register_history enable row level security;
revoke all on project_registers,project_register_history from public,anon,authenticated;
grant select on project_registers,project_register_history to authenticated;
create policy register_read on project_registers for select to authenticated using(register_visible(project_registers));
create policy register_history_read on project_register_history for select to authenticated using(pms_session_ready() and project_staff(workspace_id,project_id));
create function save_project_register(p_project uuid,record_id uuid,expected_revision integer,record_kind text,record_title text,record_details jsonb,record_status text,record_day date,source_type text,source uuid,published boolean,replacement uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$declare p projects;r project_registers;result uuid;begin
 select * into p from projects where id=p_project for update;
 if not pms_session_ready() or p.id is null or p.archived_at is not null or p.deleted_at is not null or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if record_id is not null then select * into r from project_registers where id=record_id and project_id=p.id for update;if r.id is null or r.revision is distinct from expected_revision then raise exception 'Record changed. Refresh before saving';end if;
 if r.kind<>record_kind then raise exception 'Record type cannot change';end if;
 elsif expected_revision<>0 then raise exception 'New records start at revision zero';end if;
 if record_kind not in('Decision','Finding') or record_kind is null or record_day is null or record_details is null or record_status is null then raise exception 'Complete the record fields';end if;
 if exists(select 1 from jsonb_each(record_details) where jsonb_typeof(value)<>'string') then raise exception 'Record fields must be text';end if;
 if record_kind='Decision' then
 if record_status not in('Proposed','Decided','Superseded','Archived') or nullif(trim(record_details->>'maker'),'') is null or nullif(trim(record_details->>'rationale'),'') is null then raise exception 'Add a decision maker and rationale';end if;
 else
 if record_status not in('Open','In progress','Validated','Dismissed','Archived') or coalesce(record_details->>'evidence_type','') not in('Observation','Hypothesis') or coalesce(record_details->>'severity','') not in('Low','Medium','High','Critical') or nullif(trim(record_details->>'flow'),'') is null or nullif(trim(record_details->>'evidence'),'') is null or nullif(trim(record_details->>'recommendation'),'') is null then raise exception 'Add evidence, flow, severity and recommendation';end if;
 if record_status='Validated' and nullif(trim(record_details->>'validation'),'') is null then raise exception 'Record the validation result before marking validated';end if;
 end if;
 if not register_source_allowed(p.id,source_type,source,false) then raise exception 'Choose a current source in this project';end if;
 if replacement is not null then
 if record_kind<>'Decision' or record_status<>'Superseded' or replacement=record_id or not exists(select 1 from project_registers where id=replacement and project_id=p.id and kind='Decision' and status='Decided' and superseded_by is null and(not published or is_published)) then raise exception 'Choose a current decided replacement in this project with compatible visibility';end if;
 elsif record_status='Superseded' then raise exception 'Choose the replacement decision';end if;
 if record_kind='Finding' and replacement is not null then raise exception 'Findings do not supersede decisions';end if;
 -- Replacements may themselves be superseded, but cannot be withdrawn or made private.
 if r.id is not null and exists(select 1 from project_registers where superseded_by=r.id) and(record_status not in('Decided','Superseded') or not published and r.is_published) then raise exception 'This decision replaces an earlier decision. Preserve its status and visibility';end if;
 if record_id is null then
 insert into project_registers(workspace_id,project_id,kind,title,details,status,record_date,source_kind,source_id,is_published,superseded_by,created_by,updated_by) values(p.workspace_id,p.id,record_kind,trim(record_title),record_details,record_status,record_day,source_type,source,coalesce(published,false),replacement,auth.uid(),auth.uid()) returning id into result;
 else
 update project_registers set title=trim(record_title),details=record_details,status=record_status,record_date=record_day,source_kind=source_type,source_id=source,is_published=coalesce(published,false),superseded_by=replacement,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=r.id;result:=r.id;
 end if;
 insert into project_register_history(record_id,workspace_id,project_id,revision,snapshot,actor) select id,workspace_id,project_id,revision,to_jsonb(x),auth.uid() from project_registers x where id=result;
 insert into audit_log(workspace_id,action,entity) values(p.workspace_id,'project_register_saved',jsonb_build_object('record',result,'kind',record_kind)::text);
 return result;
end$$;
-- Preview uses the actual client's row policies, including dynamic source visibility.
create function preview_project_registers(p_project uuid,p_client uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$declare p projects;claims text:=current_setting('request.jwt.claims',true);sub text:=current_setting('request.jwt.claim.sub',true);result jsonb;begin
 select * into p from projects where id=p_project;
 if not pms_session_ready() or workspace_role(p.workspace_id) is distinct from 'owner' or not exists(select 1 from project_members pm join workspace_members wm using(workspace_id,user_id) where pm.project_id=p.id and pm.user_id=p_client and pm.role='guest' and wm.role='client') then raise exception 'Choose an invited client as administrator';end if;
 perform set_config('request.jwt.claims',(coalesce(nullif(claims,''),'{}')::jsonb||jsonb_build_object('sub',p_client,'role','authenticated'))::text,true);perform set_config('request.jwt.claim.sub',p_client::text,true);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.record_date desc),'[]') into result from project_registers r where project_id=p.id;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);return result;
 exception when others then perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);raise;
end$$;
revoke all on function register_source_allowed(uuid,text,uuid,boolean),register_visible(project_registers),save_project_register(uuid,uuid,integer,text,text,jsonb,text,date,text,uuid,boolean,uuid),preview_project_registers(uuid,uuid) from public,anon,authenticated;
grant execute on function register_visible(project_registers),save_project_register(uuid,uuid,integer,text,text,jsonb,text,date,text,uuid,boolean,uuid),preview_project_registers(uuid,uuid) to authenticated;
