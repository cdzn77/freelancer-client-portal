-- Local pending migration. Scheduling status does not alter account access.
create table public.team_schedule_days (
 workspace_id uuid not null, user_id uuid not null, work_date date not null,
 minutes integer not null check (minutes between 0 and 1440),
 primary key(workspace_id,user_id,work_date),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create table public.team_schedule_status (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid not null,
 status text not null check(status in ('paused','archived')), starts_on date not null, ends_on date,
 check(ends_on is null or ends_on >= starts_on),
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table public.team_schedule_days enable row level security;
alter table public.team_schedule_status enable row level security;
grant select,insert,update,delete on public.team_schedule_days,public.team_schedule_status to authenticated;
create policy schedule_days_access on public.team_schedule_days for all to authenticated
 using(public.workspace_role(workspace_id)='owner' or (user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor')))
 with check((public.workspace_role(workspace_id)='owner' or (user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor'))) and exists(select 1 from public.workspace_members m where m.workspace_id=team_schedule_days.workspace_id and m.user_id=team_schedule_days.user_id and m.role<>'client'));
create policy schedule_status_read on public.team_schedule_status for select to authenticated
 using(public.workspace_role(workspace_id)='owner' or (user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor')));
create policy schedule_status_owner on public.team_schedule_status for all to authenticated
 using(public.workspace_role(workspace_id)='owner')
 with check(public.workspace_role(workspace_id)='owner' and exists(select 1 from public.workspace_members m where m.workspace_id=team_schedule_status.workspace_id and m.user_id=team_schedule_status.user_id and m.role<>'client'));
create policy pms_session_security on public.team_schedule_days as restrictive for all to authenticated using((select public.pms_session_ready())) with check((select public.pms_session_ready()));
create policy pms_session_security on public.team_schedule_status as restrictive for all to authenticated using((select public.pms_session_ready())) with check((select public.pms_session_ready()));
-- Self-service only applies to a member's own availability, never roster status.
create policy capacity_self on public.team_capacity for all to authenticated
 using(user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor'))
 with check(user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor'));
create policy time_off_self on public.team_time_off for all to authenticated
 using(user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor'))
 with check(user_id=auth.uid() and public.workspace_role(workspace_id) in ('member','contractor'));
