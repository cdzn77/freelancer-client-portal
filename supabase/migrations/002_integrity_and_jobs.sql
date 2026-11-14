-- Private storage paths always begin with the workspace UUID.
insert into storage.buckets(id,name,public) values('project-files','project-files',false) on conflict do nothing;
create policy file_read on storage.objects for select to authenticated using(bucket_id='project-files' and public.workspace_role((storage.foldername(name))[1]::uuid) is not null);
create policy file_insert on storage.objects for insert to authenticated with check(bucket_id='project-files' and public.workspace_role((storage.foldername(name))[1]::uuid) in ('owner','member'));
create policy file_delete on storage.objects for delete to authenticated using(bucket_id='project-files' and public.workspace_role((storage.foldername(name))[1]::uuid) in ('owner','member'));
create table budget_alerts(workspace_id uuid not null references workspaces(id),project_id uuid not null,period date not null default current_date,claimed boolean not null default false,primary key(workspace_id,project_id,period),foreign key(workspace_id,project_id) references projects(workspace_id,id));
alter table budget_alerts enable row level security;
create policy alert_read on budget_alerts for select to authenticated using(public.workspace_role(workspace_id) in ('owner','member'));
create function public.queue_budget_alerts() returns void language sql security definer set search_path=public as $$ insert into budget_alerts(workspace_id,project_id) select b.workspace_id,b.project_id from budgets b join time_entries t on t.project_id=b.project_id and t.workspace_id=b.workspace_id where t.billable group by b.workspace_id,b.project_id,b.amount having sum(t.minutes/60.0*t.bill_rate)>=b.amount*0.8 on conflict do nothing $$;
revoke all on function public.queue_budget_alerts() from public;
select cron.schedule('portal-budget-alerts','*/15 * * * *','select public.queue_budget_alerts()');
create function public.claim_budget_alerts(w uuid) returns table(name text,burn numeric,amount numeric) language plpgsql security definer set search_path=public as $$ begin if public.workspace_role(w) not in ('owner','member') or public.workspace_role(w) is null then raise exception 'Not authorized'; end if;return query with claimed as(update budget_alerts set claimed=true where workspace_id=w and not claimed returning project_id) select p.name,sum(t.minutes/60.0*t.bill_rate),b.amount from claimed c join projects p on p.id=c.project_id and p.workspace_id=w join budgets b on b.project_id=p.id and b.workspace_id=w join time_entries t on t.project_id=p.id and t.workspace_id=w and t.billable group by p.name,b.amount;end $$;
revoke all on function public.claim_budget_alerts(uuid) from public;
grant execute on function public.claim_budget_alerts(uuid) to authenticated;
-- Audit privileged edits without exposing other tenants.
create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into audit_log(workspace_id,action,entity) values(coalesce(new.workspace_id,old.workspace_id),tg_op,tg_table_name||':'||coalesce(new.id,old.id)::text);return coalesce(new,old);end $$;
create trigger audit_tasks after insert or update or delete on tasks for each row execute function audit_change();
create trigger audit_projects after insert or update or delete on projects for each row execute function audit_change();
create trigger audit_invoices after insert or update or delete on invoices for each row execute function audit_change();
create function public.validate_financial_lines() returns trigger language plpgsql set search_path=public as $$ declare line jsonb; begin if jsonb_typeof(new.lines)<>'array' or jsonb_array_length(new.lines)=0 then raise exception 'Add at least one line item'; end if;for line in select * from jsonb_array_elements(new.lines) loop if not(line ? 'description' and line ? 'quantity' and line ? 'rate') or length(line->>'description')=0 or (line->>'quantity')::numeric<=0 or (line->>'rate')::numeric<0 then raise exception 'Line items need a description, positive quantity, and nonnegative rate'; end if;end loop;return new;end $$;
create trigger invoice_lines_valid before insert or update on invoices for each row execute function validate_financial_lines();
create trigger estimate_lines_valid before insert or update on estimates for each row execute function validate_financial_lines();
