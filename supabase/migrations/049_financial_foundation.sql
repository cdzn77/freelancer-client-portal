-- Reconcile identities without rewriting signed documents, invoices or receipts.
create table billing_profiles (
 client_account_id uuid primary key references client_accounts(id) on delete cascade,
 workspace_id uuid not null references workspaces(id) on delete cascade, revision integer not null default 1,
 billing_name text not null check(length(trim(billing_name)) between 1 and 200),
 email text not null default '' check(length(email)<=254), address text not null default '' check(length(address)<=2000),
 contacts jsonb not null default '[]' check(jsonb_typeof(contacts)='array' and jsonb_array_length(contacts)<=20 and octet_length(contacts::text)<=12000),
 default_rate_cents bigint not null default 0 check(default_rate_cents between 0 and 100000000),
 tax_rate numeric not null default 0 check(tax_rate between 0 and 20), tax_note text not null default '' check(length(tax_note)<=2000),
 updated_at timestamptz not null default now(),updated_by uuid not null references auth.users(id)
);
create table billing_groups(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,project_id uuid references projects(id) on delete cascade,created_at timestamptz not null default now());
create table billing_sources(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
 group_id uuid not null references billing_groups(id) on delete cascade,origin_group_id uuid not null references billing_groups(id) on delete cascade,
 document_id uuid unique references client_documents(id) on delete cascade,invoice_id uuid unique references invoices(id) on delete cascade,estimate_id uuid unique references estimates(id) on delete cascade,
 is_primary boolean not null default true,check(num_nonnulls(document_id,invoice_id,estimate_id)=1)
);
create unique index billing_primary on billing_sources(group_id) where is_primary;
create table billing_payment_matches(receipt_id uuid primary key references invoice_receipts(id) on delete cascade,payment_id uuid unique not null references client_payments(id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade,note text not null check(length(trim(note)) between 3 and 2000),created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table client_documents add column due_date date;
alter table invoices add column billing_profile_snapshot jsonb not null default '{}';
alter table estimates add column billing_profile_snapshot jsonb not null default '{}';
do $$declare t text;begin foreach t in array array['billing_profiles','billing_groups','billing_sources','billing_payment_matches'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
 execute format('create policy billing_owner on %I for select to authenticated using(pms_session_ready() and workspace_role(workspace_id)=''owner'')',t);
end loop;end$$;
create function billing_capture_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare g uuid;begin
 insert into billing_groups(workspace_id,project_id) values(new.workspace_id,new.project_id) returning id into g;
 insert into billing_sources(workspace_id,group_id,origin_group_id,document_id,invoice_id,estimate_id) values(new.workspace_id,g,g,case when tg_table_name='client_documents' then new.id end,case when tg_table_name='invoices' then new.id end,case when tg_table_name='estimates' then new.id end);
 return new;end$$;
create trigger billing_capture after insert on client_documents for each row execute function billing_capture_source();
create trigger billing_capture after insert on invoices for each row execute function billing_capture_source();
create trigger billing_capture after insert on estimates for each row execute function billing_capture_source();
do $$declare r record;g uuid;begin
 for r in select id,workspace_id,project_id,'document' kind from client_documents union all select id,workspace_id,project_id,'invoice' from invoices union all select id,workspace_id,project_id,'estimate' from estimates loop
 insert into billing_groups(workspace_id,project_id) values(r.workspace_id,r.project_id) returning id into g;
 insert into billing_sources(workspace_id,group_id,origin_group_id,document_id,invoice_id,estimate_id) values(r.workspace_id,g,g,case when r.kind='document' then r.id end,case when r.kind='invoice' then r.id end,case when r.kind='estimate' then r.id end);
 end loop;end$$;
create function billing_source_rows(g uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'source_id',coalesce(d.id,i.id,e.id),'kind',case when d.id is not null then 'document' when i.id is not null then 'invoice' else 'estimate' end,'title',coalesce(d.title,i.number,e.number),'type',coalesce(d.kind,case when i.id is not null then 'Invoice' else 'Estimate' end),'status',coalesce(d.status,i.status,e.status),'primary',s.is_primary,'total_cents',coalesce(d.total_cents,(select coalesce(round(sum((l->>'quantity')::numeric*(l->>'rate')::numeric)*100),0)::bigint from jsonb_array_elements(coalesce(i.lines,e.lines,'[]'))l)),'due_date',coalesce(d.due_date,i.due_date,e.due_date),'client_id',d.client_id) order by s.is_primary desc,s.id),'[]') from billing_sources s left join client_documents d on d.id=s.document_id left join invoices i on i.id=s.invoice_id left join estimates e on e.id=s.estimate_id where s.group_id=g
$$;
create function billing_payment_rows(g uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(x order by x->>'date'),'[]') from (
 select jsonb_build_object('id',p.id,'kind','payment','source_id',p.document_id,'gross_cents',p.amount_cents,'refunded_cents',p.refunded_cents,'net_cents',p.amount_cents-p.refunded_cents,'date',p.confirmed_at::date,'reference',p.provider||': '||p.provider_id,'matched',false) x from client_payments p join billing_sources s on s.document_id=p.document_id where s.group_id=g
 union all select jsonb_build_object('id',r.id,'kind','receipt','source_id',r.invoice_id,'gross_cents',round(r.amount*100)::bigint,'refunded_cents',0,'net_cents',case when m.receipt_id is null then round(r.amount*100)::bigint else 0 end,'date',r.received_on,'reference',r.reference,'matched',m.receipt_id is not null,'matched_payment',m.payment_id) from invoice_receipts r join billing_sources s on s.invoice_id=r.invoice_id left join billing_payment_matches m on m.receipt_id=r.id where s.group_id=g
 ) q
$$;
create function billing_group_totals(g uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare sources jsonb:=billing_source_rows(g);payments jsonb:=billing_payment_rows(g);amount bigint;paid bigint;unverified boolean;begin
 select (s->>'total_cents')::bigint into amount from jsonb_array_elements(sources)s where (s->>'primary')::boolean;
 select coalesce(sum((p->>'net_cents')::bigint),0) into paid from jsonb_array_elements(payments)p;
 select exists(select 1 from billing_sources s join invoices i on i.id=s.invoice_id where s.group_id=g and i.status='Paid' and not exists(select 1 from invoice_receipts where invoice_id=i.id)) into unverified;
 return jsonb_build_object('total_cents',coalesce(amount,0),'paid_cents',paid,'balance_cents',coalesce(amount,0)-paid,'unverified_paid',unverified,'sources',sources,'payments',payments);
end$$;
create function billing_workspace(w uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if not pms_session_ready() or workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 return jsonb_build_object('groups',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'project_id',g.project_id)||billing_group_totals(g.id) order by g.created_at desc),'[]') from billing_groups g where g.workspace_id=w and exists(select 1 from billing_sources s where s.group_id=g.id)), 'profiles',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from billing_profiles b where b.workspace_id=w));
end$$;
create function document_billing_balance(doc uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare d client_documents;g uuid;t jsonb;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or not(coalesce(workspace_role(d.workspace_id)='owner',false) or(d.client_id=auth.uid() and d.status<>'Draft' and (d.project_id is null or project_visible(d.workspace_id,d.project_id)))) then raise exception 'Document unavailable';end if;
 select group_id into g from billing_sources where document_id=doc;t:=billing_group_totals(g);
 return jsonb_build_object('total_cents',t->'total_cents','paid_cents',t->'paid_cents','balance_cents',t->'balance_cents','unverified_paid',t->'unverified_paid','current_basis',d.total_cents=(t->>'total_cents')::bigint,'linked_sources',(select count(*) from billing_sources where group_id=g));
end$$;
create function save_billing_profile(account uuid,expected_revision integer,profile jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare c client_accounts;b billing_profiles;x jsonb;begin
 select * into c from client_accounts where id=account for update;
 if not pms_session_ready() or c.id is null or workspace_role(c.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 select * into b from billing_profiles where client_account_id=c.id;
 if coalesce(b.revision,0)<>expected_revision then raise exception 'Billing profile changed. Reload before saving';end if;
 if jsonb_typeof(profile)<>'object' or coalesce(profile->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid billing email';end if;
 for x in select value from jsonb_array_elements(coalesce(profile->'contacts','[]')) loop
 if coalesce(x->>'role','') not in('Billing','Approver','Primary') or length(trim(coalesce(x->>'name',''))) not between 1 and 200 or coalesce(x->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Each contact needs a name, email and role';end if;
 end loop;
 insert into billing_profiles(client_account_id,workspace_id,billing_name,email,address,contacts,default_rate_cents,tax_rate,tax_note,updated_by) values(c.id,c.workspace_id,profile->>'billing_name',profile->>'email',coalesce(profile->>'address',''),coalesce(profile->'contacts','[]'),coalesce((profile->>'default_rate_cents')::bigint,0),coalesce((profile->>'tax_rate')::numeric,0),coalesce(profile->>'tax_note',''),auth.uid())
 on conflict(client_account_id) do update set billing_name=excluded.billing_name,email=excluded.email,address=excluded.address,contacts=excluded.contacts,default_rate_cents=excluded.default_rate_cents,tax_rate=excluded.tax_rate,tax_note=excluded.tax_note,revision=b.revision+1,updated_at=now(),updated_by=auth.uid();
 insert into audit_log(workspace_id,action,entity) values(c.workspace_id,'billing_profile_updated',c.id::text);
end$$;
create function billing_profile_on_legacy() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 select coalesce(to_jsonb(b)-array['workspace_id','updated_by'],'{}') into new.billing_profile_snapshot from projects p left join billing_profiles b on b.client_account_id=p.client_account_id where p.id=new.project_id and p.workspace_id=new.workspace_id;
 new.billing_profile_snapshot:=coalesce(new.billing_profile_snapshot,'{}');return new;
end$$;
create trigger billing_profile_snapshot before insert on invoices for each row execute function billing_profile_on_legacy();
create trigger billing_profile_snapshot before insert on estimates for each row execute function billing_profile_on_legacy();
create function reconcile_billing_groups(primary_group uuid,other_group uuid,note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare a billing_groups;b billing_groups;ta jsonb;tb jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||(select workspace_id from billing_groups where id=primary_group),0));
 if primary_group=other_group then raise exception 'Choose two different records';end if;
 perform 1 from billing_groups where id in(primary_group,other_group) order by id for update;
 select * into a from billing_groups where id=primary_group;select * into b from billing_groups where id=other_group;
 if not pms_session_ready() or a.id is null or b.id is null or a.workspace_id<>b.workspace_id or workspace_role(a.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if a.project_id is null or a.project_id is distinct from b.project_id or length(trim(coalesce(note,''))) not between 3 and 2000 then raise exception 'Choose records from the same project and explain the match';end if;
 ta:=billing_group_totals(a.id);tb:=billing_group_totals(b.id);
 if jsonb_array_length(ta->'sources')=0 or jsonb_array_length(tb->'sources')=0 or ta->'total_cents'<>tb->'total_cents' then raise exception 'Amounts must match exactly. Do not merge a deposit-only invoice with the full agreement';end if;
 if (select count(distinct d.client_id) from billing_sources s join client_documents d on d.id=s.document_id where s.group_id in(a.id,b.id))>1 then raise exception 'Portal recipients differ';end if;
 if (select count(*) from client_checkout_links l join billing_sources s on s.document_id=l.document_id where s.group_id in(a.id,b.id))>1 then raise exception 'Multiple provider checkout links exist. Resolve them before linking these records';end if;
 update billing_sources set is_primary=false,group_id=a.id where group_id=b.id;
 insert into audit_log(workspace_id,action,entity) values(a.workspace_id,'billing_records_linked',jsonb_build_object('primary',a.id,'linked',b.id,'reason',note,'before',jsonb_build_object('primary_balance',ta->'balance_cents','linked_balance',tb->'balance_cents'))::text);
end$$;
create function reconcile_billing_payment(receipt uuid,payment uuid,note text,remove_match boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare r invoice_receipts;p client_payments;g uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||(select workspace_id from invoice_receipts where id=receipt),0));
 select * into r from invoice_receipts where id=receipt;select * into p from client_payments where id=payment;
 if not pms_session_ready() or r.id is null or p.id is null or r.workspace_id<>p.workspace_id or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 select group_id into g from billing_sources where invoice_id=r.invoice_id;perform 1 from billing_groups where id=g for update;
 if not exists(select 1 from billing_sources where document_id=p.document_id and group_id=g) or round(r.amount*100)<>p.amount_cents or length(trim(coalesce(note,''))) not between 3 and 2000 then raise exception 'Match the same payment amount within a reconciled record and explain the evidence';end if;
 if remove_match then delete from billing_payment_matches where receipt_id=r.id and payment_id=p.id;
 else insert into billing_payment_matches values(r.id,p.id,r.workspace_id,note,auth.uid(),now());end if;
 insert into audit_log(workspace_id,action,entity) values(r.workspace_id,case when remove_match then 'billing_payment_match_removed' else 'billing_payment_matched' end,jsonb_build_object('receipt',r.id,'payment',p.id,'reason',note)::text);
end$$;
create function separate_billing_source(source uuid,note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare s billing_sources;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||(select workspace_id from billing_sources where id=source),0));
 select * into s from billing_sources where id=source;
 if not pms_session_ready() or s.id is null or workspace_role(s.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 perform 1 from billing_groups where id in(s.group_id,s.origin_group_id) order by id for update;
 if exists(select 1 from client_documents where (id=s.document_id and previous_id is not null) or previous_id=s.document_id) then raise exception 'Document revisions remain linked to their history';end if;
 if s.is_primary or s.group_id=s.origin_group_id or length(trim(coalesce(note,''))) not between 3 and 2000 then raise exception 'Choose a linked source and explain the correction';end if;
 if exists(select 1 from billing_payment_matches m join invoice_receipts r on r.id=m.receipt_id join client_payments p on p.id=m.payment_id where r.invoice_id=s.invoice_id or p.document_id=s.document_id) then raise exception 'Remove payment matches for this source first';end if;
 update billing_sources set group_id=origin_group_id,is_primary=true where id=s.id;
 insert into audit_log(workspace_id,action,entity) values(s.workspace_id,'billing_source_separated',jsonb_build_object('source',s.id,'reason',note)::text);
end$$;
create function guard_linked_billing_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare g uuid;before jsonb:=to_jsonb(old);after jsonb:=to_jsonb(new);begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||old.workspace_id,0));
 select group_id into g from billing_sources where coalesce(document_id,invoice_id,estimate_id)=old.id;
 if tg_op='UPDATE' and (after->'workspace_id' is distinct from before->'workspace_id' or after->'project_id' is distinct from before->'project_id') then raise exception 'Financial source project identity is retained';end if;
 if (select count(*) from billing_sources where group_id=g)>1 and (tg_op='DELETE' or (after->'lines',after->'total_cents',after->'client_id',after->'previous_id') is distinct from (before->'lines',before->'total_cents',before->'client_id',before->'previous_id')) then raise exception 'Separate reconciled records before changing their financial basis';end if;
 if tg_op='UPDATE' and after ? 'billing_profile_snapshot' then new.billing_profile_snapshot:=old.billing_profile_snapshot;end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
create trigger zz_billing_source before update or delete on client_documents for each row execute function guard_linked_billing_source();
create trigger zz_billing_source before update or delete on invoices for each row execute function guard_linked_billing_source();
create trigger zz_billing_source before update or delete on estimates for each row execute function guard_linked_billing_source();
create function guard_billing_payment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare g uuid;t jsonb;amount bigint;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
 if tg_table_name='client_payments' then
 if exists(select 1 from client_payments where provider_id=new.provider_id) then return new;end if;
 select group_id into g from billing_sources where document_id=new.document_id;
 if new.workspace_id is distinct from(select workspace_id from billing_groups where id=g) then raise exception 'Payment workspace mismatch';end if;
 amount:=new.amount_cents-new.refunded_cents;
 else select group_id into g from billing_sources where invoice_id=new.invoice_id;amount:=round(new.amount*100);end if;
 if g is null or new.workspace_id is distinct from(select workspace_id from billing_groups where id=g) then raise exception 'Payment source unavailable';end if;
 perform 1 from billing_groups where id=g for update;t:=billing_group_totals(g);
 -- A verified provider event must still be retained if it reveals an overpayment.
 if tg_table_name='client_payments' then if new.provider='Square' then return new;end if;
 if not exists(select 1 from client_documents d where d.id=new.document_id and d.status='Approved' and d.kind<>'Creative brief' and d.total_cents=(t->>'total_cents')::bigint) then raise exception 'Record payments against the current approved financial basis';end if;end if;
 if (t->>'unverified_paid')::boolean or amount>(t->>'balance_cents')::bigint then raise exception 'Reconcile prior payments before recording an amount above the verified balance';end if;
 return new;
end$$;
create trigger billing_payment before insert on client_payments for each row execute function guard_billing_payment();
create trigger billing_receipt before insert on invoice_receipts for each row execute function guard_billing_payment();
-- Explicit purge clears reconciliation first, then the original financial graph.
do $$declare definition text;begin
 select pg_get_functiondef('public.purge_trash(uuid,text,uuid[])'::regprocedure) into definition;
 if position('pids:=ids;' in definition)=0 then raise exception 'Review project purge before extending it';end if;
 definition:=replace(definition,'pids:=ids;','pids:=ids; delete from billing_payment_matches where workspace_id=w and (payment_id in(select id from client_payments where document_id in(select id from client_documents where project_id=any(pids))) or receipt_id in(select id from invoice_receipts where invoice_id in(select id from invoices where project_id=any(pids)))); delete from billing_groups where workspace_id=w and project_id=any(pids);');execute definition;
end$$;
revoke all on function billing_capture_source(),billing_source_rows(uuid),billing_payment_rows(uuid),billing_group_totals(uuid),billing_profile_on_legacy(),guard_linked_billing_source(),guard_billing_payment(),billing_workspace(uuid),document_billing_balance(uuid),save_billing_profile(uuid,integer,jsonb),reconcile_billing_groups(uuid,uuid,text),reconcile_billing_payment(uuid,uuid,text,boolean),separate_billing_source(uuid,text) from public,anon,authenticated;
grant execute on function billing_workspace(uuid),document_billing_balance(uuid),save_billing_profile(uuid,integer,jsonb),reconcile_billing_groups(uuid,uuid,text),reconcile_billing_payment(uuid,uuid,text,boolean),separate_billing_source(uuid,text) to authenticated;
notify pgrst,'reload schema';

-- Explicit version chains share the obligation; approval selects its financial basis.
create or replace function billing_capture_source() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare g uuid;prior client_documents;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
 if tg_table_name='client_documents' then
 if new.previous_id is not null then
 select * into prior from client_documents where id=new.previous_id;
 if prior.workspace_id<>new.workspace_id or prior.project_id is distinct from new.project_id or prior.client_id is distinct from new.client_id or prior.kind<>new.kind or new.version<>prior.version+1 then raise exception 'Revisions must preserve project, recipient and document type';end if;
 select group_id into g from billing_sources where document_id=prior.id;perform 1 from billing_groups where id=g for update;
 insert into billing_sources(workspace_id,group_id,origin_group_id,document_id,is_primary) values(new.workspace_id,g,g,new.id,false);return new;
 end if;end if;
 insert into billing_groups(workspace_id,project_id) values(new.workspace_id,new.project_id) returning id into g;
 insert into billing_sources(workspace_id,group_id,origin_group_id,document_id,invoice_id,estimate_id) values(new.workspace_id,g,g,case when tg_table_name='client_documents' then new.id end,case when tg_table_name='invoices' then new.id end,case when tg_table_name='estimates' then new.id end);return new;
end$$;
create function billing_approved_version() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare g uuid;winner uuid;begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
 if new.status='Approved' and new.status is distinct from old.status then
 select group_id into g from billing_sources where document_id=new.id;perform 1 from billing_groups where id=g for update;
 select s.id into winner from billing_sources s join client_documents d on d.id=s.document_id where s.group_id=g and d.status='Approved' and d.kind=new.kind order by d.version desc,d.created_at desc,d.id limit 1;
 update billing_sources set is_primary=false where group_id=g and is_primary;
 update billing_sources set is_primary=true where id=winner;
 end if;return new;
end$$;
create trigger billing_approved_version after update of status on client_documents for each row execute function billing_approved_version();
-- Link only recorded, compatible revision chains. Never infer matches from names or amounts.
do $$declare r record;g uuid;begin
 for r in select d.* from client_documents d join client_documents p on p.id=d.previous_id where d.workspace_id=p.workspace_id and d.project_id is not distinct from p.project_id and d.client_id is not distinct from p.client_id and d.kind=p.kind and d.version=p.version+1 order by d.version,d.created_at loop
 select group_id into g from billing_sources where document_id=r.previous_id;
 update billing_sources set group_id=g,is_primary=false where document_id=r.id;
 if r.status='Approved' then update billing_sources set is_primary=false where group_id=g and is_primary;update billing_sources set is_primary=true where document_id=r.id;end if;
 end loop;
end$$;
create function document_billing_balances(w uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if not pms_session_ready() or workspace_role(w) is null then raise exception 'Access denied';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('document_id',d.id)||document_billing_balance(d.id)),'[]') from client_documents d where d.workspace_id=w and(workspace_role(w)='owner' or(d.client_id=auth.uid() and d.status<>'Draft' and(d.project_id is null or project_visible(w,d.project_id)))));
end$$;
create or replace function guard_project_deposit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if tg_op='INSERT' then new.deposit_required:=true;new.status:='Awaiting deposit';return new;end if;
 if old.deposit_required and not new.deposit_required then raise exception 'The upfront deposit requirement cannot be removed';end if;
 if new.deposit_required and new.status is distinct from old.status and new.status in('In progress','Active','Completed','Complete','Done') then
 if not exists(select 1 from client_documents d join billing_sources s on s.document_id=d.id where d.project_id=new.id and d.workspace_id=new.workspace_id and d.status='Approved' and d.kind in('Contract','Project agreement','Estimate') and d.total_cents=(billing_group_totals(s.group_id)->>'total_cents')::bigint and d.deposit_cents>0 and (billing_group_totals(s.group_id)->>'paid_cents')::bigint>=d.deposit_cents) then raise exception 'Approve the agreement and confirm the 50%% deposit before starting work';end if;
 end if;return new;
end$$;
revoke all on function billing_approved_version(),document_billing_balances(uuid),guard_project_deposit() from public,anon,authenticated;
grant execute on function document_billing_balances(uuid) to authenticated;
-- Include the client document/payment graph in explicitly confirmed lifecycle deletion.
do $$declare definition text;begin
 select pg_get_functiondef('public.purge_trash(uuid,text,uuid[])'::regprocedure) into definition;
 definition:=replace(definition,'''tasks'',''time_entries'',''budgets''','''client_documents'',''tasks'',''time_entries'',''budgets''');
 definition:=replace(definition,'delete from scope_changes where workspace_id=w and project_id=any(pids);',$patch$
 delete from client_checkout_links where workspace_id=w and document_id in(select id from client_documents where project_id=any(pids));
 delete from client_payments where workspace_id=w and document_id in(select id from client_documents where project_id=any(pids));
 delete from client_documents where workspace_id=w and project_id=any(pids);
 delete from scope_changes where workspace_id=w and project_id=any(pids);$patch$);
 execute definition;
 select pg_get_functiondef('public.delete_workspace(uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'foreach t in array array[',$patch$delete from billing_payment_matches where workspace_id=w;
 delete from billing_groups where workspace_id=w;
 delete from client_checkout_links where workspace_id=w;
 delete from client_payments where workspace_id=w;
 delete from client_documents where workspace_id=w;
 delete from studio_payment_settings where workspace_id=w;
 foreach t in array array[$patch$);execute definition;
end$$;

-- Persistent checkout claims use one provider idempotency key per obligation, even across retries.
create table billing_checkout_claims(
 group_id uuid primary key references billing_groups(id) on delete cascade,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 document_id uuid not null references client_documents(id) on delete cascade,
 amount_cents bigint not null, title text not null, created_at timestamptz not null default now()
);
alter table billing_checkout_claims enable row level security;
revoke all on billing_checkout_claims from anon,authenticated;
create function claim_billing_checkout(doc uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$declare d client_documents;g uuid;t jsonb;c billing_checkout_claims;l client_checkout_links;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or not(coalesce(workspace_role(d.workspace_id)='owner',false) or(d.client_id=auth.uid() and(d.project_id is null or project_visible(d.workspace_id,d.project_id)))) then raise exception 'Document unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||d.workspace_id,0));
 select * into d from client_documents where id=doc;
 select group_id into g from billing_sources where document_id=doc;
 t:=billing_group_totals(g);
 if d.status<>'Approved' or d.kind='Creative brief' or d.deposit_cents<=0 or d.total_cents<>(t->>'total_cents')::bigint or (t->>'unverified_paid')::boolean or (t->>'paid_cents')::bigint<>0 then raise exception 'A current approved unpaid document is required for deposit checkout';end if;
 select cl.* into l from client_checkout_links cl join billing_sources s on s.document_id=cl.document_id where s.group_id=g order by cl.document_id limit 1;
 if l.document_id is not null then
 if l.amount_cents<>d.deposit_cents then raise exception 'Existing checkout amount differs. Contact the studio before paying';end if;
 return jsonb_build_object('url',l.url);end if;
 insert into billing_checkout_claims(group_id,workspace_id,document_id,amount_cents,title) values(g,d.workspace_id,d.id,d.deposit_cents,d.title) on conflict do nothing;
 select * into c from billing_checkout_claims where group_id=g;
 if c.amount_cents<>d.deposit_cents then raise exception 'Existing checkout amount differs. Contact the studio before paying';end if;
 return jsonb_build_object('key',c.group_id,'document_id',c.document_id,'workspace_id',c.workspace_id,'amount_cents',c.amount_cents,'title',c.title);
end$$;
revoke all on function claim_billing_checkout(uuid) from public,anon,authenticated;
grant execute on function claim_billing_checkout(uuid) to authenticated;
-- Once collection starts, reconciliation must not create another provider collection path.
do $$declare definition text;begin
 select pg_get_functiondef('reconcile_billing_groups(uuid,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'ta:=billing_group_totals(a.id);','if exists(select 1 from billing_checkout_claims where group_id in(a.id,b.id)) then raise exception ''Checkout has started. Resolve provider collection before reconciling these records'';end if; ta:=billing_group_totals(a.id);');execute definition;
 select pg_get_functiondef('separate_billing_source(uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'if s.is_primary or','if exists(select 1 from billing_checkout_claims where group_id in(s.group_id,s.origin_group_id)) then raise exception ''Checkout has started. Collection records cannot be separated'';end if; if s.is_primary or');execute definition;
end$$;
create function guard_billing_payment_update() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||old.workspace_id,0));
 if (new.document_id,new.workspace_id,new.provider,new.provider_id,new.amount_cents) is distinct from (old.document_id,old.workspace_id,old.provider,old.provider_id,old.amount_cents) then raise exception 'Payment identity and gross amount are retained';end if;
 return new;end$$;
create trigger billing_payment_update before update on client_payments for each row execute function guard_billing_payment_update();
revoke all on function guard_billing_payment_update() from public,anon,authenticated;
notify pgrst,'reload schema';
