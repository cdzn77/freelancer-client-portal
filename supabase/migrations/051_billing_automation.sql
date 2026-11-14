create table billing_schedules(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,project_id uuid not null references projects(id) on delete cascade,
 source_id uuid references client_documents(id) on delete set null,template jsonb not null,client_id uuid not null references auth.users(id),created_by uuid not null references auth.users(id),
 cadence text not null check(cadence in('weekly','monthly')),timezone text not null,starts_on date not null,ends_on date,next_on date not null,due_days integer not null check(due_days between 0 and 90),
 status text not null default 'Active' check(status in('Active','Paused','Cancelled','Finished')),last_error text,created_at timestamptz not null default now()
);
create table billing_occurrences(
 schedule_id uuid not null references billing_schedules(id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade,occurrence date not null,
 document_id uuid references client_documents(id) on delete set null,status text not null check(status in('Draft','Skipped','Error')),note text,created_at timestamptz not null default now(),primary key(schedule_id,occurrence)
);
create table billing_reminder_rules(
 group_id uuid primary key references billing_groups(id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade,document_id uuid not null references client_documents(id) on delete cascade,
 timezone text not null,first_days integer not null check(first_days between 1 and 90),repeat_days integer not null check(repeat_days between 1 and 90),max_reminders integer not null check(max_reminders between 1 and 12),enabled boolean not null default false,email_enabled boolean not null default false,created_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
alter table studio_notifications add column billing_reminder_group uuid references billing_reminder_rules(group_id) on delete cascade;
alter table studio_notifications add column billing_document_id uuid references client_documents(id) on delete cascade;
create table billing_reminder_runs(
 id uuid primary key default gen_random_uuid(),group_id uuid not null references billing_reminder_rules(group_id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade,
 reminder_on date not null,user_id uuid not null references auth.users(id),balance_cents bigint not null,notification_id uuid references studio_notifications(id) on delete set null,created_at timestamptz not null default now(),unique(group_id,reminder_on)
);
do $$declare t text;begin foreach t in array array['billing_schedules','billing_occurrences','billing_reminder_rules','billing_reminder_runs'] loop
 execute format('alter table %I enable row level security',t);execute format('revoke all on %I from public,anon,authenticated',t);execute format('grant select on %I to authenticated',t);
 execute format('create policy billing_automation_owner on %I for select to authenticated using(pms_session_ready() and workspace_role(workspace_id)=''owner'')',t);
end loop;end$$;
create function billing_recipient_allowed(w uuid,p uuid,u uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from workspace_members m join projects pr on pr.workspace_id=m.workspace_id where m.workspace_id=w and m.user_id=u and pr.id=p and pr.deleted_at is null and pr.archived_at is null and(m.role='owner' or (m.role='client' and exists(select 1 from project_members where workspace_id=w and project_id=p and user_id=u and role='guest')) or(m.role in('member','contractor') and(pr.access_type='workspace' or exists(select 1 from project_members where workspace_id=w and project_id=p and user_id=u and role in('member','owner'))))))
$$;
create function create_billing_schedule(doc uuid,cadence text,timezone text,starts_on date,ends_on date,due_days integer,coverage_confirmed boolean) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$declare d client_documents;result uuid;today date;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or workspace_role(d.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if not exists(select 1 from pg_timezone_names where name=timezone) then raise exception 'Choose a valid timezone';end if;
 today:=(now() at time zone timezone)::date;
 if coverage_confirmed is distinct from true or d.kind<>'Invoice' or d.status not in('Draft','Approved') or d.total_cents<=0 or d.project_id is null or not billing_recipient_allowed(d.workspace_id,d.project_id,d.client_id) then raise exception 'Choose a priced invoice with a current project recipient and confirm billing coverage';end if;
 if starts_on is null or starts_on<today or starts_on>today+1826 or (ends_on is not null and(ends_on<starts_on or ends_on>starts_on+3653)) or cadence not in('weekly','monthly') or cadence is null or due_days is null or due_days not between 0 and 90 then raise exception 'Choose valid future dates, cadence and due days';end if;
 insert into billing_schedules(workspace_id,project_id,source_id,template,client_id,created_by,cadence,timezone,starts_on,ends_on,next_on,due_days) values(d.workspace_id,d.project_id,d.id,to_jsonb(d),d.client_id,auth.uid(),cadence,timezone,starts_on,ends_on,starts_on,due_days) returning id into result;
 insert into audit_log(workspace_id,action,entity) values(d.workspace_id,'billing_schedule_created',result::text);return result;
end$$;
create function set_billing_schedule_state(schedule uuid,new_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare s billing_schedules;begin
 select * into s from billing_schedules where id=schedule for update;
 if not pms_session_ready() or s.id is null or workspace_role(s.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if s.status in('Cancelled','Finished') or new_status not in('Active','Paused','Cancelled') or new_status is null then raise exception 'Choose a valid schedule transition';end if;
 update billing_schedules set status=new_status,last_error=null where id=s.id;
 insert into audit_log(workspace_id,action,entity) values(s.workspace_id,'billing_schedule_state',jsonb_build_object('schedule',s.id,'state',new_status)::text);
end$$;
create function run_billing_schedules(at_time timestamptz default now(),only_workspace uuid default null) returns integer language plpgsql security definer set search_path=public,pg_temp as $$declare s billing_schedules;today date;due date;made integer:=0;d uuid;begin
 for s in select * from billing_schedules where status='Active' and(only_workspace is null or workspace_id=only_workspace) order by id for update skip locked loop
 begin
 if not exists(select 1 from workspace_members where workspace_id=s.workspace_id and user_id=s.created_by and role='owner') or not billing_recipient_allowed(s.workspace_id,s.project_id,s.client_id) then
 update billing_schedules set status='Paused',last_error='Project, recipient or schedule owner access changed. Review before resuming.' where id=s.id;continue;end if;
 today:=(at_time at time zone s.timezone)::date;due:=s.next_on;
 -- Missed cycles are recorded, not back-billed after downtime, pauses or archival.
 while due<today and(s.ends_on is null or due<=s.ends_on) loop
 insert into billing_occurrences(schedule_id,workspace_id,occurrence,status,note) values(s.id,s.workspace_id,due,'Skipped','Missed cycle. Review manually; no draft or charge was created.') on conflict do nothing;
 due:=next_recurrence_date(due,s.cadence,extract(day from s.starts_on)::integer);
 end loop;
 if s.ends_on is not null and due>s.ends_on then update billing_schedules set status='Finished',next_on=due where id=s.id;continue;end if;
 if due=today and not exists(select 1 from billing_occurrences where schedule_id=s.id and occurrence=due) then
 insert into client_documents(workspace_id,project_id,client_id,kind,title,status,content,total_cents,created_by,due_date)
 values(s.workspace_id,s.project_id,s.client_id,'Invoice',left(s.template->>'title',180)||' · '||due,'Draft',s.template->'content',(s.template->>'total_cents')::bigint,s.created_by,due+s.due_days) returning id into d;
 insert into billing_occurrences(schedule_id,workspace_id,occurrence,document_id,status) values(s.id,s.workspace_id,due,d,'Draft');
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,billing_document_id) values(s.workspace_id,s.created_by,s.project_id,'Recurring invoice draft ready for review','billing-draft:'||s.id||':'||due,d) on conflict do nothing;
 made:=made+1;
 end if;
 if due=today then due:=next_recurrence_date(due,s.cadence,extract(day from s.starts_on)::integer);end if;
 update billing_schedules set next_on=due,last_error=null where id=s.id;
 exception when others then
 insert into billing_occurrences(schedule_id,workspace_id,occurrence,status,note) values(s.id,s.workspace_id,coalesce(due,s.next_on),'Error','Draft creation failed. Review source and access; create this cycle manually before resuming.') on conflict do nothing;
 update billing_schedules set status='Paused',last_error='Draft creation failed. Review occurrence history before resuming.' where id=s.id;
 end;
 end loop;return made;
end$$;
create function save_billing_reminders(doc uuid,timezone text,first_days integer,repeat_days integer,max_reminders integer,enabled boolean,email_enabled boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare d client_documents;g uuid;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or workspace_role(d.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||d.workspace_id,0));
 select group_id into g from billing_sources where document_id=doc;
 if not exists(select 1 from pg_timezone_names where name=timezone) then raise exception 'Choose a valid timezone';end if;
 if d.kind<>'Invoice' or d.status<>'Approved' or d.due_date is null or d.project_id is null or not billing_recipient_allowed(d.workspace_id,d.project_id,d.client_id) then raise exception 'Choose an approved invoice with a due date and current recipient';end if;
 insert into billing_reminder_rules(group_id,workspace_id,document_id,timezone,first_days,repeat_days,max_reminders,enabled,email_enabled,created_by) values(g,d.workspace_id,d.id,timezone,first_days,repeat_days,max_reminders,enabled,email_enabled,auth.uid())
 on conflict(group_id) do update set document_id=excluded.document_id,timezone=excluded.timezone,first_days=excluded.first_days,repeat_days=excluded.repeat_days,max_reminders=excluded.max_reminders,enabled=excluded.enabled,email_enabled=excluded.email_enabled,created_by=excluded.created_by,updated_at=now();
 insert into audit_log(workspace_id,action,entity) values(d.workspace_id,'billing_reminders_configured',jsonb_build_object('group',g,'enabled',enabled,'email_enabled',email_enabled)::text);
end$$;
create function billing_reminder_ready(g uuid,recipient uuid,for_email boolean default false,at_time timestamptz default now()) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$declare r billing_reminder_rules;d client_documents;t jsonb;begin
 select * into r from billing_reminder_rules where group_id=g;select * into d from client_documents where id=r.document_id;
 if r.group_id is null or not r.enabled or(for_email and(not r.email_enabled or not exists(select 1 from email_preferences where workspace_id=r.workspace_id and user_id=recipient and enabled))) or d.id is null or d.client_id is distinct from recipient or d.kind<>'Invoice' or d.status<>'Approved' or d.due_date is null or d.due_date+r.first_days>(at_time at time zone r.timezone)::date or not billing_recipient_allowed(r.workspace_id,d.project_id,recipient) or not exists(select 1 from workspace_members where workspace_id=r.workspace_id and user_id=r.created_by and role='owner') or not exists(select 1 from billing_sources where document_id=d.id and group_id=g) then return false;end if;
 t:=billing_group_totals(g);
 return not(t->>'unverified_paid')::boolean and(t->>'balance_cents')::bigint>0 and d.total_cents=(t->>'total_cents')::bigint;
end$$;
create function run_billing_reminders(at_time timestamptz default now(),only_workspace uuid default null) returns integer language plpgsql security definer set search_path=public,pg_temp as $$declare r billing_reminder_rules;d client_documents;today date;last_day date;n integer;notice uuid;made integer:=0;begin
 for r in select * from billing_reminder_rules where enabled and(only_workspace is null or workspace_id=only_workspace) order by group_id loop
 perform pg_advisory_xact_lock(hashtextextended('billing:'||r.workspace_id,0));
 select * into r from billing_reminder_rules where group_id=r.group_id for update skip locked;
 if not found then continue;end if;
 select * into d from client_documents where id=r.document_id;
 today:=(at_time at time zone r.timezone)::date;
 if extract(hour from at_time at time zone r.timezone)<9 or not billing_reminder_ready(r.group_id,d.client_id,false,at_time) then continue;end if;
 select max(reminder_on),count(*) into last_day,n from billing_reminder_runs where group_id=r.group_id;
 if n>=r.max_reminders or(last_day is not null and today<last_day+r.repeat_days) then continue;end if;
 insert into billing_reminder_runs(group_id,workspace_id,reminder_on,user_id,balance_cents) values(r.group_id,r.workspace_id,today,d.client_id,(billing_group_totals(r.group_id)->>'balance_cents')::bigint) on conflict do nothing;
 if not found then continue;end if;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,billing_reminder_group,billing_document_id) values(r.workspace_id,d.client_id,d.project_id,'Invoice payment reminder: review your current balance','billing-reminder:'||r.group_id||':'||today,r.group_id,d.id) returning id into notice;
 update billing_reminder_runs set notification_id=notice where group_id=r.group_id and reminder_on=today;made:=made+1;
 end loop;return made;
end$$;
create or replace function queue_studio_email() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if new.billing_reminder_group is not null and not billing_reminder_ready(new.billing_reminder_group,new.user_id,true) then return new;end if;
 if exists(select 1 from email_preferences where workspace_id=new.workspace_id and user_id=new.user_id and enabled) then insert into studio_email_jobs(workspace_id,notification_id,user_id) values(new.workspace_id,new.id,new.user_id) on conflict do nothing;end if;return new;end$$;
revoke all on function billing_recipient_allowed(uuid,uuid,uuid),create_billing_schedule(uuid,text,text,date,date,integer,boolean),set_billing_schedule_state(uuid,text),run_billing_schedules(timestamptz,uuid),save_billing_reminders(uuid,text,integer,integer,integer,boolean,boolean),billing_reminder_ready(uuid,uuid,boolean,timestamptz),run_billing_reminders(timestamptz,uuid),queue_studio_email() from public,anon,authenticated;
grant execute on function create_billing_schedule(uuid,text,text,date,date,integer,boolean),set_billing_schedule_state(uuid,text),save_billing_reminders(uuid,text,integer,integer,integer,boolean,boolean) to authenticated;
grant execute on function run_billing_schedules(timestamptz,uuid),run_billing_reminders(timestamptz,uuid),billing_reminder_ready(uuid,uuid,boolean,timestamptz) to service_role;
select cron.schedule('studio-billing-drafts','20 * * * *','select public.run_billing_schedules()');
select cron.schedule('studio-billing-reminders','35 * * * *','select public.run_billing_reminders()');
notify pgrst,'reload schema';
create function disable_billing_reminders(g uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare w uuid;begin
 select workspace_id into w from billing_reminder_rules where group_id=g;
 if not pms_session_ready() or w is null or workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||w,0));
 update billing_reminder_rules set enabled=false,email_enabled=false,updated_at=now() where group_id=g;
 insert into audit_log(workspace_id,action,entity) values(w,'billing_reminders_disabled',g::text);
end$$;
create function process_workspace_billing(w uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin
 if not pms_session_ready() or workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 return jsonb_build_object('drafts',run_billing_schedules(now(),w),'reminders',run_billing_reminders(now(),w));
end$$;
create function billing_notice_allowed(doc uuid,u uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from client_documents d join workspace_members m on m.workspace_id=d.workspace_id and m.user_id=u where d.id=doc and(m.role='owner' or(d.client_id=u and d.status<>'Draft' and billing_recipient_allowed(d.workspace_id,d.project_id,u))))
$$;
revoke all on function disable_billing_reminders(uuid),process_workspace_billing(uuid),billing_notice_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function disable_billing_reminders(uuid),process_workspace_billing(uuid) to authenticated;
grant execute on function billing_notice_allowed(uuid,uuid) to service_role;
notify pgrst,'reload schema';
