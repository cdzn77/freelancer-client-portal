\set ON_ERROR_STOP on
BEGIN;
do $$begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('create_work_invoice','planning_fingerprint','shift_work_date','preview_task_schedule','apply_task_schedule','save_task_allocations','get_project_planning','create_assistant_task','preview_client_project') and has_function_privilege('anon',p.oid,'EXECUTE')) then
 raise exception 'Anonymous access remains on connected workflow functions';end if;
 if has_function_privilege('authenticated','public.planning_fingerprint(uuid)','EXECUTE') then raise exception 'Internal fingerprint exposed';end if;
 if not has_function_privilege('authenticated','public.preview_client_project(uuid,uuid)','EXECUTE') then raise exception 'Authenticated preview access removed';end if;
end $$;
-- Reproduce hosted direct anon grants, then verify the corrective migration.
grant execute on function public.preview_client_project(uuid,uuid),public.planning_fingerprint(uuid) to anon;
grant execute on function public.planning_fingerprint(uuid) to authenticated;
-- Hosted Supabase can grant anon EXECUTE through default privileges.
-- Revoking PUBLIC alone does not remove those direct role grants.
revoke execute on function
 public.guard_connected_time(),
 public.guard_billed_expense(),
 public.guard_source_invoice(),
 public.create_work_invoice(uuid,uuid[],uuid[],date,uuid,boolean),
 public.bind_client_account(),
 public.guard_group_projects(),
 public.planning_fingerprint(uuid),
 public.shift_work_date(date,integer,integer[],date[]),
 public.preview_task_schedule(uuid,date,date),
 public.apply_task_schedule(uuid,date,date,text,uuid),
 public.save_task_allocations(uuid,jsonb,text),
 public.get_project_planning(uuid),
 public.guard_planning_change(),
 public.create_assistant_task(uuid,text,text,date,uuid),
 public.preview_client_project(uuid,uuid)
from public, anon;
revoke execute on function public.planning_fingerprint(uuid),
 public.shift_work_date(date,integer,integer[],date[]),
 public.guard_connected_time(),public.guard_billed_expense(),
 public.guard_source_invoice(),public.bind_client_account(),
 public.guard_group_projects(),public.guard_planning_change()
from authenticated;
notify pgrst, 'reload schema';
do $$begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('create_work_invoice','planning_fingerprint','shift_work_date','preview_task_schedule','apply_task_schedule','save_task_allocations','get_project_planning','create_assistant_task','preview_client_project') and has_function_privilege('anon',p.oid,'EXECUTE')) then
 raise exception 'Anonymous access remains on connected workflow functions';end if;
 if has_function_privilege('authenticated','public.planning_fingerprint(uuid)','EXECUTE') then raise exception 'Internal fingerprint exposed';end if;
 if not has_function_privilege('authenticated','public.preview_client_project(uuid,uuid)','EXECUTE') then raise exception 'Authenticated preview access removed';end if;
end $$;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',message;end if;end$$;
create function pg_temp.expect_error(command text, expected text) returns void language plpgsql as $$begin begin execute command;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;raise exception 'Expected error: %',expected;end$$;
insert into auth.users(id,email,raw_app_meta_data,aud,role) select ('ea000000-0000-4000-8000-00000000000'||n)::uuid,'workflow-'||n||'@example.invalid','{"pms_admin_provisioned":true}','authenticated','authenticated' from generate_series(1,4)n;
insert into workspaces(id,name) values('ea000000-0000-4000-8000-000000000010','Workflow fixture'),('ea000000-0000-4000-8000-000000000011','Other fixture');
insert into workspace_members(workspace_id,user_id,role,display_name) select 'ea000000-0000-4000-8000-000000000010',('ea000000-0000-4000-8000-00000000000'||n)::uuid,case n when 1 then 'owner' when 2 then 'member' else 'client' end,'Fixture '||n from generate_series(1,3)n;
insert into workspace_members values('ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000004','owner','Other admin');
select set_config('request.jwt.claims','{"sub":"ea000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
insert into projects(id,workspace_id,name,client_name,access_type,client_tools,holidays,type) values('ea000000-0000-4000-8000-000000000020','ea000000-0000-4000-8000-000000000010','Project','Client A','workspace',array['tasks','discussions','brief'],'{2026-10-12}','time_materials'),('ea000000-0000-4000-8000-000000000021','ea000000-0000-4000-8000-000000000010','Second','Client A','workspace','{}','{}','fixed_fee');
insert into project_members values('ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000020','ea000000-0000-4000-8000-000000000003','guest');
insert into tasks(id,workspace_id,project_id,title,start_date,due_date,estimated_minutes,assignee_id,is_published) values
('ea000000-0000-4000-8000-000000000030','ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000020','Published root','2026-10-09','2026-10-09',120,'ea000000-0000-4000-8000-000000000001',true),
('ea000000-0000-4000-8000-000000000031','ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000020','Private successor','2026-10-13','2026-10-13',120,'ea000000-0000-4000-8000-000000000001',false),
('ea000000-0000-4000-8000-000000000032','ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000021','Other project task','2026-10-09','2026-10-09',60,null,false);
insert into dependencies values('ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000031','ea000000-0000-4000-8000-000000000030');
set local role authenticated;
select pg_temp.assert_true((select count(distinct client_account_id)=1 from projects where workspace_id='ea000000-0000-4000-8000-000000000010'),'Exact client names share identity');
do $$declare view jsonb; plan jsonb;result jsonb;begin
 view:=preview_client_project('ea000000-0000-4000-8000-000000000020','ea000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(jsonb_array_length(view->'tasks')=1,'Client preview leaked private tasks');
 perform pg_temp.assert_true(auth.uid()='ea000000-0000-4000-8000-000000000001','Preview changed admin identity');
 plan:=preview_task_schedule('ea000000-0000-4000-8000-000000000030','2026-10-13','2026-10-13');
 perform pg_temp.assert_true((plan->>'workday_shift')::integer=1,'Holiday/weekend shift incorrect');
 perform pg_temp.assert_true(plan->>'can_apply'='true','Valid schedule rejected');
 update tasks set title='Changed root' where id='ea000000-0000-4000-8000-000000000030';
 perform pg_temp.expect_error(format('select apply_task_schedule(%L,%L,%L,%L,%L)','ea000000-0000-4000-8000-000000000030','2026-10-13','2026-10-13',plan->>'fingerprint','ea000000-0000-4000-8000-000000000050'),'plan changed');
 plan:=preview_task_schedule('ea000000-0000-4000-8000-000000000030','2026-10-13','2026-10-13');
 result:=apply_task_schedule('ea000000-0000-4000-8000-000000000030','2026-10-13','2026-10-13',plan->>'fingerprint','ea000000-0000-4000-8000-000000000050');
 perform pg_temp.assert_true((select due_date='2026-10-14' from tasks where id='ea000000-0000-4000-8000-000000000031'),'Successor date incorrect');
 result:=apply_task_schedule('ea000000-0000-4000-8000-000000000030','2026-10-13','2026-10-13',plan->>'fingerprint','ea000000-0000-4000-8000-000000000050');
 perform pg_temp.assert_true(result->>'duplicate'='true','Schedule retry not idempotent');
 plan:=get_project_planning('ea000000-0000-4000-8000-000000000020');
 perform pg_temp.expect_error(format('select save_task_allocations(%L,%L,%L)','ea000000-0000-4000-8000-000000000031','[{"date":"2026-10-14","minutes":60}]',plan->>'fingerprint'),'Daily minutes must equal');
 perform save_task_allocations('ea000000-0000-4000-8000-000000000031','[{"date":"2026-10-14","minutes":120}]',plan->>'fingerprint');
 perform pg_temp.expect_error('update tasks set due_date=''2026-10-15'' where id=''ea000000-0000-4000-8000-000000000031''','Clear daily allocations');
end $$;
insert into time_entries(id,workspace_id,project_id,task_id,description,minutes,bill_rate,cost_rate,billing_treatment) values('ea000000-0000-4000-8000-000000000040','ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000020','ea000000-0000-4000-8000-000000000030','Billable design',60,100,50,'invoice');
select pg_temp.expect_error('update time_entries set task_id=''ea000000-0000-4000-8000-000000000032'' where id=''ea000000-0000-4000-8000-000000000040''','same project');
update time_entries set status='Approved' where id='ea000000-0000-4000-8000-000000000040';
do $$declare invoice uuid;again uuid;begin
 invoice:=create_work_invoice('ea000000-0000-4000-8000-000000000020',array['ea000000-0000-4000-8000-000000000040'::uuid],'{}','2026-11-01','ea000000-0000-4000-8000-000000000060',true);
 again:=create_work_invoice('ea000000-0000-4000-8000-000000000020',array['ea000000-0000-4000-8000-000000000040'::uuid],'{}','2026-11-01','ea000000-0000-4000-8000-000000000060',true);
 perform pg_temp.assert_true(invoice=again,'Invoice retry duplicated invoice');
 perform pg_temp.expect_error('select create_work_invoice(''ea000000-0000-4000-8000-000000000020'',array[''ea000000-0000-4000-8000-000000000040''::uuid],''{}'',''2026-11-01'',''ea000000-0000-4000-8000-000000000061'',true)','already been invoiced');
 perform pg_temp.expect_error('update time_entries set minutes=90 where id=''ea000000-0000-4000-8000-000000000040''','Cancel the source invoice');
 perform pg_temp.expect_error(format('update invoices set lines=%L where id=%L','[{"description":"Changed","quantity":1,"rate":999}]',invoice),'snapshots');
 update invoices set status='Cancelled' where id=invoice;
 perform pg_temp.assert_true((select bool_and(released) from invoice_sources where invoice_id=invoice),'Cancelled draft did not release sources');
 again:=create_work_invoice('ea000000-0000-4000-8000-000000000020',array['ea000000-0000-4000-8000-000000000040'::uuid],'{}','2026-11-01','ea000000-0000-4000-8000-000000000061',true);
 perform pg_temp.assert_true(invoice<>again,'Replacement invoice not created');
end $$;
select set_config('request.jwt.claims','{"sub":"ea000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select pg_temp.expect_error('select preview_client_project(''ea000000-0000-4000-8000-000000000020'',''ea000000-0000-4000-8000-000000000003'')','Administrator access required');
select pg_temp.expect_error('select create_work_invoice(''ea000000-0000-4000-8000-000000000020'',''{}'',''{}'',''2026-11-01'',gen_random_uuid(),true)','Administrator access required');
select pg_temp.assert_true(not exists(select 1 from invoice_sources),'Member saw invoice sources');
select create_assistant_task('ea000000-0000-4000-8000-000000000020','Assistant draft','','2026-11-01','ea000000-0000-4000-8000-000000000070');
select pg_temp.assert_true((select not is_published from tasks where title='Assistant draft' and project_id='ea000000-0000-4000-8000-000000000020'),'Assistant task was published');
select set_config('request.jwt.claims','{"sub":"ea000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select pg_temp.assert_true((select count(*)=1 from tasks where project_id='ea000000-0000-4000-8000-000000000020'),'Client saw private assistant task');
select pg_temp.assert_true(not exists(select 1 from task_allocations),'Client saw internal allocations');
select pg_temp.expect_error('select create_assistant_task(''ea000000-0000-4000-8000-000000000020'',''Denied'','''',null,gen_random_uuid())','Active project access required');
select set_config('request.jwt.claims','{"sub":"ea000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
select pg_temp.assert_true(not exists(select 1 from projects where id='ea000000-0000-4000-8000-000000000020'),'Cross-workspace leak');
select pg_temp.expect_error('select get_project_planning(''ea000000-0000-4000-8000-000000000020'')','Project owner access required');
ROLLBACK;
\echo Connected workflow SQL checks passed; fixtures rolled back.
