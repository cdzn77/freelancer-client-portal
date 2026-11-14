-- Permanent deletion is an explicit, administrator-only operation on trashed rows.
-- Blob deletion is a durable outbox: a storage failure never loses the cleanup path.
create table trash_file_cleanup (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
 provider text not null check(provider in ('supabase','minio','r2')), path text not null,
 created_at timestamptz not null default now(), unique(provider,path)
);
alter table trash_file_cleanup enable row level security;
revoke all on trash_file_cleanup from anon,authenticated;
grant all on trash_file_cleanup to service_role;

create function public.purge_trash(w uuid, kind text, item_ids uuid[]) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare tab text; ids uuid[]; related uuid[]; extra uuid[]; pids uuid[]; dids uuid[]; vids uuid[]; t text; n integer;
begin
 if workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 -- Serializes purge requests without changing other workspaces.
 perform 1 from workspaces where id=w for update;
 tab:=case kind when 'project' then 'projects' when 'budget' then 'budgets' when 'blueprint' then 'studio_blueprints' when 'request' then 'work_requests' when 'notification' then 'studio_notifications' when 'deliverable' then 'deliverables' end;
 if tab is null or coalesce(cardinality(item_ids),0)=0 or cardinality(item_ids)>5000 then raise exception 'Choose items in Trash';end if;
 select array_agg(distinct x) into ids from unnest(item_ids)x;
 execute format('select array_agg(id) from (select id from %I where workspace_id=$1 and id=any($2) and deleted_at is not null for update) s',tab) into extra using w,ids;
 if coalesce(cardinality(extra),0)<>cardinality(ids) then raise exception 'Selection changed. Refresh Trash and select again';end if;
 if kind='notification' and exists(select 1 from studio_notifications where id=any(ids) and user_id<>auth.uid()) then raise exception 'Select notifications from your own inbox';end if;
 related:=ids;n:=cardinality(ids);
 if kind='project' then
   pids:=ids;
   -- Collect all project-linked row identities for removing audit and notification references.
   foreach t in array array['tasks','time_entries','budgets','estimates','invoices','retainers','comments','approvals','project_files','blueprint_applications','work_requests','deliverables','deliverable_versions','review_feedback','review_stages','task_recurrences','scope_changes','project_expenses','resource_bookings','studio_notifications'] loop
     execute format('select coalesce(array_agg(id),''{}''::uuid[]) from %I where workspace_id=$1 and project_id=any($2)',t) into extra using w,pids;
     related:=related||extra;
   end loop;
   select coalesce(array_agg(id),'{}'::uuid[]) into extra from invoice_receipts where workspace_id=w and invoice_id=any(related);related:=related||extra;
   select coalesce(array_agg(id),'{}'::uuid[]) into dids from deliverables where workspace_id=w and project_id=any(pids);
 elsif kind='deliverable' then dids:=ids;
 end if;
 if dids is not null then
   select coalesce(array_agg(id),'{}'::uuid[]) into vids from deliverable_versions where workspace_id=w and deliverable_id=any(dids);
   related:=related||vids;
   select coalesce(array_agg(id),'{}'::uuid[]) into extra from review_feedback where workspace_id=w and version_id=any(vids);related:=related||extra;
   select coalesce(array_agg(id),'{}'::uuid[]) into extra from review_stages where workspace_id=w and version_id=any(vids);related:=related||extra;
   update deliverables set current_version_id=null where workspace_id=w and id=any(dids);
   delete from review_stages where workspace_id=w and version_id=any(vids);
   delete from review_feedback where workspace_id=w and version_id=any(vids);
   delete from deliverable_versions where workspace_id=w and id=any(vids);
   delete from deliverables where workspace_id=w and id=any(dids);
 end if;
 if kind='project' then
   insert into trash_file_cleanup(workspace_id,provider,path) select workspace_id,provider,path from project_files where workspace_id=w and project_id=any(pids) on conflict do nothing;
   delete from scope_changes where workspace_id=w and project_id=any(pids);
   delete from invoice_receipts where workspace_id=w and invoice_id=any(related);
   select coalesce(array_agg(id),'{}'::uuid[]) into extra from monitor_records where workspace_id=w and (linked_project_id=any(pids) or linked_task_id=any(related));related:=related||extra;
   delete from monitor_records where workspace_id=w and (linked_project_id=any(pids) or linked_task_id=any(related));
   delete from saved_task_views where workspace_id=w and (scope=any(select x::text from unnest(pids)x) or exists(select 1 from unnest(pids)x where position(x::text in filters::text)>0 or position(x::text in scope)>0));
   update tasks set parent_task_id=null where workspace_id=w and project_id=any(pids) and parent_task_id is not null;
   foreach t in array array['studio_notifications','work_requests','blueprint_applications','task_recurrences','resource_bookings','project_expenses','time_entries','budgets','budget_alerts','invoices','estimates','retainers','tasks','comments','approvals','project_files'] loop
     execute format('delete from %I where workspace_id=$1 and project_id=any($2)',t) using w,pids;
   end loop;
 elsif kind='blueprint' then
   select coalesce(array_agg(id),'{}'::uuid[]) into extra from blueprint_applications where workspace_id=w and blueprint_id=any(ids);related:=related||extra;
   delete from blueprint_applications where workspace_id=w and blueprint_id=any(ids);
 elsif kind='budget' then
   delete from budget_alerts where workspace_id=w and project_id in(select project_id from budgets where workspace_id=w and id=any(ids));
 end if;
 if kind<>'deliverable' then execute format('delete from %I where workspace_id=$1 and id=any($2)',tab) using w,ids;end if;
 -- Event keys and audit entities contain colon-separated UUIDs, not free-form names.
 delete from studio_notifications s where s.workspace_id=w and exists(select 1 from unnest(related)x where x::text=any(string_to_array(s.event_key,':')));
 delete from audit_log a where a.workspace_id=w and exists(select 1 from unnest(related)x where x::text=any(string_to_array(a.entity,':')));
 return n;
end $$;
revoke all on function public.purge_trash(uuid,text,uuid[]) from public;
grant execute on function public.purge_trash(uuid,text,uuid[]) to authenticated;
