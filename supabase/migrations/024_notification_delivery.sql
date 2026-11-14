create or replace function public.record_invoice_receipt(invoice uuid,amount numeric,received_on date,reference text default '') returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare i invoices; invoiced numeric; paid numeric; result uuid;begin
 select * into i from invoices where id=invoice for update;
 if not found or workspace_role(i.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if i.status not in ('Sent','Overdue','Paid') then raise exception 'Issue the invoice before recording payment';end if;
 select coalesce(sum((x->>'quantity')::numeric*(x->>'rate')::numeric),0) into invoiced from jsonb_array_elements(i.lines)x;
 select coalesce(sum(r.amount),0) into paid from invoice_receipts r where r.invoice_id=i.id;
 if i.status='Paid' and paid=0 then raise exception 'Invoice already marked paid; no extra receipt is needed';end if;
 if amount is null or amount<=0 or paid+amount>invoiced then raise exception 'Receipt exceeds the unpaid invoice amount';end if;
 insert into invoice_receipts(workspace_id,invoice_id,amount,received_on,reference) values(i.workspace_id,i.id,record_invoice_receipt.amount,record_invoice_receipt.received_on,record_invoice_receipt.reference) returning id into result;
 if paid+amount=invoiced then update invoices set status='Paid' where id=i.id;end if;
 return result;end $$;

create or replace function public.submit_public_intake(link_token text,fingerprint text,title text,brief text,client_name text,email text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare link intake_links;n integer;result uuid;begin
 select * into link from intake_links where token=link_token for update;
 if not found or not link.enabled or link.expires_on<current_date then raise exception 'This intake form is unavailable';end if;
 if not exists(select 1 from workspace_members where workspace_id=link.workspace_id and user_id=link.created_by and role='owner') then raise exception 'This intake form is unavailable';end if;
 if title is null or brief is null or client_name is null or email is null or fingerprint is null or length(trim(title)) not between 1 and 200 or length(trim(brief)) not between 1 and 12000 or length(client_name)>200 or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(fingerprint)<>64 then raise exception 'Check the form fields';end if;
 insert into intake_rate_limits values(link.id,fingerprint,date_trunc('hour',now()),1) on conflict(link_id,fingerprint,window_start) do update set count=intake_rate_limits.count+1 returning count into n;
 if n>5 then raise exception 'Too many submissions. Try again later';end if;
 select sum(count) into n from intake_rate_limits where link_id=link.id and window_start=date_trunc('hour',now());
 if n>30 then raise exception 'This form has reached its hourly limit. Try again later';end if;
 insert into work_requests(workspace_id,title,kind,brief,client_name,details,created_by) values(link.workspace_id,trim(title),'Other',trim(brief),client_name,jsonb_build_object('contact_email',email,'source','Public intake: '||link.title),link.created_by) returning id into result;
 delete from intake_rate_limits where window_start<now()-interval '2 days';return result;
end $$;

create table google_email_connections (
 workspace_id uuid primary key references workspaces(id),sender text not null,
 encrypted_refresh_token text not null,connected_by uuid not null references auth.users(id),connected_at timestamptz not null default now()
);
alter table google_email_connections enable row level security;
grant select(workspace_id,sender,connected_at) on google_email_connections to authenticated;
create policy email_connection_read on google_email_connections for select to authenticated using(workspace_role(workspace_id)='owner');
-- Ambiguous deliveries are not automatically retried: a crashed worker may have sent the email.
create or replace function public.claim_studio_email_jobs(only_workspace uuid default null) returns setof studio_email_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update studio_email_jobs set status='Failed',last_error='Delivery interrupted; check the sender mailbox before retrying.' where status='Sending' and available_at<=now() and (only_workspace is null or workspace_id=only_workspace);
 return query update studio_email_jobs set status='Sending',attempts=attempts+1,available_at=now()+interval '10 minutes',lease_id=gen_random_uuid()
 where id in (select id from studio_email_jobs where (only_workspace is null or workspace_id=only_workspace) and status='Queued' and available_at<=now() and attempts<5 order by created_at for update skip locked limit 5) returning *;
end $$;
