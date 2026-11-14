create table public.studio_cost_plans (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null check(length(name) between 1 and 160), vendor text not null default '' check(length(vendor)<=160),
 category text not null check(length(category) between 1 and 100), amount numeric(12,2) not null check(amount>0),
 frequency text not null check(frequency in ('One time','Weekly','Monthly','Quarterly','Semiannually','Annually')),
 starts_on date not null, ends_on date, review_for_savings boolean not null default false,
 notes text not null default '' check(length(notes)<=4000), archived_at timestamptz, deleted_at timestamptz,
 created_at timestamptz not null default now(), unique(workspace_id,id), check(ends_on is null or ends_on>=starts_on)
);
create table public.studio_cost_payments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 plan_id uuid, name text not null check(length(name) between 1 and 160), vendor text not null default '' check(length(vendor)<=160),
 category text not null check(length(category) between 1 and 100), amount numeric(12,2) not null check(amount>0),
 frequency text not null check(frequency in ('One time','Weekly','Monthly','Quarterly','Semiannually','Annually')),
 paid_on date not null, scheduled_for date, payment_method text not null default '' check(length(payment_method)<=100),
 receipt_reference text not null default '' check(length(receipt_reference)<=500), notes text not null default '' check(length(notes)<=4000),
 archived_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(),
 foreign key(workspace_id,plan_id) references public.studio_cost_plans(workspace_id,id) on delete set null(plan_id),
 unique(workspace_id,plan_id,scheduled_for)
);
create index studio_cost_payments_period on public.studio_cost_payments(workspace_id,paid_on);
alter table public.studio_cost_plans enable row level security;
alter table public.studio_cost_payments enable row level security;
grant select,insert,update,delete on public.studio_cost_plans,public.studio_cost_payments to authenticated;
create policy studio_cost_plans_admin on public.studio_cost_plans for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
create policy studio_cost_payments_admin on public.studio_cost_payments for all to authenticated using(workspace_role(workspace_id)='owner') with check(workspace_role(workspace_id)='owner');
