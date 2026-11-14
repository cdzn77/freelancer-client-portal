create table task_field_definitions (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80), kind text not null check(kind in ('text','number','date','select','boolean')),
 options text[] not null default '{}', required boolean not null default false, archived boolean not null default false,
 check(kind<>'select' or cardinality(options) between 1 and 50), unique(workspace_id,name)
);
alter table task_field_definitions enable row level security;
grant select,insert,update on task_field_definitions to authenticated;
create policy field_read on task_field_definitions for select to authenticated using(workspace_role(workspace_id) in ('owner','member','contractor'));
create policy field_manage on task_field_definitions for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create function public.guard_task_field_kind() returns trigger language plpgsql as $$begin
 if new.kind<>old.kind or new.workspace_id<>old.workspace_id then raise exception 'Create a new field to change its type';end if;return new;end $$;
create trigger field_kind_fixed before update on task_field_definitions for each row execute function guard_task_field_kind();
create function public.validate_task_fields() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare d task_field_definitions; v text;begin
 if tg_op='UPDATE' and new.custom_fields is not distinct from old.custom_fields then return new;end if;
 if jsonb_typeof(new.custom_fields)<>'object' then raise exception 'Invalid custom fields';end if;
 for d in select * from task_field_definitions where workspace_id=new.workspace_id and not archived loop
 v:=nullif(trim(new.custom_fields->>('field:'||d.id)), '');
 if v is null then if d.required then raise exception 'Required field: %',d.name;end if;continue;end if;
 if length(v)>2000 then raise exception 'Field too long: %',d.name;end if;
 if d.kind='number' then perform v::numeric;
 elsif d.kind='date' then if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date: %',d.name;end if;perform v::date;
 elsif d.kind='boolean' and v not in ('true','false') then raise exception 'Invalid yes/no value: %',d.name;
 elsif d.kind='select' and not(v=any(d.options)) then raise exception 'Choose an option for %',d.name;end if;
 end loop;return new;end $$;
create trigger task_fields_checked before insert or update of custom_fields on tasks for each row execute function validate_task_fields();
alter table tasks add column remaining_minutes integer check(remaining_minutes between 0 and 60000);
create table resource_bookings (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, user_id uuid not null,
 starts_on date not null, ends_on date not null, daily_minutes integer not null check(daily_minutes between 1 and 1440),
 tentative boolean not null default false, note text not null default '' check(length(note)<=2000),
 check(ends_on>=starts_on and ends_on-starts_on<=366),
 foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade,
 foreign key(workspace_id,user_id) references workspace_members(workspace_id,user_id) on delete cascade
);
alter table resource_bookings enable row level security;
grant select,insert,update,delete on resource_bookings to authenticated;
create policy bookings_admin on resource_bookings for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner' and exists(select 1 from workspace_members m where m.workspace_id=resource_bookings.workspace_id and m.user_id=resource_bookings.user_id and m.role<>'client'));

create table scope_changes (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200), description text not null check(length(description) between 1 and 12000),
 amount numeric(12,2) not null check(amount>=0), added_days integer not null default 0 check(added_days between 0 and 3650),
 status text not null default 'Draft' check(status in ('Draft','Submitted','Approved','Declined')),
 reviewer_id uuid references auth.users(id), created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), decided_at timestamptz,
 estimate_id uuid references estimates(id), foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade
);
alter table scope_changes enable row level security;
grant select on scope_changes to authenticated;
create policy scope_read on scope_changes for select to authenticated using(project_manager(workspace_id,project_id) or (status<>'Draft' and reviewer_id=auth.uid() and project_guest(workspace_id,project_id,'approvals')));
create function public.save_scope_change(project uuid,title text,description text,amount numeric,added_days integer,reviewer uuid,change_id uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare p projects; result uuid;begin
 select * into p from projects where id=project for update;
 if not found or not project_manager(p.workspace_id,p.id) then raise exception 'Project owner access required';end if;
 if p.archived_at is not null or p.deleted_at is not null then raise exception 'Restore project first';end if;
 if reviewer is not null and not exists(select 1 from workspace_members m where m.workspace_id=p.workspace_id and m.user_id=reviewer and (m.role='owner' or (m.role='client' and 'approvals'=any(p.client_tools) and exists(select 1 from project_members pm where pm.project_id=p.id and pm.user_id=reviewer and pm.role='guest')))) then raise exception 'Choose an administrator or an invited client with Approvals access';end if;
 if change_id is null then insert into scope_changes(workspace_id,project_id,title,description,amount,added_days,reviewer_id) values(p.workspace_id,p.id,save_scope_change.title,save_scope_change.description,save_scope_change.amount,save_scope_change.added_days,reviewer) returning id into result;
 else update scope_changes s set title=save_scope_change.title,description=save_scope_change.description,amount=save_scope_change.amount,added_days=save_scope_change.added_days,reviewer_id=reviewer where s.id=change_id and s.project_id=p.id and s.status='Draft' returning id into result;
 if not found then raise exception 'Only drafts can be edited';end if;end if;return result;end $$;
create function public.act_on_scope_change(change_id uuid,action text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare s scope_changes; result uuid;begin
 select * into s from scope_changes where id=change_id for update;
 if not found then raise exception 'Change not found';end if;
 if exists(select 1 from projects where id=s.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Restore project first';end if;
 if action in ('approve','decline') then
 if s.status<>'Submitted' or s.reviewer_id is distinct from auth.uid() or not (workspace_role(s.workspace_id)='owner' or project_guest(s.workspace_id,s.project_id,'approvals')) then raise exception 'Only the selected reviewer can decide a submitted change';end if;
 update scope_changes set status=case action when 'approve' then 'Approved' else 'Declined' end,decided_at=now() where id=s.id;
 elsif not project_manager(s.workspace_id,s.project_id) then raise exception 'Project owner access required';
 elsif action='submit' then
 if s.status<>'Draft' or s.reviewer_id is null then raise exception 'Choose a reviewer for this draft';end if;
 update scope_changes set status='Submitted' where id=s.id;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(s.workspace_id,s.reviewer_id,s.project_id,'Scope change to review: '||s.title,'scope:'||s.id) on conflict do nothing;
 elsif action='delete' then if s.status<>'Draft' then raise exception 'Only drafts can be deleted';end if;delete from scope_changes where id=s.id;
 elsif action='estimate' then
 if workspace_role(s.workspace_id)<>'owner' or s.status<>'Approved' then raise exception 'Administrator access and an approved change are required';end if;
 if s.estimate_id is not null then return s.estimate_id;end if;
 insert into estimates(workspace_id,project_id,number,client_name,status,notes,lines) select s.workspace_id,s.project_id,'SC-'||left(s.id::text,8),p.client_name,'Draft',s.description||E'\nProposed extra days: '||s.added_days,jsonb_build_array(jsonb_build_object('description',s.title,'quantity',1,'rate',s.amount)) from projects p where p.id=s.project_id returning id into result;
 update scope_changes set estimate_id=result where id=s.id;
 else raise exception 'Invalid action';end if;return result;end $$;
revoke all on function public.save_scope_change(uuid,text,text,numeric,integer,uuid,uuid),public.act_on_scope_change(uuid,text) from public;
grant execute on function public.save_scope_change(uuid,text,text,numeric,integer,uuid,uuid),public.act_on_scope_change(uuid,text) to authenticated;

create table project_expenses (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 description text not null check(length(trim(description)) between 1 and 500),amount numeric(12,2) not null check(amount>0),expense_date date not null,
 foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade
);
create table invoice_receipts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,invoice_id uuid not null references invoices(id),
 amount numeric(12,2) not null check(amount>0),received_on date not null,reference text not null default '' check(length(reference)<=200),
 created_at timestamptz not null default now()
);
alter table project_expenses enable row level security;alter table invoice_receipts enable row level security;
grant select,insert,update,delete on project_expenses to authenticated;grant select on invoice_receipts to authenticated;
create policy expenses_admin on project_expenses for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create policy receipts_admin on invoice_receipts for select to authenticated using(workspace_role(workspace_id)='owner');
create function public.record_invoice_receipt(invoice uuid,amount numeric,received_on date,reference text default '') returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare i invoices; invoiced numeric; paid numeric; result uuid;begin
 select * into i from invoices where id=invoice for update;
 if not found or workspace_role(i.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 select coalesce(sum((x->>'quantity')::numeric*(x->>'rate')::numeric),0) into invoiced from jsonb_array_elements(i.lines)x;
 select coalesce(sum(r.amount),0) into paid from invoice_receipts r where r.invoice_id=i.id;
 if i.status='Paid' and paid=0 then raise exception 'Invoice already marked paid; no extra receipt is needed';end if;
 if amount is null or amount<=0 or paid+amount>invoiced then raise exception 'Receipt exceeds the unpaid invoice amount';end if;
 insert into invoice_receipts(workspace_id,invoice_id,amount,received_on,reference) values(i.workspace_id,i.id,record_invoice_receipt.amount,record_invoice_receipt.received_on,record_invoice_receipt.reference) returning id into result;
 if paid+amount=invoiced then update invoices set status='Paid' where id=i.id;end if;
 return result;end $$;
revoke all on function public.record_invoice_receipt(uuid,numeric,date,text) from public;
grant execute on function public.record_invoice_receipt(uuid,numeric,date,text) to authenticated;
