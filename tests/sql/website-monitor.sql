begin;
do $$
declare w uuid; ok boolean;
begin
 select id into w from workspaces limit 1;
 if w is null then raise exception 'Seed a workspace first'; end if;
 if has_function_privilege('authenticated','public.claim_monitor_refresh(uuid,text)','EXECUTE') then raise exception 'Refresh lease exposed to users'; end if;
 if has_function_privilege('anon','public.claim_monitor_refresh(uuid,text)','EXECUTE') then raise exception 'Refresh lease exposed anonymously'; end if;
 if has_table_privilege('authenticated','public.website_monitor_connections','SELECT') or has_table_privilege('anon','public.website_monitor_connections','SELECT') then raise exception 'Provider secrets exposed';end if;
 ok:=claim_monitor_refresh(w,'test-monitor-lease');
 if not ok then raise exception 'First refresh should acquire lease';end if;
 ok:=claim_monitor_refresh(w,'test-monitor-lease');
 if ok then raise exception 'Overlapping refresh should be blocked';end if;
 update monitor_refresh_locks set next_at=now()-interval '1 second' where workspace_id=w and report_key='test-monitor-lease';
 if not claim_monitor_refresh(w,'test-monitor-lease') then raise exception 'Expired lease should renew';end if;
end $$;
rollback;
