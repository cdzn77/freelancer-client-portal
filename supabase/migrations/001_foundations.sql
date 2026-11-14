create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create table public.workspaces (id uuid primary key default gen_random_uuid(), workspace_id uuid generated always as (id) stored, name text not null check(length(name) between 1 and 120), workflow_states text[] not null default array['To do','In progress','In review','Done'], created_at timestamptz not null default now());
create table public.workspace_members (workspace_id uuid not null references public.workspaces(id) on delete cascade, user_id uuid not null references auth.users(id), role text not null check(role in ('owner','member','contractor','client')), display_name text not null, primary key(workspace_id,user_id));
create function public.workspace_role(w uuid) returns text language sql stable security definer set search_path=public as $$ select role from workspace_members where workspace_id=w and user_id=auth.uid() $$;
revoke all on function public.workspace_role(uuid) from public;
grant execute on function public.workspace_role(uuid) to authenticated;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
create policy workspace_read on workspaces for select to authenticated using(public.workspace_role(id) is not null);
create policy workspace_update on workspaces for update to authenticated using(public.workspace_role(id)='owner') with check(public.workspace_role(id)='owner');
create policy members_read on workspace_members for select to authenticated using(public.workspace_role(workspace_id) is not null);
create function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path=public as $$ declare w uuid; begin
if auth.uid() is null then raise exception 'Sign in first'; end if;
insert into workspaces(name) values(trim(workspace_name)) returning id into w;
insert into workspace_members values(w,auth.uid(),'owner',coalesce(auth.jwt()->>'email','Studio owner'));
return w; end $$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
create table projects (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), name text not null check(length(name)>0), description text not null default '', brief text not null default '', type text not null default 'fixed_fee' check(type in ('fixed_fee','time_materials','retainer')), status text not null default 'In progress', color text not null default 'coral', start_date date default current_date, due_date date, client_name text not null default '', created_by uuid default auth.uid() references auth.users(id), created_at timestamptz default now(), unique(workspace_id,id));
create table tasks (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), project_id uuid not null, parent_task_id uuid, title text not null check(length(title)>0), description text not null default '', status text not null default 'To do', priority text not null default 'Medium' check(priority in ('Low','Medium','High')), due_date date, assignee_id uuid, custom_fields jsonb not null default '{}', created_by uuid default auth.uid() references auth.users(id), created_at timestamptz default now(), unique(workspace_id,id), unique(workspace_id,project_id,id), foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade, foreign key(workspace_id,project_id,parent_task_id) references tasks(workspace_id,project_id,id), foreign key(workspace_id,assignee_id) references workspace_members(workspace_id,user_id));
create table dependencies(workspace_id uuid not null references workspaces(id), task_id uuid not null, depends_on_id uuid not null, primary key(workspace_id,task_id,depends_on_id), foreign key(workspace_id,task_id) references tasks(workspace_id,id) on delete cascade, foreign key(workspace_id,depends_on_id) references tasks(workspace_id,id) on delete cascade, check(task_id<>depends_on_id));
create table templates(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null,tasks jsonb not null default '[]');
create table time_entries(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,description text not null,minutes integer not null check(minutes>0 and minutes<=1440),billable boolean not null default true,cost_rate numeric not null default 0 check(cost_rate>=0),bill_rate numeric not null default 0 check(bill_rate>=0),status text not null default 'Submitted' check(status in ('Submitted','Approved','Rejected')),entry_date date not null default current_date,created_by uuid not null default auth.uid() references auth.users(id),foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table budgets(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,amount numeric not null check(amount>0),unique(workspace_id,project_id),foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table estimates(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,number text not null,client_name text not null,status text not null default 'Draft',due_date date,notes text not null default '',lines jsonb not null default '[]',foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table invoices(like estimates including defaults including constraints including indexes);
alter table invoices add foreign key(workspace_id) references workspaces(id);
alter table invoices add foreign key(workspace_id,project_id) references projects(workspace_id,id);
create table retainers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,period date not null,hours numeric not null check(hours>=0),rollover numeric not null default 0 check(rollover>=0),used numeric not null default 0 check(used>=0),unique(workspace_id,project_id,period),foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table comments(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,body text not null check(length(body)>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table approvals(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid not null,label text not null,status text not null default 'Pending' check(status in ('Pending','Approved','Changes requested')),created_at timestamptz not null default now(),foreign key(workspace_id,project_id) references projects(workspace_id,id));
create table audit_log(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),actor uuid default auth.uid(),action text not null,entity text not null,created_at timestamptz not null default now());
-- Future domain containers are tenant-protected from creation. Their UI is intentionally deferred.
do $$ declare t text; begin foreach t in array array['clients','users','estimate_lines','invoice_lines','expenses','assets','proofs','proof_comments','forms','dashboards','report_defs'] loop execute format('create table %I(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id), data jsonb not null default ''{}'')',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['projects','tasks','dependencies','templates','time_entries','budgets','estimates','invoices','retainers','comments','approvals','audit_log','clients','users','estimate_lines','invoice_lines','expenses','assets','proofs','proof_comments','forms','dashboards','report_defs'] loop
execute format('alter table %I enable row level security',t);
execute format('create index on %I(workspace_id)',t);
if t in ('projects','tasks','comments','approvals') then execute format('create policy tenant_read on %I for select to authenticated using(public.workspace_role(workspace_id) is not null)',t);
else execute format('create policy staff_read on %I for select to authenticated using(public.workspace_role(workspace_id) in (''owner'',''member'',''contractor''))',t); end if;
if t not in ('audit_log','comments','time_entries','approvals') then
execute format('create policy staff_insert on %I for insert to authenticated with check(public.workspace_role(workspace_id) in (''owner'',''member''))',t);
execute format('create policy staff_update on %I for update to authenticated using(public.workspace_role(workspace_id) in (''owner'',''member'')) with check(public.workspace_role(workspace_id) in (''owner'',''member''))',t);
execute format('create policy staff_delete on %I for delete to authenticated using(public.workspace_role(workspace_id) in (''owner'',''member''))',t);
end if;
end loop; end $$;
create policy comment_insert on comments for insert to authenticated with check(public.workspace_role(workspace_id) is not null and created_by=auth.uid());
create policy time_insert on time_entries for insert to authenticated with check(public.workspace_role(workspace_id) in ('owner','member','contractor') and created_by=auth.uid() and status='Submitted');
create policy time_approve on time_entries for update to authenticated using(public.workspace_role(workspace_id) in ('owner','member')) with check(public.workspace_role(workspace_id) in ('owner','member'));
create policy approval_insert on approvals for insert to authenticated with check(public.workspace_role(workspace_id) in ('owner','member'));
-- Clients only change the decision, never the scope or label.
create function public.decide_approval(approval_id uuid,decision text) returns void language plpgsql security definer set search_path=public as $$ declare w uuid; begin select workspace_id into w from approvals where id=approval_id; if public.workspace_role(w) not in ('owner','member','client') or public.workspace_role(w) is null then raise exception 'Not authorized'; end if; if decision not in ('Approved','Changes requested') then raise exception 'Invalid decision'; end if; update approvals set status=decision where id=approval_id; insert into audit_log(workspace_id,action,entity) values(w,decision,approval_id::text); end $$;
revoke all on function public.decide_approval(uuid,text) from public;
grant execute on function public.decide_approval(uuid,text) to authenticated;
create function public.check_task_tree() returns trigger language plpgsql set search_path=public as $$ begin
if new.parent_task_id is not null and exists(with recursive ancestors as(select id,parent_task_id from tasks where id=new.parent_task_id and workspace_id=new.workspace_id union select t.id,t.parent_task_id from tasks t join ancestors a on t.id=a.parent_task_id where t.workspace_id=new.workspace_id) select 1 from ancestors where id=new.id) then raise exception 'A subtask cannot contain its parent'; end if; return new; end $$;
create trigger task_tree before insert or update on tasks for each row execute function check_task_tree();
create function public.check_dependency() returns trigger language plpgsql set search_path=public as $$ begin if exists(with recursive chain as(select depends_on_id from dependencies where task_id=new.depends_on_id and workspace_id=new.workspace_id union select d.depends_on_id from dependencies d join chain c on d.task_id=c.depends_on_id where d.workspace_id=new.workspace_id) select 1 from chain where depends_on_id=new.task_id) then raise exception 'Circular dependency'; end if; return new; end $$;
create trigger dependency_cycle before insert or update on dependencies for each row execute function check_dependency();
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
