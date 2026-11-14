-- Run after migrations 036-038 in a transaction, then ROLLBACK.
insert into auth.users(id,email,raw_app_meta_data,aud,role)
 select ('da000000-0000-4000-8000-00000000000'||n)::uuid,'release-fixture-'||n||'@example.invalid','{"pms_admin_provisioned":true}'::jsonb,'authenticated','authenticated' from generate_series(1,5)n;
insert into public.workspaces(id,name) values('da000000-0000-4000-8000-000000000010','ROLLBACK ONLY release checks');
insert into public.workspace_members(workspace_id,user_id,role,display_name)
 select 'da000000-0000-4000-8000-000000000010',('da000000-0000-4000-8000-00000000000'||n)::uuid,case n when 1 then 'owner' when 2 then 'member' when 3 then 'contractor' else 'client' end,'Test person '||n from generate_series(1,4)n;
insert into storage.objects(bucket_id,name) values ('profile-photos','da000000-0000-4000-8000-000000000001/avatar.jpg');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
insert into public.team_schedule_days values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000002','2026-10-01',480);
insert into public.team_capacity values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000002',480,array[1,2,3,4,5]);
insert into public.team_time_off(workspace_id,user_id,starts_on,ends_on) values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000002','2026-10-02','2026-10-02');
insert into storage.objects(bucket_id,name) values('profile-photos','da000000-0000-4000-8000-000000000002/avatar.jpg');
do $$begin
 if (select count(*) from storage.objects where bucket_id='profile-photos' and name like 'da000000-%')<>2 then raise exception 'Peer avatar read failed';end if;
 begin insert into public.team_schedule_days values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000001','2026-10-01',480);raise exception 'Cross-person write allowed';exception when insufficient_privilege then null;end;
 begin insert into public.team_schedule_status(workspace_id,user_id,status,starts_on) values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000002','paused','2026-10-01');raise exception 'Member roster write allowed';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name) values('profile-photos','da000000-0000-4000-8000-000000000003/avatar.jpg');raise exception 'Cross-user avatar write allowed';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
insert into public.team_schedule_days values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000003','2026-10-01',240);
do $$begin if (select count(*) from public.team_schedule_days where workspace_id='da000000-0000-4000-8000-000000000010')<>1 then raise exception 'Self visibility failed';end if;end$$;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
insert into public.team_schedule_status(workspace_id,user_id,status,starts_on) values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000002','paused','2026-10-01');
do $$begin if (select count(*) from public.team_schedule_days where workspace_id='da000000-0000-4000-8000-000000000010')<>2 then raise exception 'Owner schedule read failed';end if;end$$;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
do $$begin
 if exists(select 1 from public.team_schedule_days where workspace_id='da000000-0000-4000-8000-000000000010') then raise exception 'Client saw schedule';end if;
 begin insert into public.team_schedule_days values('da000000-0000-4000-8000-000000000010','da000000-0000-4000-8000-000000000004','2026-10-01',480);raise exception 'Client schedule write allowed';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
do $$begin
 if exists(select 1 from storage.objects where bucket_id='profile-photos' and name like 'da000000-%') then raise exception 'Outsider avatar visibility';end if;
 if exists(select 1 from public.team_schedule_status where workspace_id='da000000-0000-4000-8000-000000000010') then raise exception 'Outsider schedule visibility';end if;
end$$;
reset role;
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"pms_password_change_required":true}' where id='da000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.team_schedule_days where workspace_id='da000000-0000-4000-8000-000000000010') then raise exception 'Password gate schedule bypass';end if;
 if exists(select 1 from storage.objects where bucket_id='profile-photos' and name like 'da000000-%') then raise exception 'Password gate avatar bypass';end if;
end$$;
reset role;
select 'PASS: self-service, owner controls, peer photos, client/outsider isolation, cross-user write rejection, and password gate. All fixtures rolled back.' as result;
