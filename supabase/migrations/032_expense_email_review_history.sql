alter table public.expense_mail_items add column subscription_id uuid;
alter table public.expense_mail_items add constraint expense_mail_subscription_workspace foreign key(workspace_id,subscription_id) references public.studio_cost_plans(workspace_id,id) on delete set null(subscription_id);
create or replace function public.review_expense_mail(item uuid, action text, details jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare r expense_mail_items; pid uuid; plan uuid; amt numeric; paid date; vendor_name text; duplicate_id uuid;
begin
 select * into r from expense_mail_items where id=item for update;
 if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required'; end if;
 if action='restore' then
  if r.status<>'Dismissed' then raise exception 'Only dismissed emails can be restored'; end if;
  update expense_mail_items set status='Review',reviewed_at=null where id=item; return null;
 end if;
 if r.status <> 'Review' then return coalesce(r.payment_id,r.subscription_id); end if;
 if action='dismiss' then update expense_mail_items set status='Dismissed',reviewed_at=now() where id=item; return null; end if;
 plan=nullif(details->>'plan_id','')::uuid;
 if plan is not null and not exists(select 1 from studio_cost_plans where id=plan and workspace_id=r.workspace_id and deleted_at is null) then raise exception 'Invalid subscription'; end if;
 if action='subscription' then
  if (details->>'status') not in ('Active','Canceled','Expired','Needs verification','Trial') or details->>'status' is null then raise exception 'Choose a plan and status'; end if;
  if plan is null then
   perform pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||':subscription:'||lower(trim(details->>'vendor')),0));
   if exists(select 1 from studio_cost_plans where workspace_id=r.workspace_id and lower(trim(vendor))=lower(trim(details->>'vendor'))) then
    raise exception 'A subscription for this vendor already exists. Select it from Linked subscription, or add a distinct plan in Subscriptions.';
   end if;
   if nullif(trim(details->>'vendor'),'') is null then raise exception 'Vendor required for a new subscription'; end if;
   insert into studio_cost_plans(workspace_id,name,vendor,category,amount,frequency,status,include_in_forecast,next_renewal_on,notes)
   values(r.workspace_id,left(trim(details->>'vendor')||' — '||r.subject,160),trim(details->>'vendor'),coalesce(nullif(details->>'category',''),'Software & subscriptions'),nullif(details->>'amount','')::numeric,'Unknown',details->>'status',false,nullif(details->>'next_renewal_on','')::date,'Created from approved email: '||r.account_email||'. '||r.subject)
   returning id into plan;
  end if;
  update studio_cost_plans set status=details->>'status', include_in_forecast=false,
   next_renewal_on=case when details->>'status' in ('Canceled','Expired') then null else coalesce(nullif(details->>'next_renewal_on','')::date,next_renewal_on) end
   where id=plan and workspace_id=r.workspace_id;
  update expense_mail_items set status='Recorded',subscription_id=plan,reviewed_at=now() where id=item; return plan;
 end if;
 if action <> 'payment' then raise exception 'Invalid review action'; end if;
 amt=(details->>'amount')::numeric; paid=(details->>'paid_on')::date; vendor_name=trim(details->>'vendor');
 if amt is null or amt<=0 or amt<>round(amt,2) or paid is null or paid>current_date or nullif(vendor_name,'') is null then raise exception 'Confirm payment amount, date and vendor'; end if;
 -- Serialize equal merchant/date/amount postings across different mailboxes/messages.
 perform pg_advisory_xact_lock(hashtextextended(r.workspace_id::text||lower(vendor_name)||paid::text||round(amt*100)::bigint::text,0));
 select id into duplicate_id from studio_cost_payments where workspace_id=r.workspace_id and paid_on=paid and amount=amt and lower(trim(vendor))=lower(vendor_name) limit 1;
 if duplicate_id is not null then
  update expense_mail_items set status='Duplicate',payment_id=duplicate_id,reviewed_at=now() where id=item; return duplicate_id;
 end if;
 insert into studio_cost_payments(workspace_id,plan_id,name,vendor,category,amount,frequency,paid_on,receipt_reference,notes)
 values(r.workspace_id,plan,left(vendor_name||' — '||r.subject,160),vendor_name,coalesce(nullif(details->>'category',''),'Software & subscriptions'),amt,'One time',paid,'gmail:'||r.account_email||':'||r.gmail_id,'Approved email receipt. Source account: '||r.account_email||'. Subject: '||r.subject)
 returning id into pid;
 update expense_mail_items set status='Recorded',payment_id=pid,reviewed_at=now() where id=item;
 return pid;
end $$;
