-- Additive task/time/billing connections. Existing financial records remain unchanged.
alter table time_entries add column task_id uuid references tasks(id) on delete set null;
alter table project_expenses add column reimbursable boolean not null default false;
alter table time_entries add column billing_treatment text not null default 'review' check(billing_treatment in ('review','invoice','covered'));
create table invoice_sources (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
 invoice_id uuid not null references invoices(id) on delete cascade,
 time_entry_id uuid references time_entries(id), expense_id uuid references project_expenses(id),
 snapshot jsonb not null, released boolean not null default false,
 check(num_nonnulls(time_entry_id,expense_id)=1)
);
create unique index invoice_time_once on invoice_sources(time_entry_id) where not released;
create unique index invoice_expense_once on invoice_sources(expense_id) where not released;
alter table invoice_sources enable row level security;
grant select on invoice_sources to authenticated;
create policy invoice_sources_admin on invoice_sources for select to authenticated using(workspace_role(workspace_id)='owner');
create table workflow_requests (
 workspace_id uuid not null references workspaces(id), request_id uuid not null, actor uuid not null,
 kind text not null, result_id uuid not null, payload jsonb not null, primary key(workspace_id,request_id)
);
alter table workflow_requests enable row level security;

create function public.guard_connected_time() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from invoice_sources where time_entry_id=old.id) then raise exception 'Billed time must be preserved';end if;return old;
 end if;
 if new.task_id is not null and not exists(select 1 from tasks where id=new.task_id and workspace_id=new.workspace_id and project_id=new.project_id) then raise exception 'Choose a task in the same project';end if;
 if tg_op='UPDATE' then
  if exists(select 1 from invoice_sources where time_entry_id=old.id and not released) and
   (new.description,new.minutes,new.project_id,new.entry_date,new.billable,new.cost_rate,new.bill_rate,new.status,new.billing_treatment) is distinct from
   (old.description,old.minutes,old.project_id,old.entry_date,old.billable,old.cost_rate,old.bill_rate,old.status,old.billing_treatment) then raise exception 'Cancel the source invoice before correcting billed time';end if;
  if new.task_id is distinct from old.task_id and (old.task_id is null or exists(select 1 from tasks where id=old.task_id)) then
   if exists(select 1 from invoice_sources where time_entry_id=old.id and not released) then raise exception 'Cancel the source invoice before relinking billed time';end if;
   new.status:='Submitted';
  end if;
 end if;
 return new;
end $$;
create trigger zz_connected_time before insert or update or delete on time_entries for each row execute function guard_connected_time();
create function public.guard_billed_expense() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from invoice_sources where expense_id=old.id and (not released or tg_op='DELETE')) then raise exception 'Preserve billed expenses; cancel the invoice before making corrections';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger billed_expense before update or delete on project_expenses for each row execute function guard_billed_expense();
create function public.guard_source_invoice() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from invoice_sources where invoice_id=old.id) then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='DELETE' then
  if old.status<>'Draft' then raise exception 'Preserve issued invoices; cancel instead';end if;return old;
 end if;
 if (new.workspace_id,new.project_id,new.lines) is distinct from (old.workspace_id,old.project_id,old.lines) then raise exception 'Source invoice lines are snapshots. Cancel and create a replacement draft';end if;
 if old.status in ('Cancelled','Void') and new.status not in ('Cancelled','Void') then raise exception 'Create a new invoice instead of reopening a cancelled source invoice';end if;
 if new.status in ('Cancelled','Void') and old.status not in ('Cancelled','Void') then
  if old.status='Paid' or exists(select 1 from invoice_receipts where invoice_id=old.id) then raise exception 'An invoice with receipts cannot release billed work';end if;
  update invoice_sources set released=true where invoice_id=old.id;
 end if;
 return new;
end $$;
create trigger source_invoice before update or delete on invoices for each row execute function guard_source_invoice();

create function public.create_work_invoice(p_project uuid,p_time_ids uuid[],p_expense_ids uuid[],p_due date,p_request uuid,p_acknowledge boolean default false) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects; e time_entries; x project_expenses; result uuid; lines jsonb:='[]'; payload jsonb; previous workflow_requests; begin
 select * into p from projects where id=p_project for update;
 if not found or workspace_role(p.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore the project first';end if;
 payload:=jsonb_build_object('project',p_project,'time',p_time_ids,'expenses',p_expense_ids,'due',p_due,'ack',p_acknowledge);
 select * into previous from workflow_requests where workspace_id=p.workspace_id and request_id=p_request;
 if found then if previous.actor<>auth.uid() or previous.kind<>'invoice' or previous.payload<>payload then raise exception 'Request key already used';end if;return previous.result_id;end if;
 if p_request is null or p_due is null or p_acknowledge is distinct from true then raise exception 'Confirm retainer, deposit and prior billing coverage before drafting';end if;
 if coalesce(cardinality(p_time_ids),0)+coalesce(cardinality(p_expense_ids),0) not between 1 and 500 then raise exception 'Select 1 to 500 billable records';end if;
 if cardinality(p_time_ids)<>(select count(distinct v) from unnest(p_time_ids) v) or cardinality(p_expense_ids)<>(select count(distinct v) from unnest(p_expense_ids) v) then raise exception 'Duplicate sources';end if;
 perform 1 from time_entries where id=any(p_time_ids) order by id for update;
 perform 1 from project_expenses where id=any(p_expense_ids) order by id for update;
 if (select count(*) from time_entries where id=any(p_time_ids) and project_id=p.id and workspace_id=p.workspace_id and status='Approved' and billable and billing_treatment='invoice' and bill_rate>0)<>coalesce(cardinality(p_time_ids),0) then raise exception 'Use approved billable time explicitly marked Invoice separately';end if;
 if (select count(*) from project_expenses where id=any(p_expense_ids) and project_id=p.id and workspace_id=p.workspace_id and reimbursable)<>coalesce(cardinality(p_expense_ids),0) then raise exception 'Select reimbursable expenses from this project';end if;
 if exists(select 1 from invoice_sources where not released and (time_entry_id=any(p_time_ids) or expense_id=any(p_expense_ids))) then raise exception 'Some selected work has already been invoiced';end if;
 for e in select * from time_entries where id=any(p_time_ids) order by entry_date,id loop
  lines:=lines||jsonb_build_array(jsonb_build_object('description',e.description||' ('||e.entry_date||')','quantity',e.minutes::numeric/60,'rate',e.bill_rate));
 end loop;
 for x in select * from project_expenses where id=any(p_expense_ids) order by expense_date,id loop
  lines:=lines||jsonb_build_array(jsonb_build_object('description',x.description||' ('||x.expense_date||')','quantity',1,'rate',x.amount));
 end loop;
 insert into invoices(workspace_id,project_id,number,client_name,status,due_date,notes,lines) values(p.workspace_id,p.id,'INV-'||p_request::text,p.client_name,'Draft',p_due,'Prepared from approved work. Coverage reviewed by the administrator.',lines) returning id into result;
 insert into invoice_sources(workspace_id,invoice_id,time_entry_id,snapshot) select p.workspace_id,result,id,to_jsonb(t) from time_entries t where id=any(p_time_ids);
 insert into invoice_sources(workspace_id,invoice_id,expense_id,snapshot) select p.workspace_id,result,exp.id,to_jsonb(exp) from project_expenses exp where exp.id=any(p_expense_ids);
 insert into workflow_requests values(p.workspace_id,p_request,auth.uid(),'invoice',result,payload);
 insert into audit_log(workspace_id,action,entity) values(p.workspace_id,'Create invoice from approved work',result::text);
 return result;
end $$;
revoke all on function create_work_invoice(uuid,uuid[],uuid[],date,uuid,boolean) from public;
grant execute on function create_work_invoice(uuid,uuid[],uuid[],date,uuid,boolean) to authenticated;

-- Stable identities use exact existing names. No fuzzy merging of historical clients.
create table client_accounts(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null check(length(trim(name)) between 1 and 200),unique(workspace_id,id),unique(workspace_id,name));
alter table projects add column client_account_id uuid;
alter table projects add foreign key(workspace_id,client_account_id) references client_accounts(workspace_id,id);
insert into client_accounts(workspace_id,name) select distinct workspace_id,client_name from projects where length(trim(client_name)) between 1 and 200;
update projects p set client_account_id=c.id from client_accounts c where c.workspace_id=p.workspace_id and c.name=p.client_name;
alter table client_accounts enable row level security;
grant select,insert,update on client_accounts to authenticated;
create policy clients_admin on client_accounts for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create function public.bind_client_account() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or new.client_account_id is distinct from old.client_account_id then
  if new.client_account_id is not null then
   select name into new.client_name from client_accounts where id=new.client_account_id and workspace_id=new.workspace_id;
   if not found then raise exception 'Choose a client in this workspace';end if;
   return new;
  end if;
 end if;
 if tg_op='INSERT' or new.client_name is distinct from old.client_name then
  if length(trim(new.client_name))=0 then new.client_account_id:=null;
  else
   insert into client_accounts(workspace_id,name) values(new.workspace_id,new.client_name) on conflict(workspace_id,name) do nothing;
   select id into new.client_account_id from client_accounts where workspace_id=new.workspace_id and name=new.client_name;
  end if;
 end if;
 return new;
end $$;
create trigger project_client before insert or update on projects for each row execute function bind_client_account();
create table project_groups(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null check(length(trim(name)) between 1 and 100),project_ids uuid[] not null default '{}',created_by uuid not null default auth.uid());
alter table project_groups enable row level security;
grant select,insert,update,delete on project_groups to authenticated;
create policy groups_admin on project_groups for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner' and created_by=auth.uid());
create function public.guard_group_projects() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if cardinality(new.project_ids)>500 or exists(select 1 from unnest(new.project_ids) v where not exists(select 1 from projects where id=v and workspace_id=new.workspace_id)) then raise exception 'Choose projects in this workspace';end if;return new;
end $$;
create trigger group_projects before insert or update on project_groups for each row execute function guard_group_projects();
