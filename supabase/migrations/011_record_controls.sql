-- Ownership, review state and tenant boundaries stay enforced below the UI.
drop policy time_edit on time_entries;
create policy time_edit on time_entries for update to authenticated using(public.workspace_role(workspace_id)='owner' or (created_by=auth.uid() and status='Submitted' and public.project_staff(workspace_id,project_id))) with check(public.workspace_role(workspace_id)='owner' or (created_by=auth.uid() and status='Submitted' and public.project_staff(workspace_id,project_id)));
create policy time_delete on time_entries for delete to authenticated using(public.workspace_role(workspace_id)='owner');
create function public.guard_record_identity() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if new.workspace_id<>old.workspace_id or new.created_by<>old.created_by then raise exception 'Record ownership cannot be changed';end if;
if tg_table_name='time_entries' then if (new.description,new.minutes,new.project_id,new.entry_date,new.billable,new.cost_rate,new.bill_rate) is distinct from (old.description,old.minutes,old.project_id,old.entry_date,old.billable,old.cost_rate,old.bill_rate) then new.status='Submitted';end if;end if;
return new;end $$;
create trigger time_identity before update on time_entries for each row execute function guard_record_identity();
create trigger comment_identity before update on comments for each row execute function guard_record_identity();
drop policy comments_edit on comments;
create policy comments_edit on comments for update to authenticated using(public.project_manager(workspace_id,project_id) or (created_by=auth.uid() and (public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'discussions'))))) with check(public.project_manager(workspace_id,project_id) or (created_by=auth.uid() and (public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'discussions')))));
create policy comments_delete on comments for delete to authenticated using(public.project_manager(workspace_id,project_id) or (created_by=auth.uid() and (public.project_staff(workspace_id,project_id) or (is_published and public.project_guest(workspace_id,project_id,'discussions')))));
alter table comments add column mentions uuid[] not null default '{}';
alter table comments add column edited_at timestamptz;
create function public.validate_comment_mentions() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
if cardinality(new.mentions)>30 or exists(select 1 from unnest(new.mentions) u where not exists(select 1 from workspace_members m where m.workspace_id=new.workspace_id and m.user_id=u and (m.role='owner' or exists(select 1 from project_members pm where pm.workspace_id=new.workspace_id and pm.project_id=new.project_id and pm.user_id=u) or (m.role in ('member','contractor') and exists(select 1 from projects p where p.id=new.project_id and p.access_type='workspace'))))) then raise exception 'Mention only people with access to this project';end if;
if tg_op='UPDATE' then new.edited_at=now();end if;
return new;end $$;
create trigger comment_mentions before insert or update on comments for each row execute function validate_comment_mentions();
create function public.keep_subtasks() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin update tasks set parent_task_id=null where workspace_id=old.workspace_id and project_id=old.project_id and parent_task_id=old.id;return old;end $$;
create trigger task_delete_subtasks before delete on tasks for each row execute function keep_subtasks();
create policy files_delete on project_files for delete to authenticated using(public.project_manager(workspace_id,project_id) or (created_by=auth.uid() and public.project_staff(workspace_id,project_id)));
drop policy file_delete on storage.objects;
create policy file_delete on storage.objects for delete to authenticated using(bucket_id='project-files' and exists(select 1 from project_files f where f.path=storage.objects.name and (public.project_manager(f.workspace_id,f.project_id) or (f.created_by=auth.uid() and public.project_staff(f.workspace_id,f.project_id)))));
