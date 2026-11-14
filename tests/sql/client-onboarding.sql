insert into auth.users(id,email,raw_app_meta_data,encrypted_password,aud,role) values
('bc000000-0000-4000-8000-000000000001','owner-onboard@example.invalid','{"pms_admin_provisioned":true}','fixture','authenticated','authenticated'),
('bc000000-0000-4000-8000-000000000002','client-onboard@example.invalid','{"pms_admin_provisioned":true}','fixture','authenticated','authenticated'),
('bc000000-0000-4000-8000-000000000003','other-onboard@example.invalid','{"pms_admin_provisioned":true}','fixture','authenticated','authenticated');
insert into workspaces(id,name) values('bc000000-0000-4000-8000-000000000004','ROLLBACK ONLY onboarding');
insert into workspace_members(workspace_id,user_id,role,display_name) values
('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000001','owner','Owner'),
('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000002','client','Client'),
('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000003','client','Other');
insert into client_documents(id,workspace_id,client_id,kind,title,content,total_cents,created_by,status) values
('bc000000-0000-4000-8000-000000000005','bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000002','Contract','Fixture','{}',10001,'bc000000-0000-4000-8000-000000000001','Shared'),
('bc000000-0000-4000-8000-000000000006','bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000002','Contract','Draft fixture','{}',10000,'bc000000-0000-4000-8000-000000000001','Draft');
select set_config('request.jwt.claims','{"sub":"bc000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$begin if exists(select 1 from client_documents where workspace_id='bc000000-0000-4000-8000-000000000004') then raise exception 'Cross-client document leak';end if;
 begin perform decide_client_document('bc000000-0000-4000-8000-000000000005','Approved','Wrong person','');raise exception using errcode='XX001',message='Unauthorized approval';exception when sqlstate 'P0001' then null;end;
end$$;
reset role;
select set_config('request.jwt.claims','{"sub":"bc000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$declare a uuid;b uuid;begin
 if (select count(*) from client_documents where workspace_id='bc000000-0000-4000-8000-000000000004')<>1 then raise exception 'Client sees draft or misses shared document';end if;
 if (select deposit_cents from client_documents where id='bc000000-0000-4000-8000-000000000005')<>5001 then raise exception 'Deposit rounding';end if;
 begin update client_documents set total_cents=1 where id='bc000000-0000-4000-8000-000000000005';raise exception using errcode='XX001',message='Client changed price';exception when insufficient_privilege then null;end;
 begin perform decide_client_document('bc000000-0000-4000-8000-000000000005','Approved',null,'');raise exception using errcode='XX001',message='Null signer accepted';exception when sqlstate 'P0001' then null;end;
 perform decide_client_document('bc000000-0000-4000-8000-000000000005','Approved','Fixture Client','Accepted');
 begin perform decide_client_document('bc000000-0000-4000-8000-000000000005','Discussion','Fixture','Change');raise exception using errcode='XX001',message='Decision overwritten';exception when sqlstate 'P0001' then null;end;
 a:=submit_member_service_request('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000007','Fixture','Brief','Client','{"service_id":"prototype","answers":["a","b","c"],"contact_email":"client@example.com"}',null,null);
 b:=submit_member_service_request('bc000000-0000-4000-8000-000000000004','bc000000-0000-4000-8000-000000000007','Fixture','Brief','Client','{"service_id":"prototype","answers":["a","b","c"],"contact_email":"client@example.com"}',null,null);
 if a<>b then raise exception 'Duplicate submission';end if;
end$$;
reset role;
insert into projects(id,workspace_id,name,created_by) values('bc000000-0000-4000-8000-000000000008','bc000000-0000-4000-8000-000000000004','Deposit fixture','bc000000-0000-4000-8000-000000000001');
do $$begin
 if (select status from projects where id='bc000000-0000-4000-8000-000000000008')<>'Awaiting deposit' then raise exception 'New project started without payment';end if;
 begin update projects set status='In progress' where id='bc000000-0000-4000-8000-000000000008';raise exception using errcode='XX001',message='Unpaid project started';exception when sqlstate 'P0001' then null;end;
end$$;
update client_documents set project_id='bc000000-0000-4000-8000-000000000008' where id='bc000000-0000-4000-8000-000000000005';
insert into client_payments(document_id,workspace_id,provider,provider_id,amount_cents) values('bc000000-0000-4000-8000-000000000005','bc000000-0000-4000-8000-000000000004','Square','fixture-payment',5001);
update projects set status='In progress' where id='bc000000-0000-4000-8000-000000000008';
select 'PASS: client isolation, draft privacy, immutable prices, signer required, one decision, deposit rounding, request retry idempotency. All rolled back.' as result;
rollback;
