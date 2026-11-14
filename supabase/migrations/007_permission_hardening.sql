drop policy dependencies_write on dependencies;
create policy dependencies_write on dependencies for all to authenticated using(exists(select 1 from tasks a join tasks b on b.id=depends_on_id and b.workspace_id=a.workspace_id where a.id=task_id and a.workspace_id=dependencies.workspace_id and public.project_staff(a.workspace_id,a.project_id) and public.project_staff(b.workspace_id,b.project_id))) with check(exists(select 1 from tasks a join tasks b on b.id=depends_on_id and b.workspace_id=a.workspace_id where a.id=task_id and a.workspace_id=dependencies.workspace_id and public.project_staff(a.workspace_id,a.project_id) and public.project_staff(b.workspace_id,b.project_id)));
drop policy file_read on storage.objects;
create policy file_read on storage.objects for select to authenticated using(bucket_id='project-files' and (public.workspace_role((storage.foldername(name))[1]::uuid)='owner' or exists(select 1 from project_files f where f.path=storage.objects.name)));
-- A member's changes to shared tasks return them to internal review.
create or replace function public.guard_publishing() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.project_id<>old.project_id) then raise exception 'Content cannot be moved between projects';end if;
if (tg_op='INSERT' and new.is_published) or (tg_op='UPDATE' and new.is_published is distinct from old.is_published) then
if not public.project_manager(new.workspace_id,new.project_id) and not (tg_table_name='comments' and tg_op='INSERT' and public.project_guest(new.workspace_id,new.project_id,'discussions')) and auth.role()<>'service_role' then raise exception 'Only project owners can publish content';end if;end if;
if tg_op='UPDATE' and tg_table_name='tasks' and not public.project_manager(new.workspace_id,new.project_id) and auth.role()='authenticated' then new.is_published=false;end if;
return new;end $$;
