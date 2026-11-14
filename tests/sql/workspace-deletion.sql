\set ON_ERROR_STOP on
begin;
do $$
declare u uuid; w uuid:=gen_random_uuid(); empty_w uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); denied boolean;
begin
 select id into u from auth.users limit 1;if u is null then raise exception 'Local test user required';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into workspaces(id,name) values(w,'Delete fixture'),(empty_w,'Empty fixture'),(other,'Keep fixture');
 insert into workspace_members(workspace_id,user_id,role,display_name) values(w,u,'owner','Test admin'),(empty_w,u,'owner','Test admin');
 insert into projects(id,workspace_id,name) values(p,w,'Project fixture');
 insert into tasks(workspace_id,project_id,title) values(w,p,'Task fixture');
 insert into project_files(workspace_id,project_id,path,name) values(w,p,w::text||'/'||p::text||'/test.txt','test.txt');
 insert into work_requests(workspace_id,title,kind,brief) values(w,'Standalone request','Other','Fixture');
 insert into studio_blueprints(workspace_id,name,steps) values(w,'Blueprint','[{"title":"Task"}]');
 insert into google_email_connections(workspace_id,sender,encrypted_refresh_token,connected_by) values(w,'test@example.invalid','fake-test-token',u);
 insert into intake_links(workspace_id,title) values(w,'Fixture form');
 denied:=false;begin perform delete_workspace(w,'wrong name');exception when others then denied:=true;end;
 if not denied or not exists(select 1 from projects where id=p) then raise exception 'Confirmation mismatch changed records';end if;
 denied:=false;begin perform delete_workspace(other,'Keep fixture');exception when others then denied:=true;end;
 if not denied then raise exception 'Unauthorized workspace deletion allowed';end if;
 update workspace_members set role='member' where workspace_id=w;
 denied:=false;begin perform delete_workspace(w,'Delete fixture');exception when others then denied:=true;end;
 if not denied then raise exception 'Non-admin deletion allowed';end if;
 update workspace_members set role='owner' where workspace_id=w;
 perform delete_workspace(w,'Delete fixture');
 if exists(select 1 from workspaces where id=w) or exists(select 1 from projects where workspace_id=w) or exists(select 1 from workspace_members where workspace_id=w) or exists(select 1 from google_email_connections where workspace_id=w) or exists(select 1 from intake_links where workspace_id=w) then raise exception 'Workspace-owned data retained';end if;
 if not exists(select 1 from trash_file_cleanup where workspace_id=w) then raise exception 'File cleanup job lost with workspace';end if;
 if not exists(select 1 from workspaces where id=other) or not exists(select 1 from auth.users where id=u) then raise exception 'Other workspace or sign-in account deleted';end if;
 perform delete_workspace(empty_w,'Empty fixture');
 if exists(select 1 from workspaces where id=empty_w) then raise exception 'Empty workspace deletion failed';end if;
 raise notice 'PASS: populated/empty workspace deletion, exact confirmation, admin and tenant checks, retained account/other workspace, durable file cleanup';
end $$;
rollback;
