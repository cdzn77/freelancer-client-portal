-- File cleanup must survive removal of the owning workspace.
alter table trash_file_cleanup drop constraint trash_file_cleanup_workspace_id_fkey;
create function public.delete_workspace(w uuid, confirmed_name text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare workspace_name text; pids uuid[]; t text;
begin
 select name into workspace_name from workspaces where id=w for update;
 if workspace_name is null or workspace_role(w) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if confirmed_name is null or confirmed_name<>workspace_name then raise exception 'Type the exact workspace name to confirm';end if;
 -- Reuse the tested project graph purge, including durable file cleanup.
 loop
   select array_agg(id) into pids from (select id from projects where workspace_id=w order by id limit 5000) p;
   exit when pids is null;
   update projects set deleted_at=now() where workspace_id=w and id=any(pids);
   perform purge_trash(w,'project',pids);
 end loop;
 foreach t in array array['studio_email_jobs','studio_notifications','google_email_connections','email_preferences','work_requests','blueprint_applications','studio_blueprints','intake_links','saved_task_views','task_field_definitions','team_time_off','team_capacity','studio_ai_usage','monitor_records','templates','clients','users','estimate_lines','invoice_lines','expenses','assets','proof_comments','proofs','forms','dashboards','report_defs','audit_log'] loop
   execute format('delete from %I where workspace_id=$1',t) using w;
 end loop;
 delete from workspace_members where workspace_id=w;
 delete from workspaces where id=w;
end $$;
revoke all on function public.delete_workspace(uuid,text) from public;
grant execute on function public.delete_workspace(uuid,text) to authenticated;
