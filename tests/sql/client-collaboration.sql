\set ON_ERROR_STOP on
BEGIN;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception '%',label;end if;end$$;
create function pg_temp.denied(command text,label text) returns void language plpgsql as $$begin begin execute command;exception when raise_exception or insufficient_privilege or check_violation then return;end;raise exception 'Expected denial: %',label;end$$;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,aud,role)
 select ('ca000000-0000-4000-8000-00000000000'||n)::uuid,'collab-'||n||'@example.invalid',now(),'{"pms_admin_provisioned":true}','authenticated','authenticated' from generate_series(1,5)n;
insert into workspaces(id,name) values('ca000000-0000-4000-8000-000000000010','Collaboration fixture');
insert into workspace_members(workspace_id,user_id,role,display_name) select 'ca000000-0000-4000-8000-000000000010',('ca000000-0000-4000-8000-00000000000'||n)::uuid,case n when 1 then 'owner' when 2 then 'member' else 'client' end,'Person '||n from generate_series(1,5)n;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
insert into projects(id,workspace_id,name,client_name,access_type,client_tools,type) values
 ('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000010','Discussion project','Client','workspace',array['tasks','discussions'],'fixed_fee'),
 ('ca000000-0000-4000-8000-000000000021','ca000000-0000-4000-8000-000000000010','Destination','Other','invite_only','{}','fixed_fee');
insert into project_members values
 ('ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000003','guest'),
 ('ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000004','guest');
set local role authenticated;
select collaboration_command('create','ca000000-0000-4000-8000-000000000020',null,'{"request":"ca000000-0000-4000-8000-000000000030","title":"Shared discussion","hidden":false}');
select collaboration_command('create','ca000000-0000-4000-8000-000000000020',null,'{"request":"ca000000-0000-4000-8000-000000000031","title":"Internal discussion","hidden":true}');
select pg_temp.denied($q$select collaboration_command('post','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000031','{"body":"Private client mention","people":["ca000000-0000-4000-8000-000000000003"]}')$q$,'hidden mention');
select collaboration_command('post','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"body":"Hello everyone","tags":["everyone"],"request":"ca000000-0000-4000-8000-000000000040"}');
reset role;
select pg_temp.ok((select count(*)=3 from studio_notifications where discussion_id='ca000000-0000-4000-8000-000000000030'),'all eligible team/client recipients notified');
set local role authenticated;
insert into tasks(id,workspace_id,project_id,title,assignee_id) values('ca000000-0000-4000-8000-000000000050','ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000020','Client task','ca000000-0000-4000-8000-000000000003');
select pg_temp.ok((select is_published from tasks where id='ca000000-0000-4000-8000-000000000050'),'client assignment shares task');
select pg_temp.denied($q$insert into tasks(workspace_id,project_id,title,assignee_id) values('ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000020','Uninvited client','ca000000-0000-4000-8000-000000000005')$q$,'uninvited assignment');
select collaboration_command('ensure_task','ca000000-0000-4000-8000-000000000020',null,'{"task":"ca000000-0000-4000-8000-000000000050"}');
select pg_temp.ok((collaboration_snapshot('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030')->>'manager')::boolean,'manager snapshot');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok((select count(*)=0 from discussion_threads where id='ca000000-0000-4000-8000-000000000031'),'client cannot read hidden thread via REST');
select pg_temp.ok((select count(*)=0 from collab_people('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030') where user_id='ca000000-0000-4000-8000-000000000002'),'client picker omits implicit internal staff');
select pg_temp.denied($q$select collaboration_snapshot('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000031')$q$,'client cannot read private snapshot');
select collaboration_command('post','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"body":"Client reply","request":"ca000000-0000-4000-8000-000000000041"}');
select collaboration_command('post','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"body":"Client reply","request":"ca000000-0000-4000-8000-000000000041"}');
select pg_temp.ok((select count(*)=1 from discussion_posts where request_id='ca000000-0000-4000-8000-000000000041'),'post retries idempotent');
select collaboration_command('create','ca000000-0000-4000-8000-000000000020',null,'{"request":"ca000000-0000-4000-8000-000000000032","title":"Client started discussion","hidden":true}');
select pg_temp.ok((select not hidden_from_clients from discussion_threads where id='ca000000-0000-4000-8000-000000000032'),'client threads always shared');
select collaboration_command('open','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030');
select pg_temp.ok((select count(*)=0 from discussion_views),'client access logs denied');
select pg_temp.ok(jsonb_array_length(collaboration_snapshot('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030')->'views')=0,'snapshot excludes client access logs');
select client_task_status('ca000000-0000-4000-8000-000000000050','Done');
update tasks set title='Hacked' where id='ca000000-0000-4000-8000-000000000050';
-- UPDATE under RLS may affect zero rows rather than raise; assert unchanged instead.
select pg_temp.ok((select title='Client task' from tasks where id='ca000000-0000-4000-8000-000000000050'),'client cannot edit task details');
select pg_temp.denied($q$select collaboration_command('edit_thread','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"title":"Someone else"}')$q$,'client editing another discussion');
select collaboration_command('delete','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000032');
select collaboration_command('restore','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000032');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
select pg_temp.denied($q$select client_task_status('ca000000-0000-4000-8000-000000000050','To do')$q$,'unassigned client completion');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok(jsonb_array_length(collaboration_snapshot('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030')->'views')=1,'admin access log');
select pg_temp.ok((preview_client_collaboration('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000003','ca000000-0000-4000-8000-000000000030')->>'manager')::boolean=false,'preview has client privileges');
select pg_temp.ok(auth.uid()='ca000000-0000-4000-8000-000000000001','preview restores admin identity');


insert into comments(id,workspace_id,project_id,body,is_published) values('ca000000-0000-4000-8000-000000000070','ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000020','Legacy shared text',true);
select collaboration_command('edit_thread','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000070','{"hidden":true}');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok((select count(*)=0 from comments where id='ca000000-0000-4000-8000-000000000070'),'legacy REST cannot bypass hidden threads');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select collaboration_command('delete','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000070');
reset role;
update discussion_threads set deleted_at=now()-interval '31 days' where id='ca000000-0000-4000-8000-000000000070';
select process_discussion_reminders();
select pg_temp.ok((select count(*)=0 from comments where id='ca000000-0000-4000-8000-000000000070'),'legacy rows cannot reappear after Trash purge');
set local role authenticated;
-- A client can upload only to readable threads and their own editable comments.
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.denied($q$select collab_file_reserve('ca000000-0000-4000-8000-000000000031',null,'secret.png','image/png',100,'supabase')$q$,'hidden upload');
select collab_file_reserve('ca000000-0000-4000-8000-000000000030',(select id from discussion_posts where request_id='ca000000-0000-4000-8000-000000000041'),'proof.png','image/png',100,'supabase');
select collaboration_command('typing','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"active":true}');
select collaboration_command('react','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030',jsonb_build_object('post',(select id from discussion_posts where request_id='ca000000-0000-4000-8000-000000000040'),'emoji','👍'));
reset role;
update collaboration_blobs set path=workspace_id||'/proof.png',ready=true where name='proof.png';
update discussion_posts set created_at=now()-interval '31 minutes' where request_id='ca000000-0000-4000-8000-000000000041';
set local role authenticated;
select pg_temp.ok(not collab_editable((select id from discussion_posts where request_id='ca000000-0000-4000-8000-000000000041')),'client edit window expires');
select pg_temp.denied($q$select collab_file_remove((select id from discussion_attachments limit 1))$q$,'expired file editing');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok((select count(*)=0 from collaboration_blobs),'uninvited client cannot read blob metadata');
select pg_temp.ok((select count(*)=0 from discussion_reactions),'uninvited client cannot read reactions');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok(jsonb_array_length(collaboration_snapshot('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030')->'typing')=1,'typing visible to eligible peer');
select collaboration_command('copy','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030','{"project":"ca000000-0000-4000-8000-000000000021"}');
select pg_temp.ok((select count(*)=2 from discussion_attachments),'copy keeps file links');
select pg_temp.ok((select count(*)=1 from collaboration_blobs),'copy shares immutable blob');
select collaboration_command('settings','ca000000-0000-4000-8000-000000000020',null,'{"minutes":null}');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.ok(collab_editable((select id from discussion_posts where request_id='ca000000-0000-4000-8000-000000000041')),'unlimited editing setting');
reset role;
insert into discussion_email_replies(token,notification_id,thread_id,user_id) select 'ca000000-0000-4000-8000-000000000060',id,discussion_id,user_id from studio_notifications where discussion_id='ca000000-0000-4000-8000-000000000030' and user_id='ca000000-0000-4000-8000-000000000003' limit 1;
select pg_temp.denied($q$select receive_discussion_email('ca000000-0000-4000-8000-000000000060','spoof@example.invalid','email-test','Spoofed reply')$q$,'email sender must match token owner');
select receive_discussion_email('ca000000-0000-4000-8000-000000000060','collab-3@example.invalid','email-test','Email reply');
select receive_discussion_email('ca000000-0000-4000-8000-000000000060','collab-3@example.invalid','email-test','Email reply');
select pg_temp.ok((select count(*)=1 from discussion_email_receipts),'email retry idempotent');
insert into discussion_reminders(thread_id,created_by,recipients,due_at) values('ca000000-0000-4000-8000-000000000030','ca000000-0000-4000-8000-000000000001',array['ca000000-0000-4000-8000-000000000003'::uuid,'ca000000-0000-4000-8000-000000000005'::uuid],now()-interval '1 minute');
select process_discussion_reminders();select process_discussion_reminders();
select pg_temp.ok((select count(*)=1 from studio_notifications where event_key like 'discussion-reminder:%'),'reminders deduplicate and exclude revoked or uninvited recipients');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select collaboration_command('convert','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000030');
select pg_temp.ok((select count(*)=3 from discussion_posts where thread_id='ca000000-0000-4000-8000-000000000030'),'conversion retains comments');
select collaboration_command('move','ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000031','{"project":"ca000000-0000-4000-8000-000000000021"}');
select pg_temp.ok((select hidden_from_clients from discussion_threads where id='ca000000-0000-4000-8000-000000000031'),'moves start private');
select pg_temp.ok(not has_function_privilege('anon','collaboration_command(text,uuid,uuid,jsonb)','execute'),'anonymous RPC denied');
select pg_temp.ok(not has_function_privilege('authenticated','receive_discussion_email(uuid,text,text,text)','execute'),'email ingestion service-only');
ROLLBACK;
\echo Client collaboration permission checks passed.
