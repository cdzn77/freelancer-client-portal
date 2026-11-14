-- Existing, explicitly confirmed Trash/workspace deletion must include new records.
-- Normal task/time/invoice deletion continues to protect billed history.
do $$declare definition text;begin
 select pg_get_functiondef('public.purge_trash(uuid,text,uuid[])'::regprocedure) into definition;
 if position('pids:=ids;' in definition)=0 then raise exception 'Review updated purge function before applying workflow lifecycle migration';end if;
 definition:=replace(definition,'pids:=ids;', $patch$pids:=ids;
   delete from invoice_sources where workspace_id=w and invoice_id in(select id from invoices where workspace_id=w and project_id=any(pids));
   delete from workflow_requests where workspace_id=w and (result_id in(select id from tasks where workspace_id=w and project_id=any(pids)) or result_id in(select id from invoices where workspace_id=w and project_id=any(pids)));
   update project_groups set project_ids=array(select x from unnest(project_ids)x where not(x=any(pids))) where workspace_id=w;
$patch$);
 execute definition;
end $$;
alter table client_accounts drop constraint client_accounts_workspace_id_fkey;
alter table client_accounts add foreign key(workspace_id) references workspaces(id) on delete cascade;
alter table project_groups drop constraint project_groups_workspace_id_fkey;
alter table project_groups add foreign key(workspace_id) references workspaces(id) on delete cascade;
alter table workflow_requests drop constraint workflow_requests_workspace_id_fkey;
alter table workflow_requests add foreign key(workspace_id) references workspaces(id) on delete cascade;
