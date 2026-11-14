create function public.valid_service_details(d jsonb) returns boolean language plpgsql immutable as $$begin
 if d is null or jsonb_typeof(d)<>'object' or coalesce(d->>'service_id','') not in ('ux-strategy','product-design','prototype','design-system','brand-campaign','other') or coalesce(jsonb_typeof(d->'answers'),'null')<>'array' then return false;end if;
 if jsonb_array_length(d->'answers')<>3 then return false;end if;
 return not exists(select 1 from jsonb_array_elements(d->'answers') a where jsonb_typeof(a)<>'string' or length(trim(a#>>'{}')) not between 1 and 3000) and coalesce(d->>'contact_email','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
end $$;
-- Request retries are idempotent. There is no per-client submission quota.
alter table work_requests add column submission_key uuid;
create unique index work_request_submission on work_requests(workspace_id,created_by,submission_key) where submission_key is not null;
create function public.submit_service_intake(link_token text,submission uuid,request_title text,request_brief text,client text,contact_email text,service_details jsonb,desired date) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare l intake_links; result uuid;begin
 select * into l from intake_links where token=link_token for update;
 if l.id is null or not l.enabled or l.expires_on<current_date or not exists(select 1 from workspace_members where workspace_id=l.workspace_id and user_id=l.created_by and role='owner') then raise exception 'Form unavailable';end if;
 if submission is null or length(trim(request_title)) not between 1 and 200 or length(trim(request_brief)) not between 1 and 12000 or length(trim(client)) not between 1 and 200 or length(contact_email)>254 or contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or not valid_service_details(service_details) or length(service_details::text)>24000 then raise exception 'Invalid request';end if;
 insert into work_requests(workspace_id,title,kind,brief,client_name,details,desired_date,created_by,submission_key) values(l.workspace_id,trim(request_title),'Other',trim(request_brief),client,service_details||jsonb_build_object('contact_email',contact_email,'source','Public intake: '||l.title),desired,l.created_by,submission) on conflict(workspace_id,created_by,submission_key) where submission_key is not null do nothing returning id into result;
 if result is null then select id into result from work_requests where workspace_id=l.workspace_id and created_by=l.created_by and submission_key=submission;end if;
 return result;
end $$;
revoke all on function submit_service_intake(text,uuid,text,text,text,text,jsonb,date) from public,anon,authenticated;grant execute on function submit_service_intake(text,uuid,text,text,text,text,jsonb,date) to service_role;
-- Retire the older endpoint so it cannot skip the new server bot verification flow.
revoke execute on function submit_public_intake(text,text,text,text,text,text) from service_role;
create function public.submit_member_service_request(w uuid,submission uuid,request_title text,request_brief text,client text,service_details jsonb,desired date,p uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;begin
 if not pms_session_ready() or workspace_role(w) is null or (p is not null and not project_visible(w,p)) then raise exception 'Access denied';end if;
 if submission is null or length(trim(request_title)) not between 1 and 200 or length(trim(request_brief)) not between 1 and 12000 or length(trim(client)) not between 1 and 200 or not valid_service_details(service_details) or length(service_details::text)>24000 then raise exception 'Invalid request';end if;
 insert into work_requests(workspace_id,project_id,title,kind,brief,client_name,details,desired_date,created_by,submission_key) values(w,p,trim(request_title),'Other',trim(request_brief),client,service_details,desired,auth.uid(),submission) on conflict(workspace_id,created_by,submission_key) where submission_key is not null do nothing returning id into result;
 if result is null then select id into result from work_requests where workspace_id=w and created_by=auth.uid() and submission_key=submission;end if;return result;
end $$;
revoke all on function submit_member_service_request(uuid,uuid,text,text,text,jsonb,date,uuid) from public,anon;grant execute on function submit_member_service_request(uuid,uuid,text,text,text,jsonb,date,uuid) to authenticated;
create table client_documents (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),project_id uuid,client_id uuid references auth.users(id),
 kind text not null check(kind in ('Estimate','Contract','Project agreement','Invoice','Creative brief','Change order')),
 title text not null check(length(trim(title)) between 1 and 200),version integer not null default 1 check(version>0),previous_id uuid references client_documents(id),
 status text not null default 'Draft' check(status in ('Draft','Shared','Approved','Discussion','Withdrawn')),
 content jsonb not null check(jsonb_typeof(content)='object'),total_cents bigint not null check(total_cents>=0 and total_cents<=100000000),deposit_cents bigint generated always as ((total_cents+1)/2) stored,
 signature_name text,decision_note text,decided_by uuid references auth.users(id),decided_at timestamptz,
 created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),shared_at timestamptz,
 foreign key(workspace_id,project_id) references projects(workspace_id,id)
);
create table client_payments (
 id uuid primary key default gen_random_uuid(),document_id uuid not null references client_documents(id),workspace_id uuid not null references workspaces(id),
 provider text not null check(provider in ('Square','Cash App','Venmo','Zelle')),provider_id text not null unique,amount_cents bigint not null check(amount_cents>0),refunded_cents bigint not null default 0 check(refunded_cents>=0 and refunded_cents<=amount_cents),
 confirmed_by uuid references auth.users(id),confirmed_at timestamptz not null default now()
);
create table client_checkout_links(document_id uuid primary key references client_documents(id),workspace_id uuid not null references workspaces(id),order_id text not null unique,url text not null,amount_cents bigint not null,created_at timestamptz not null default now());
create table studio_payment_settings(workspace_id uuid primary key references workspaces(id),cash_app text not null default '',venmo text not null default '',zelle text not null default '');
alter table client_documents enable row level security;alter table client_payments enable row level security;alter table client_checkout_links enable row level security;alter table studio_payment_settings enable row level security;
revoke all on client_documents,client_payments,client_checkout_links,studio_payment_settings from anon,authenticated;
grant select on client_documents,client_payments,client_checkout_links,studio_payment_settings to authenticated;
create policy document_read on client_documents for select to authenticated using(workspace_role(workspace_id)='owner' or (client_id=auth.uid() and status<>'Draft' and (project_id is null or project_visible(workspace_id,project_id))));
create policy payment_read on client_payments for select to authenticated using(exists(select 1 from client_documents d where d.id=document_id));
create policy checkout_read on client_checkout_links for select to authenticated using(exists(select 1 from client_documents d where d.id=document_id));
create policy payment_settings_read on studio_payment_settings for select to authenticated using(workspace_role(workspace_id) is not null);
create policy pms_session_security on client_documents as restrictive for all to authenticated using(pms_session_ready()) with check(pms_session_ready());
create policy pms_session_security on client_payments as restrictive for all to authenticated using(pms_session_ready()) with check(pms_session_ready());
create policy pms_session_security on client_checkout_links as restrictive for all to authenticated using(pms_session_ready()) with check(pms_session_ready());
create policy pms_session_security on studio_payment_settings as restrictive for all to authenticated using(pms_session_ready()) with check(pms_session_ready());
-- Writes use the server; clients cannot edit approved snapshots, amounts or receipts.
create function public.decide_client_document(doc uuid,decision text,signer text,note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d client_documents;begin
 select * into d from client_documents where id=doc for update;
 if not pms_session_ready() or d.client_id is distinct from auth.uid() or workspace_role(d.workspace_id) is null or (d.project_id is not null and not project_visible(d.workspace_id,d.project_id)) then raise exception 'Only the assigned client can respond';end if;
 if d.status<>'Shared' then raise exception 'This version is no longer awaiting review';end if;
 if decision not in ('Approved','Discussion') or decision is null or length(note)>4000 or (decision='Approved' and length(trim(coalesce(signer,''))) not between 2 and 200) or (decision='Discussion' and length(trim(coalesce(note,'')))<1) then raise exception 'Complete the response fields';end if;
 update client_documents set status=decision,signature_name=case when decision='Approved' then trim(signer) end,decision_note=note,decided_by=auth.uid(),decided_at=now() where id=doc;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(d.workspace_id,d.created_by,d.project_id,decision||': '||d.title,'document:'||doc||':'||decision) on conflict do nothing;
 insert into audit_log(workspace_id,action,entity) values(d.workspace_id,'client_document:'||decision,doc::text);
end $$;
revoke all on function decide_client_document(uuid,text,text,text) from public,anon;grant execute on function decide_client_document(uuid,text,text,text) to authenticated;
-- Existing projects retain their current state. Every new project starts awaiting a deposit.
alter table projects add column deposit_required boolean not null default false;
alter table projects alter column deposit_required set default true;
create function public.guard_project_deposit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then new.deposit_required:=true;new.status:='Awaiting deposit';return new;end if;
 if old.deposit_required and not new.deposit_required then raise exception 'The upfront deposit requirement cannot be removed';end if;
 if new.deposit_required and new.status is distinct from old.status and new.status in ('In progress','Active','Completed','Complete','Done') then
 if not exists(select 1 from client_documents d where d.project_id=new.id and d.workspace_id=new.workspace_id and d.status='Approved' and d.kind in ('Contract','Project agreement','Estimate') and d.deposit_cents>0 and coalesce((select sum(p.amount_cents-p.refunded_cents) from client_payments p where p.document_id=d.id),0)>=d.deposit_cents) then raise exception 'Approve the agreement and confirm the 50%% deposit before starting work';end if;
 end if;return new;
end $$;
create trigger project_deposit_gate before insert or update on projects for each row execute function guard_project_deposit();
