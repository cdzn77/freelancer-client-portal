\set ON_ERROR_STOP on
BEGIN;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception '%',label;end if;end$$;
create function pg_temp.denied(command text,label text) returns void language plpgsql as $$begin begin execute command;exception when raise_exception or insufficient_privilege or check_violation then return;end;raise exception 'Expected denial: %',label;end$$;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,aud,role) select ('cb000000-0000-4000-8000-00000000000'||n)::uuid,'playbook-'||n||'@example.invalid',now(),'{"pms_admin_provisioned":true}','authenticated','authenticated' from generate_series(1,4)n;
insert into workspaces(id,name) values('cb000000-0000-4000-8000-000000000010','Playbook fixture');
insert into workspace_members(workspace_id,user_id,role,display_name) select 'cb000000-0000-4000-8000-000000000010',('cb000000-0000-4000-8000-00000000000'||n)::uuid,case n when 1 then 'owner' when 2 then 'member' else 'client' end,'Person '||n from generate_series(1,4)n;
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
insert into projects(id,workspace_id,name,access_type,holidays) values('cb000000-0000-4000-8000-000000000020','cb000000-0000-4000-8000-000000000010','Playbook project','invite_only',array['2026-10-12'::date]);
insert into project_members values('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000020','cb000000-0000-4000-8000-000000000002','member'),('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000020','cb000000-0000-4000-8000-000000000003','guest');
insert into studio_blueprints(id,workspace_id,name,setup,steps) values('cb000000-0000-4000-8000-000000000030','cb000000-0000-4000-8000-000000000010','UX test','{"ux_audit":true}','[
 {"title":"Internal prep","offset_days":0,"estimated_minutes":30,"owner_role":"lead","shared":false},
 {"title":"Client approval","offset_days":2,"estimated_minutes":0,"owner_role":"client","shared":true,"approval_gate":true,"depends_on":[1]},
 {"title":"Peer QA","offset_days":3,"estimated_minutes":120,"owner_role":"reviewer","shared":false,"depends_on":[1,2]}
]');
set local role authenticated;
select pg_temp.denied($q$select apply_studio_blueprint_plan('cb000000-0000-4000-8000-000000000030','cb000000-0000-4000-8000-000000000020','2026-10-09','{"client":"cb000000-0000-4000-8000-000000000004","reviewer":"cb000000-0000-4000-8000-000000000002"}')$q$,'uninvited role mapping');
select pg_temp.ok((select count(*)=0 from blueprint_applications),'failed application rolls back');
select apply_studio_blueprint_plan('cb000000-0000-4000-8000-000000000030','cb000000-0000-4000-8000-000000000020','2026-10-09','{"client":"cb000000-0000-4000-8000-000000000003","reviewer":"cb000000-0000-4000-8000-000000000002"}','America/New_York');
select apply_studio_blueprint_plan('cb000000-0000-4000-8000-000000000030','cb000000-0000-4000-8000-000000000020','2026-10-09','{}');
select pg_temp.ok((select count(*)=3 from tasks where project_id='cb000000-0000-4000-8000-000000000020'),'retry does not duplicate tasks');
select pg_temp.ok((select due_date='2026-10-14' from tasks where title='Client approval'),'workdays skip weekend and holiday');
select pg_temp.ok((select count(*)=3 from dependencies where workspace_id='cb000000-0000-4000-8000-000000000010'),'multiple prerequisites preserved');
select pg_temp.ok((select count(*)=5 from discussion_threads where project_id='cb000000-0000-4000-8000-000000000020'),'reference threads created');
select pg_temp.ok((select count(*)=1 from task_recurrences where project_id='cb000000-0000-4000-8000-000000000020'),'weekly status created once');
select pg_temp.denied($q$update tasks set status='In progress' where title='Peer QA'$q$,'prerequisites block work');
select pg_temp.denied($q$update tasks set status='Done' where title='Client approval'$q$,'no approval record');
update tasks set status='Done' where title='Internal prep';
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok((select count(*)=1 from tasks where project_id='cb000000-0000-4000-8000-000000000020'),'client only sees shared tasks');
select pg_temp.ok((select count(*)=3 from discussion_threads where project_id='cb000000-0000-4000-8000-000000000020'),'client only sees shared references');
select pg_temp.denied($q$select configure_task_checkpoint((select id from tasks where title='Client approval'),false)$q$,'client cannot remove checkpoint');
select pg_temp.denied($q$select client_task_status((select id from tasks where title='Client approval'),'Done')$q$,'client cannot bypass formal approval');
select pg_temp.denied($q$select apply_studio_blueprint_plan('cb000000-0000-4000-8000-000000000030','cb000000-0000-4000-8000-000000000020','2026-10-09')$q$,'client cannot apply blueprint');
reset role;
insert into client_documents(id,workspace_id,project_id,client_id,kind,title,status,content,total_cents,created_by,decided_by,decided_at) values('cb000000-0000-4000-8000-000000000040','cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000020','cb000000-0000-4000-8000-000000000003','Project agreement','Approved scope','Approved','{}',10000,'cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000003',now());
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
reset role;
update project_members set role='owner' where project_id='cb000000-0000-4000-8000-000000000020' and user_id='cb000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select pg_temp.denied($q$update tasks set approval_document_id='cb000000-0000-4000-8000-000000000040' where title='Client approval'$q$,'project manager cannot bypass administrator agreement access');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select configure_task_checkpoint((select id from tasks where title='Client approval'),true,null,'cb000000-0000-4000-8000-000000000040');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok((task_checkpoint_snapshot((select id from tasks where title='Client approval'))->>'approved')::boolean,'client sees recorded approval');
select client_task_status((select id from tasks where title='Client approval'),'Done');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
update tasks set status='In progress' where title='Peer QA';
reset role;
-- Reset only disposable fixture dates to exercise reminder deduplication.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update tasks set status='To do',due_date=current_date,approval_document_id=null where title='Client approval';
update tasks set approval_opened_at=now()-interval '10 days' where title='Client approval';
select process_playbook_reminders();select process_playbook_reminders();
select pg_temp.ok((select count(*)=1 from studio_notifications where event_key like 'playbook-due:%' and workspace_id='cb000000-0000-4000-8000-000000000010'),'client reminder deduplicates');
select pg_temp.ok((select count(*)=1 from studio_notifications where event_key like 'playbook-review:%' and workspace_id='cb000000-0000-4000-8000-000000000010'),'approval follow-up deduplicates');
select pg_temp.ok(not has_function_privilege('anon','apply_studio_blueprint_plan(uuid,uuid,date,jsonb,text)','execute'),'anonymous application denied');
select pg_temp.ok(not has_function_privilege('authenticated','process_playbook_reminders()','execute'),'reminder worker private');
select pg_temp.ok(not has_function_privilege('authenticated','playbook_approved(tasks)','execute'),'approval helper private');
ROLLBACK;
