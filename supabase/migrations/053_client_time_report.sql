alter table projects add column client_time_report_enabled boolean not null default false;
alter table projects add column client_retainer_report_enabled boolean not null default false;
create function guard_client_report_settings() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if tg_op='INSERT' then
 if (new.client_time_report_enabled or new.client_retainer_report_enabled) and workspace_role(new.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required to share time reports';end if;
 elsif (new.client_time_report_enabled,new.client_retainer_report_enabled) is distinct from(old.client_time_report_enabled,old.client_retainer_report_enabled) and workspace_role(new.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required to share time reports';end if;
 return new;
end$$;
create trigger client_report_settings before insert or update on projects for each row execute function guard_client_report_settings();
create function client_time_report(p_project uuid,starts_on date,ends_on date,preview_client uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare p projects;u uuid:=auth.uid();rows jsonb;plans jsonb:='[]';begin
 select * into p from projects where id=p_project;
 if not pms_session_ready() or p.id is null or p.deleted_at is not null or p.archived_at is not null then raise exception 'Project unavailable';end if;
 if preview_client is not null then
 if workspace_role(p.workspace_id) is distinct from 'owner' then raise exception 'Administrator preview required';end if;u:=preview_client;
 end if;
 if not p.client_time_report_enabled or not('tasks'=any(p.client_tools)) or not exists(select 1 from project_members pm join workspace_members wm using(workspace_id,user_id) where pm.project_id=p.id and pm.workspace_id=p.workspace_id and pm.user_id=u and pm.role='guest' and wm.role='client') then raise exception 'Time report is not shared with this client';end if;
 if starts_on is null or ends_on is null or ends_on<starts_on or ends_on-starts_on>366 then raise exception 'Choose a date range up to one year';end if;
 select coalesce(jsonb_agg(jsonb_build_object('task_id',t.id,'task',t.title,'date',e.entry_date,'minutes',e.minutes,'billable',e.billable,'billing_treatment',e.billing_treatment) order by e.entry_date,t.title,e.id),'[]') into rows
 from time_entries e join tasks t on t.id=e.task_id and t.project_id=p.id and t.workspace_id=p.workspace_id where e.project_id=p.id and e.workspace_id=p.workspace_id and e.status='Approved' and t.is_published and e.entry_date between starts_on and ends_on;
 if p.client_retainer_report_enabled then
 select coalesce(jsonb_agg(jsonb_build_object('period',r.period,'hours',r.hours,'rollover',r.rollover,'shared_covered_minutes',coalesce((select sum(e.minutes) from time_entries e join tasks t on t.id=e.task_id and t.project_id=p.id and t.workspace_id=p.workspace_id where e.project_id=p.id and e.workspace_id=p.workspace_id and e.status='Approved' and t.is_published and e.billable and e.billing_treatment='covered' and e.entry_date>=r.period and e.entry_date<r.period+interval '1 month'),0)) order by r.period),'[]') into plans from retainers r where r.project_id=p.id and r.workspace_id=p.workspace_id and r.period<=ends_on and r.period+interval '1 month'>starts_on;
 end if;
 return jsonb_build_object('entries',rows,'retainers',plans);
end$$;
revoke all on function guard_client_report_settings(),client_time_report(uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function client_time_report(uuid,date,date,uuid) to authenticated;
