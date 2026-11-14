create table public.monitor_refresh_locks (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 report_key text not null, next_at timestamptz not null, primary key(workspace_id,report_key)
);
alter table public.monitor_refresh_locks enable row level security;
revoke all on public.monitor_refresh_locks from anon,authenticated;
grant select,insert,update,delete on public.monitor_refresh_locks to service_role;
create function public.claim_monitor_refresh(w uuid,k text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed boolean;
begin
 insert into monitor_refresh_locks values(w,k,now()+interval '2 minutes') on conflict(workspace_id,report_key) do update set next_at=excluded.next_at where monitor_refresh_locks.next_at<now() returning true into claimed;
 return coalesce(claimed,false);
end $$;
revoke all on function public.claim_monitor_refresh(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_monitor_refresh(uuid,text) to service_role;

create table public.website_monitor_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 encrypted_payload text not null, updated_at timestamptz not null default now()
);
alter table public.website_monitor_connections enable row level security;
revoke all on public.website_monitor_connections from anon,authenticated;
grant select,insert,update,delete on public.website_monitor_connections to service_role;
