-- Existing role values are retained for compatibility: owner = Administrator,
-- member = Regular user, client = Client/Guest. contractor remains a restricted legacy regular user.
alter table projects add column access_type text not null default 'invite_only' check(access_type in ('invite_only','workspace'));
alter table projects add column client_tools text[] not null default '{}' check(client_tools <@ array['tasks','discussions','files','approvals','brief']);
alter table projects add column shared_brief text not null default '';
create table project_members(workspace_id uuid not null,project_id uuid not null,user_id uuid not null,role text not null check(role in ('owner','member','guest')),primary key(workspace_id,project_id,user_id),foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade,foreign key(workspace_id,user_id) references workspace_members(workspace_id,user_id) on delete cascade);
create index on project_members(user_id,project_id);
create table project_details(workspace_id uuid not null,project_id uuid not null,brief text not null default '',primary key(workspace_id,project_id),foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade);
insert into project_details select workspace_id,id,brief from projects;
update projects set brief='';
alter table tasks add column is_published boolean not null default false;
alter table comments add column is_published boolean not null default false;
alter table approvals add column is_published boolean not null default false;
create table project_files(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,path text not null unique,name text not null,provider text not null default 'supabase' check(provider in ('supabase','minio','r2')),is_published boolean not null default false,created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade,check(path like workspace_id::text||'/'||project_id::text||'/%'));
-- Preserve explicit task assignments and creators. Admins see all projects regardless.
insert into project_members select distinct p.workspace_id,p.id,m.user_id,case when m.user_id=p.created_by then 'owner' else 'member' end from projects p join workspace_members m on m.workspace_id=p.workspace_id where m.role<>'client' and (m.user_id=p.created_by or exists(select 1 from tasks t where t.project_id=p.id and t.assignee_id=m.user_id)) on conflict do nothing;
-- Existing guests retain project membership, but all content now requires explicit sharing.
insert into project_members select p.workspace_id,p.id,m.user_id,'guest' from projects p join workspace_members m on m.workspace_id=p.workspace_id where m.role='client' on conflict do nothing;
create function public.project_staff(w uuid,p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select coalesce(public.workspace_role(w)='owner' or (public.workspace_role(w) in ('member','contractor') and exists(select 1 from projects q where q.id=p and q.workspace_id=w and (q.access_type='workspace' or exists(select 1 from project_members pm where pm.workspace_id=w and pm.project_id=p and pm.user_id=auth.uid() and pm.role in ('owner','member'))))),false) $$;
create function public.project_manager(w uuid,p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select coalesce(public.workspace_role(w)='owner' or (public.workspace_role(w) in ('member','contractor') and exists(select 1 from project_members where workspace_id=w and project_id=p and user_id=auth.uid() and role='owner')),false) $$;
create function public.project_guest(w uuid,p uuid,tool text default null) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select coalesce(public.workspace_role(w)='client' and exists(select 1 from project_members pm join projects q on q.id=pm.project_id and q.workspace_id=pm.workspace_id where pm.workspace_id=w and pm.project_id=p and pm.user_id=auth.uid() and pm.role='guest' and (tool is null or tool=any(q.client_tools))),false) $$;
create function public.project_visible(w uuid,p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.project_staff(w,p) or public.project_guest(w,p) $$;
-- Drop all earlier permissive policies before replacing them, because RLS policies combine with OR.
do $$ declare r record;begin for r in select tablename,policyname from pg_policies where schemaname='public' and tablename not in ('workspaces','workspace_members','pms_schema_migrations') loop execute format('drop policy %I on public.%I',r.policyname,r.tablename);end loop;end $$;
alter table project_members enable row level security;
alter table project_details enable row level security;
alter table project_files enable row level security;
grant select,insert,update,delete on project_members,project_details,project_files to authenticated;
create policy projects_read on projects for select to authenticated using(public.project_visible(workspace_id,id));
create policy projects_create on projects for insert to authenticated with check(public.workspace_role(workspace_id)='owner' and created_by=auth.uid());
create policy projects_edit on projects for update to authenticated using(public.project_manager(workspace_id,id)) with check(public.project_manager(workspace_id,id));
create policy projects_delete on projects for delete to authenticated using(public.workspace_role(workspace_id)='owner');
create policy project_members_read on project_members for select to authenticated using(public.project_visible(workspace_id,project_id));
-- Membership writes are exclusively via checked RPCs.
create policy details_read on project_details for select to authenticated using(public.project_staff(workspace_id,project_id));
create policy details_insert on project_details for insert to authenticated with check(public.project_manager(workspace_id,project_id));
create policy details_update on project_details for update to authenticated using(public.project_manager(workspace_id,project_id)) with check(public.project_manager(workspace_id,project_id));
create policy tasks_read on tasks for select to authenticated using(public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'tasks')));
create policy tasks_create on tasks for insert to authenticated with check(public.project_staff(workspace_id,project_id));
create policy tasks_edit on tasks for update to authenticated using(public.project_staff(workspace_id,project_id)) with check(public.project_staff(workspace_id,project_id));
create policy tasks_delete on tasks for delete to authenticated using(public.project_staff(workspace_id,project_id));
create policy comments_read on comments for select to authenticated using(public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'discussions')));
create policy comments_create on comments for insert to authenticated with check(created_by=auth.uid() and (public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'discussions'))));
create policy comments_edit on comments for update to authenticated using(public.project_manager(workspace_id,project_id)) with check(public.project_manager(workspace_id,project_id));
create policy approvals_read on approvals for select to authenticated using(public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'approvals')));
create policy approvals_create on approvals for insert to authenticated with check(public.project_manager(workspace_id,project_id));
create policy approvals_edit on approvals for update to authenticated using(public.project_manager(workspace_id,project_id)) with check(public.project_manager(workspace_id,project_id));
create policy files_read on project_files for select to authenticated using(public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'files')));
create policy files_create on project_files for insert to authenticated with check(created_by=auth.uid() and public.project_staff(workspace_id,project_id));
create policy files_edit on project_files for update to authenticated using(public.project_manager(workspace_id,project_id)) with check(public.project_manager(workspace_id,project_id));
create policy time_read on time_entries for select to authenticated using(public.workspace_role(workspace_id)='owner' or (created_by=auth.uid() and public.project_staff(workspace_id,project_id)));
create policy time_create on time_entries for insert to authenticated with check(public.project_staff(workspace_id,project_id) and created_by=auth.uid() and status='Submitted');
create policy time_edit on time_entries for update to authenticated using(public.workspace_role(workspace_id)='owner') with check(public.workspace_role(workspace_id)='owner');
create policy dependencies_read on dependencies for select to authenticated using(exists(select 1 from tasks a join tasks b on b.id=depends_on_id and b.workspace_id=a.workspace_id where a.id=task_id and a.workspace_id=dependencies.workspace_id and public.project_staff(a.workspace_id,a.project_id) and public.project_staff(b.workspace_id,b.project_id)));
create policy dependencies_write on dependencies for all to authenticated using(exists(select 1 from tasks t where t.id=task_id and t.workspace_id=dependencies.workspace_id and public.project_staff(t.workspace_id,t.project_id))) with check(exists(select 1 from tasks a join tasks b on b.id=depends_on_id and b.workspace_id=a.workspace_id where a.id=task_id and a.workspace_id=dependencies.workspace_id and public.project_staff(a.workspace_id,a.project_id) and public.project_staff(b.workspace_id,b.project_id)));
create policy templates_read on templates for select to authenticated using(public.workspace_role(workspace_id) in ('owner','member','contractor'));
create policy templates_write on templates for all to authenticated using(public.workspace_role(workspace_id)='owner') with check(public.workspace_role(workspace_id)='owner');
do $$ declare t text;begin foreach t in array array['budgets','estimates','invoices','retainers','clients','users','estimate_lines','invoice_lines','expenses','assets','proofs','proof_comments','forms','dashboards','report_defs','audit_log','budget_alerts'] loop execute format('create policy admin_read on %I for select to authenticated using(public.workspace_role(workspace_id)=''owner'')',t);if t not in ('audit_log','budget_alerts') then execute format('create policy admin_write on %I for all to authenticated using(public.workspace_role(workspace_id)=''owner'') with check(public.workspace_role(workspace_id)=''owner'')',t);end if;end loop;end $$;
-- Keep internal briefs off rows visible to guests, including raw REST requests.
create function public.capture_project_brief() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.id<>old.id or new.created_by is distinct from old.created_by) then raise exception 'Project identity cannot be changed';end if;
if tg_op='UPDATE' and new.brief<>'' then insert into project_details(workspace_id,project_id,brief) values(new.workspace_id,new.id,new.brief) on conflict(workspace_id,project_id) do update set brief=excluded.brief;new.brief='';end if;return new;end $$;
create trigger project_private_brief before update on projects for each row execute function capture_project_brief();
create function public.initialize_project_access() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
if new.created_by is not null then insert into project_members values(new.workspace_id,new.id,new.created_by,'owner') on conflict do nothing;end if;
insert into project_details(workspace_id,project_id,brief) values(new.workspace_id,new.id,new.brief) on conflict do nothing;
if new.brief<>'' then update projects set brief='' where id=new.id;end if;
return new;end $$;
create trigger project_access after insert on projects for each row execute function initialize_project_access();
create function public.guard_publishing() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.project_id<>old.project_id) then raise exception 'Content cannot be moved between projects';end if;
if (tg_op='INSERT' and new.is_published) or (tg_op='UPDATE' and new.is_published is distinct from old.is_published) then
if not public.project_manager(new.workspace_id,new.project_id) and not (tg_table_name='comments' and tg_op='INSERT' and public.project_guest(new.workspace_id,new.project_id,'discussions')) and auth.role()<>'service_role' then raise exception 'Only project owners can publish content';end if;end if;return new;end $$;
create trigger tasks_publishing before insert or update on tasks for each row execute function guard_publishing();
create trigger comments_publishing before insert or update on comments for each row execute function guard_publishing();
create trigger approvals_publishing before insert or update on approvals for each row execute function guard_publishing();
create trigger files_publishing before insert or update on project_files for each row execute function guard_publishing();
create or replace function public.decide_approval(approval_id uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare a approvals;begin select * into a from approvals where id=approval_id; if not(public.project_manager(a.workspace_id,a.project_id) or (a.is_published and public.project_guest(a.workspace_id,a.project_id,'approvals'))) then raise exception 'Not authorized';end if;if decision not in ('Approved','Changes requested') or decision is null then raise exception 'Invalid decision';end if;update approvals set status=decision where id=approval_id;insert into audit_log(workspace_id,action,entity) values(a.workspace_id,decision,approval_id::text);end $$;
create function public.manage_workspace_member(w uuid,target uuid,new_role text default null,remove_member boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare current_role text;begin
perform 1 from workspaces where id=w for update;
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Only administrators can manage account members';end if;
select role into current_role from workspace_members where workspace_id=w and user_id=target;if current_role is null then raise exception 'Member not found';end if;
if not remove_member and (new_role is null or new_role not in ('owner','member','client')) then raise exception 'Choose Administrator, Regular user, or Client/Guest';end if;
if current_role='owner' and (remove_member or new_role<>'owner') and (select count(*) from workspace_members where workspace_id=w and role='owner')<=1 then raise exception 'Keep at least one administrator';end if;
if remove_member then update tasks set assignee_id=null where workspace_id=w and assignee_id=target;delete from project_members where workspace_id=w and user_id=target;delete from workspace_members where workspace_id=w and user_id=target;
else update workspace_members set role=new_role where workspace_id=w and user_id=target;update project_members set role=case when new_role='client' then 'guest' when role='guest' then 'member' else role end where workspace_id=w and user_id=target;end if;
insert into audit_log(workspace_id,action,entity) values(w,case when remove_member then 'member_removed' else 'role_changed:'||new_role end,target::text);end $$;
create function public.manage_project_member(w uuid,p uuid,target uuid,project_role text default 'member',remove_member boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare account_role text;begin
perform 1 from projects where workspace_id=w and id=p for update;
if not public.project_manager(w,p) then raise exception 'Only project owners or administrators can manage access';end if;
select role into account_role from workspace_members where workspace_id=w and user_id=target;if account_role is null then raise exception 'Add this person to the account first';end if;
if remove_member then update tasks set assignee_id=null where workspace_id=w and project_id=p and assignee_id=target;delete from project_members where workspace_id=w and project_id=p and user_id=target;
else if project_role is null or project_role not in ('owner','member','guest') or (account_role='client' and project_role<>'guest') or (account_role<>'client' and project_role='guest') then raise exception 'Guests cannot own projects; choose a role matching the account type';end if;insert into project_members values(w,p,target,project_role) on conflict(workspace_id,project_id,user_id) do update set role=excluded.role;end if;
insert into audit_log(workspace_id,action,entity) values(w,case when remove_member then 'project_member_removed' else 'project_role:'||project_role end,p::text||':'||target::text);end $$;
create or replace function public.add_workspace_member(w uuid,member_email text,member_role text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare u uuid;display text;begin
perform 1 from workspaces where id=w for update;
if public.workspace_role(w) is distinct from 'owner' then raise exception 'Only administrators can add members';end if;if member_role is null or member_role not in ('owner','member','client') then raise exception 'Choose Administrator, Regular user, or Client/Guest';end if;
select id,coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1)) into u,display from auth.users where lower(email)=lower(trim(member_email));if u is null then raise exception 'This person must create an account first';end if;insert into workspace_members(workspace_id,user_id,role,display_name) values(w,u,member_role,left(display,100));end $$;
-- Financial alert RPC is now account-admin only.
create or replace function public.claim_budget_alerts(w uuid) returns table(name text,burn numeric,amount numeric) language plpgsql security definer set search_path=public,pg_temp as $$ begin if public.workspace_role(w) is distinct from 'owner' then raise exception 'Not authorized';end if;return query with claimed as(update budget_alerts set claimed=true where workspace_id=w and not claimed returning project_id) select p.name,sum(t.minutes/60.0*t.bill_rate),b.amount from claimed c join projects p on p.id=c.project_id and p.workspace_id=w join budgets b on b.project_id=p.id and b.workspace_id=w join time_entries t on t.project_id=p.id and t.workspace_id=w and t.billable group by p.name,b.amount;end $$;
-- Scoped file paths: workspace/project/file. Legacy workspace-only files are admin-only.
drop policy file_read on storage.objects;drop policy file_insert on storage.objects;drop policy file_delete on storage.objects;
create policy file_read on storage.objects for select to authenticated using(bucket_id='project-files' and (public.workspace_role((storage.foldername(name))[1]::uuid)='owner' or exists(select 1 from project_files f where f.path=name)));
create policy file_insert on storage.objects for insert to authenticated with check(bucket_id='project-files' and public.project_staff((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
create policy file_delete on storage.objects for delete to authenticated using(bucket_id='project-files' and public.workspace_role((storage.foldername(name))[1]::uuid)='owner');
-- All helper functions expose authorization decisions only. Mutations remain narrow RPCs.
do $$ declare fn regprocedure;begin foreach fn in array array['public.project_staff(uuid,uuid)'::regprocedure,'public.project_manager(uuid,uuid)'::regprocedure,'public.project_guest(uuid,uuid,text)'::regprocedure,'public.project_visible(uuid,uuid)'::regprocedure,'public.manage_workspace_member(uuid,uuid,text,boolean)'::regprocedure,'public.manage_project_member(uuid,uuid,uuid,text,boolean)'::regprocedure] loop execute format('revoke all on function %s from public',fn);execute format('grant execute on function %s to authenticated',fn);end loop;end $$;
