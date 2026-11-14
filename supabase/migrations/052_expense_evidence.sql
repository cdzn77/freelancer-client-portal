-- Optional expense evidence. Existing amounts and client file visibility stay unchanged.
alter table project_expenses add column task_id uuid references tasks(id) on delete set null;
alter table project_expenses add column receipt_file_id uuid references project_files(id) on delete set null;
create table project_file_deletions(file_id uuid primary key references project_files(id) on delete cascade,workspace_id uuid not null references workspaces(id) on delete cascade);
alter table project_file_deletions enable row level security;
revoke all on project_file_deletions from public,anon,authenticated;
create function guard_expense_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if new.task_id is not null and not exists(select 1 from tasks where id=new.task_id and project_id=new.project_id and workspace_id=new.workspace_id) then raise exception 'Choose a task in the expense project';end if;
 if new.receipt_file_id is not null then
 perform 1 from project_files where id=new.receipt_file_id and project_id=new.project_id and workspace_id=new.workspace_id for key share;
 if not found or exists(select 1 from project_file_deletions where file_id=new.receipt_file_id) then raise exception 'Choose an available receipt file in the expense project';end if;
 end if;return new;
end$$;
create trigger expense_evidence before insert or update on project_expenses for each row execute function guard_expense_evidence();
create function capture_expense_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare e project_expenses;f project_files;begin
 if new.expense_id is null then return new;end if;
 select * into e from project_expenses where id=new.expense_id;
 if e.receipt_file_id is not null then
 select * into f from project_files where id=e.receipt_file_id for key share;
 if f.id is null or exists(select 1 from project_file_deletions where file_id=f.id) then raise exception 'Receipt deletion is in progress; review the expense before invoicing';end if;
 new.snapshot:=new.snapshot||jsonb_build_object('receipt_evidence',jsonb_build_object('id',f.id,'name',f.name,'path',f.path,'provider',f.provider));
 end if;
 if e.task_id is not null then new.snapshot:=new.snapshot||jsonb_build_object('task_evidence',(select jsonb_build_object('id',id,'title',title) from tasks where id=e.task_id));end if;
 return new;
end$$;
create trigger capture_invoice_expense_evidence before insert on invoice_sources for each row execute function capture_expense_evidence();
create index invoice_receipt_evidence on invoice_sources((snapshot->'receipt_evidence'->>'id')) where expense_id is not null;
create or replace function is_reviewed_file(object_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from project_files f where f.path=object_path and(exists(select 1 from project_expenses where receipt_file_id=f.id) or exists(select 1 from deliverable_versions where file_id=f.id) or exists(select 1 from invoice_sources s where s.expense_id is not null and s.snapshot->'receipt_evidence'->>'id'=f.id::text)));
$$;
create function preserve_expense_file() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if (exists(select 1 from project_expenses where receipt_file_id=old.id) or exists(select 1 from invoice_sources where expense_id is not null and snapshot->'receipt_evidence'->>'id'=old.id::text)) and(tg_op='DELETE' or (new.path,new.provider,new.project_id,new.workspace_id,new.name) is distinct from(old.path,old.provider,old.project_id,old.workspace_id,old.name)) then raise exception 'Receipt is linked to an expense or invoice. Unlink unbilled receipts first; preserve invoiced evidence';end if;return coalesce(new,old);
end$$;
create trigger preserve_expense_file before update or delete on project_files for each row execute function preserve_expense_file();
create function prepare_project_file_delete(file_path text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare f project_files;begin
 select * into f from project_files where path=file_path for update;
 if not pms_session_ready() or f.id is null or not(project_manager(f.workspace_id,f.project_id) or(project_staff(f.workspace_id,f.project_id) and f.created_by=auth.uid())) then raise exception 'Only the uploader or a project owner can delete this file';end if;
 if is_reviewed_file(file_path) then raise exception 'This file is retained as review or invoice evidence. Upload a new file instead';end if;
 insert into project_file_deletions values(f.id,f.workspace_id) on conflict do nothing;
end$$;
-- Prevent a review from attaching a file after deletion has been reserved.
create function guard_pending_review_file() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 perform 1 from project_files where id=new.file_id for key share;
 if exists(select 1 from project_file_deletions where file_id=new.file_id) then raise exception 'File deletion is in progress';end if;return new;
end$$;
create trigger pending_review_file before insert on deliverable_versions for each row execute function guard_pending_review_file();
revoke all on function guard_expense_evidence(),capture_expense_evidence(),preserve_expense_file(),prepare_project_file_delete(text),guard_pending_review_file() from public,anon,authenticated;
grant execute on function prepare_project_file_delete(text) to authenticated;
