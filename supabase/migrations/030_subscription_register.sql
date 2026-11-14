-- Subscription inventory is independent from actual payments and opt-in forecasts.
alter table public.studio_cost_plans
  alter column amount drop not null,
  alter column starts_on drop not null,
  add column status text not null default 'Needs verification' check (status in ('Active','Needs verification','Trial','Canceled','Expired')),
  add column include_in_forecast boolean not null default false,
  add column next_renewal_on date;
alter table public.studio_cost_plans drop constraint studio_cost_plans_frequency_check;
alter table public.studio_cost_plans add constraint studio_cost_plans_frequency_check check (frequency in ('One time','Weekly','Monthly','Quarterly','Semiannually','Annually','Every 2 years','Every 4 weeks','Usage-based','Unknown'));
alter table public.studio_cost_plans add constraint studio_cost_plans_forecast_details check (not include_in_forecast or (status='Active' and amount is not null and amount>0 and starts_on is not null and frequency in ('One time','Weekly','Monthly','Quarterly','Semiannually','Annually')));
