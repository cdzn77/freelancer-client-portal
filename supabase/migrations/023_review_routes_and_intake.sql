create table review_stages (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,version_id uuid not null references deliverable_versions(id),
 position integer not null check(position between 1 and 10),reviewer_id uuid not null references auth.users(id),
 status text not null default 'Pending' check(status in ('Pending','Approved','Changes requested')),decided_at timestamptz,
 unique(version_id,position),unique(version_id,reviewer_id),foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
alter table review_stages enable row level security;grant select on review_stages to authenticated;
create policy review_stage_read on review_stages for select to authenticated using(exists(select 1 from deliverable_versions v where v.id=version_id));
create function public.configure_review_stages(version uuid,reviewers uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v deliverable_versions; d deliverables; reviewer uuid; n integer:=0;begin
 select * into v from deliverable_versions where id=version;
 if not found or not project_manager(v.workspace_id,v.project_id) then raise exception 'Project owner access required';end if;
 perform 1 from projects where id=v.project_id for update;
 select * into v from deliverable_versions where id=version for update;
 select * into d from deliverables where id=v.deliverable_id;
 if d.current_version_id<>v.id or v.status<>'Pending' or d.archived_at is not null or d.deleted_at is not null then raise exception 'Only an active pending version can have reviewers';end if;
 if cardinality(reviewers) not between 1 and 10 or reviewers is null then raise exception 'Choose 1 to 10 reviewers';end if;
 if exists(select 1 from review_stages where version_id=v.id and status<>'Pending') then raise exception 'A decision is already recorded; start a new version to change reviewers';end if;
 delete from review_stages where version_id=v.id;
 foreach reviewer in array reviewers loop
 if not exists(select 1 from workspace_members m join projects p on p.id=v.project_id where m.workspace_id=v.workspace_id and m.user_id=reviewer and (m.role='owner' or (m.role in ('member','contractor') and (p.access_type='workspace' or exists(select 1 from project_members pm where pm.project_id=p.id and pm.user_id=reviewer and pm.role in ('owner','member')))) or (m.role='client' and v.is_published and 'approvals'=any(p.client_tools) and 'files'=any(p.client_tools) and exists(select 1 from project_members pm where pm.project_id=p.id and pm.user_id=reviewer and pm.role='guest') and exists(select 1 from project_files f where f.id=v.file_id and f.is_published)))) then raise exception 'Every reviewer needs access to this version and file';end if;
 n:=n+1;insert into review_stages(workspace_id,project_id,version_id,position,reviewer_id) values(v.workspace_id,v.project_id,v.id,n,reviewer);
 end loop;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,reviewers[1],v.project_id,'Your review stage is ready','review-stage:'||v.id||':1:'||reviewers[1]) on conflict do nothing;
end $$;
create function public.decide_review_stage(stage uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s review_stages; v deliverable_versions; d deliverables; upcoming review_stages;begin
 select * into s from review_stages where id=stage;
 if not found then raise exception 'Stage not found';end if;
 perform 1 from projects where id=s.project_id for update;
 select * into s from review_stages where id=stage for update;
 select * into v from deliverable_versions where id=s.version_id for update;
 select * into d from deliverables where id=v.deliverable_id;
 if s.reviewer_id is distinct from auth.uid() or not(project_staff(s.workspace_id,s.project_id) or (v.is_published and project_guest(s.workspace_id,s.project_id,'approvals') and project_guest(s.workspace_id,s.project_id,'files') and exists(select 1 from project_files where id=v.file_id and is_published))) then raise exception 'Only the assigned reviewer can decide';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' or d.archived_at is not null or d.deleted_at is not null or s.status<>'Pending' then raise exception 'This stage is no longer awaiting a decision';end if;
 if exists(select 1 from review_stages where version_id=v.id and position<s.position and status<>'Approved') then raise exception 'Earlier reviewers must approve first';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 update review_stages set status=decision,decided_at=now() where id=s.id;
 if decision='Changes requested' then update deliverable_versions set status=decision,decided_at=now(),decided_by=auth.uid() where id=v.id;
 elsif not exists(select 1 from review_stages where version_id=v.id and status<>'Approved') then update deliverable_versions set status='Approved',decided_at=now(),decided_by=auth.uid() where id=v.id;
 else select * into upcoming from review_stages where version_id=v.id and status='Pending' order by position limit 1;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(s.workspace_id,upcoming.reviewer_id,s.project_id,'Your review stage is ready','review-stage:'||v.id||':'||upcoming.position||':'||upcoming.reviewer_id) on conflict do nothing;end if;
 insert into audit_log(workspace_id,action,entity) values(s.workspace_id,'review_stage:'||decision,s.id::text);
end $$;
revoke all on function public.configure_review_stages(uuid,uuid[]),public.decide_review_stage(uuid,text) from public;
grant execute on function public.configure_review_stages(uuid,uuid[]),public.decide_review_stage(uuid,text) to authenticated;
-- Existing single-review RPC cannot bypass a configured review chain.
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
 if exists(select 1 from review_stages where version_id=v.id) then raise exception 'Use the assigned review stages';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' then raise exception 'This version is no longer awaiting a decision';end if;
 update deliverable_versions set status=decision,decided_by=auth.uid(),decided_at=now() where id=v.id;
 insert into audit_log(workspace_id,action,entity) values(v.workspace_id,'review:'||decision,v.id::text);
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,v.created_by,v.project_id,decision||': '||d.title||' · v'||v.version_number,'review-decision:'||v.id) on conflict do nothing;
end $$;
create or replace function public.valid_review_annotation(a jsonb) returns boolean language sql immutable as $$
 select a is null or coalesce(jsonb_typeof(a)='object' and
 case a->>'type'
 when 'image' then jsonb_typeof(a->'x')='number' and jsonb_typeof(a->'y')='number' and (a->>'x')::numeric between 0 and 1 and (a->>'y')::numeric between 0 and 1
 when 'pdf' then jsonb_typeof(a->'page')='number' and (a->>'page')::numeric between 1 and 10000 and (a->>'page')::numeric=trunc((a->>'page')::numeric) and
 (not(a ? 'rect') or (jsonb_typeof(a->'rect')='object' and (a->'rect'->>'x')::numeric between 0 and 1 and (a->'rect'->>'y')::numeric between 0 and 1 and (a->'rect'->>'width')::numeric>0 and (a->'rect'->>'height')::numeric>0 and (a->'rect'->>'x')::numeric+(a->'rect'->>'width')::numeric<=1 and (a->'rect'->>'y')::numeric+(a->'rect'->>'height')::numeric<=1))
 else false end,false)
$$;
create table intake_links (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),token text not null unique default encode(gen_random_bytes(24),'hex'),
 title text not null check(length(trim(title)) between 1 and 120),description text not null default '' check(length(description)<=2000),
 enabled boolean not null default true,expires_on date,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now()
);
create table intake_rate_limits (link_id uuid references intake_links(id) on delete cascade,fingerprint text,window_start timestamptz,count integer not null,primary key(link_id,fingerprint,window_start));
alter table intake_links enable row level security;alter table intake_rate_limits enable row level security;
grant select,insert,update,delete on intake_links to authenticated;
create policy intake_manage on intake_links for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner' and created_by=auth.uid());
create function public.submit_public_intake(link_token text,fingerprint text,title text,brief text,client_name text,email text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare link intake_links;n integer;result uuid;begin
 select * into link from intake_links where token=link_token for update;
 if not found or not link.enabled or link.expires_on<current_date or workspace_role(link.workspace_id) is not null then
 -- Service-role calls normally have no end-user identity. Expiry and revocation always apply.
 if link.id is null or not link.enabled or link.expires_on<current_date then raise exception 'This intake form is unavailable';end if;end if;
 if not exists(select 1 from workspace_members where workspace_id=link.workspace_id and user_id=link.created_by and role='owner') then raise exception 'This intake form is unavailable';end if;
 if length(trim(title)) not between 1 and 200 or length(trim(brief)) not between 1 and 12000 or length(client_name)>200 or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(fingerprint)<>64 then raise exception 'Check the form fields';end if;
 insert into intake_rate_limits values(link.id,fingerprint,date_trunc('hour',now()),1) on conflict(link_id,fingerprint,window_start) do update set count=intake_rate_limits.count+1 returning count into n;
 if n>5 then raise exception 'Too many submissions. Try again later';end if;
 select sum(count) into n from intake_rate_limits where link_id=link.id and window_start=date_trunc('hour',now());
 if n>30 then raise exception 'This form has reached its hourly limit. Try again later';end if;
 insert into work_requests(workspace_id,title,kind,brief,client_name,details,created_by) values(link.workspace_id,trim(title),'Other',trim(brief),client_name,jsonb_build_object('contact_email',email,'source','Public intake: '||link.title),link.created_by) returning id into result;
 delete from intake_rate_limits where window_start<now()-interval '2 days';return result;
end $$;
revoke all on function public.submit_public_intake(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_public_intake(text,text,text,text,text,text) to service_role;

create table email_preferences (workspace_id uuid not null references workspaces(id),user_id uuid not null default auth.uid() references auth.users(id),enabled boolean not null default false,primary key(workspace_id,user_id));
create table studio_email_jobs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),notification_id uuid not null unique references studio_notifications(id) on delete cascade,user_id uuid not null references auth.users(id),
 status text not null default 'Queued' check(status in ('Queued','Sending','Sent','Preview','Failed','Skipped')),attempts integer not null default 0,available_at timestamptz not null default now(),lease_id uuid,last_error text,sent_at timestamptz,created_at timestamptz not null default now()
);
alter table email_preferences enable row level security;alter table studio_email_jobs enable row level security;
grant select,insert,update on email_preferences to authenticated;grant select on studio_email_jobs to authenticated;
create policy own_email_preferences on email_preferences for all to authenticated using(user_id=auth.uid() and workspace_role(workspace_id) is not null) with check(user_id=auth.uid() and workspace_role(workspace_id) is not null);
create policy own_email_history on studio_email_jobs for select to authenticated using(workspace_role(workspace_id)='owner' or (user_id=auth.uid() and workspace_role(workspace_id) is not null));
create function public.queue_studio_email() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if exists(select 1 from email_preferences where workspace_id=new.workspace_id and user_id=new.user_id and enabled) then insert into studio_email_jobs(workspace_id,notification_id,user_id) values(new.workspace_id,new.id,new.user_id) on conflict do nothing;end if;return new;end $$;
create trigger email_after_notification after insert on studio_notifications for each row execute function queue_studio_email();
create function public.claim_studio_email_jobs(only_workspace uuid default null) returns setof studio_email_jobs language sql security definer set search_path=public,pg_temp as $$
 update studio_email_jobs set status='Sending',attempts=attempts+1,available_at=now()+interval '10 minutes',lease_id=gen_random_uuid()
 where id in (select id from studio_email_jobs where (only_workspace is null or workspace_id=only_workspace) and status in ('Queued','Sending') and available_at<=now() and attempts<5 order by created_at for update skip locked limit 5) returning *;
$$;
revoke all on function public.claim_studio_email_jobs(uuid) from public,anon,authenticated;grant execute on function public.claim_studio_email_jobs(uuid) to service_role;
