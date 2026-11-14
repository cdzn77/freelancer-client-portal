-- Staff revisions to shared messages return to review; guests can revise their own shared replies.
create or replace function public.guard_publishing() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.project_id<>old.project_id) then raise exception 'Content cannot be moved between projects';end if;
if (tg_op='INSERT' and new.is_published) or (tg_op='UPDATE' and new.is_published is distinct from old.is_published) then
if not public.project_manager(new.workspace_id,new.project_id) and not (tg_table_name='comments' and tg_op='INSERT' and public.project_guest(new.workspace_id,new.project_id,'discussions')) and auth.role()<>'service_role' then raise exception 'Only project owners can publish content';end if;end if;
if tg_op='UPDATE' and auth.role()='authenticated' and not public.project_manager(new.workspace_id,new.project_id) then
 if tg_table_name='tasks' or (tg_table_name='comments' and public.project_staff(new.workspace_id,new.project_id)) then new.is_published=false;end if;
end if;
return new;end $$;
