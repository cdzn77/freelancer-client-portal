-- Apply approved scope explicitly. Historic approval content remains immutable.
alter table budgets add column revision integer not null default 1;
create function budget_revision() returns trigger language plpgsql as $$begin new.revision:=old.revision+1;return new;end$$;
create trigger budget_revision before update on budgets for each row execute function budget_revision();
revoke all on function budget_revision() from public,anon,authenticated;
create table budget_scope_history(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
 project_id uuid not null references projects(id) on delete cascade,budget_id uuid references budgets(id) on delete set null,
 document_id uuid references client_documents(id) on delete set null,document_version integer not null,source_snapshot jsonb not null,
 subtotal_cents bigint not null,tax_cents bigint not null,reimbursable_cents bigint not null,service_cents bigint not null,
 treatment text not null check(treatment in('create','replace','add')),before_cents bigint not null,after_cents bigint not null,
 reason text not null check(length(trim(reason)) between 3 and 2000),created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table budget_scope_history enable row level security;
revoke all on budget_scope_history from anon,authenticated;
grant select on budget_scope_history to authenticated;
create policy budget_history_owner on budget_scope_history for select to authenticated using(pms_session_ready() and workspace_role(workspace_id)='owner');
create function preview_scope_budget(doc uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare d client_documents;b budgets;p projects;subtotal bigint;tax bigint;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or workspace_role(d.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 select * into p from projects where id=d.project_id;
 if p.id is null or p.archived_at is not null or p.deleted_at is not null or d.status<>'Approved' or d.kind not in('Estimate','Contract','Project agreement','Change order') then raise exception 'Choose an approved scope document on an active project';end if;
 if exists(select 1 from client_documents v join billing_sources vs on vs.document_id=v.id join billing_sources ds on ds.group_id=vs.group_id and ds.document_id=d.id where v.kind=d.kind and v.version>d.version and v.status='Approved') then raise exception 'Choose the approved revision';end if;
 if d.total_cents<>(billing_group_totals((select group_id from billing_sources where document_id=d.id))->>'total_cents')::bigint then raise exception 'Choose the current approved billing basis';end if;
 if jsonb_typeof(d.content->'items') is distinct from 'array' or jsonb_array_length(d.content->'items')=0 then raise exception 'The source needs a priced line-item breakdown';end if;
 select sum(round((x->>'quantity')::numeric*(x->>'unit_cents')::numeric))::bigint into subtotal from jsonb_array_elements(d.content->'items') x;
 tax:=round(subtotal*coalesce((d.content->>'tax_rate')::numeric,0)/100);
 if subtotal<=0 or tax<0 or subtotal+tax<>d.total_cents then raise exception 'The source breakdown does not match the approved total';end if;
 select * into b from budgets where project_id=p.id and workspace_id=p.workspace_id;
 if b.id is not null and (b.archived_at is not null or b.deleted_at is not null) then raise exception 'Restore the existing budget before applying scope';end if;
 return jsonb_build_object('document_id',d.id,'title',d.title,'version',d.version,'kind',d.kind,'project_id',p.id,'project_name',p.name,'scope',d.content->>'scope','items',d.content->'items','subtotal_cents',subtotal,'tax_cents',tax,'total_cents',d.total_cents,'budget_id',b.id,'budget_revision',coalesce(b.revision,0),'before_cents',coalesce(round(b.amount*100),0));
end$$;
create function apply_scope_budget(doc uuid,expected_revision integer,treatment text,reimbursable_cents bigint,reason text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$declare d client_documents;b budgets;v jsonb;service bigint;result uuid;begin
 select * into d from client_documents where id=doc;
 if not pms_session_ready() or d.id is null or workspace_role(d.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||d.workspace_id,0));
 perform 1 from projects where id=d.project_id for update;
 select * into b from budgets where project_id=d.project_id for update;
 v:=preview_scope_budget(doc);
 if expected_revision is distinct from (v->>'budget_revision')::integer then raise exception 'Budget changed. Preview again before applying';end if;
 if treatment not in('create','replace','add') or treatment is null or (b.id is null and treatment<>'create') or (b.id is not null and treatment='create') then raise exception 'Choose explicit treatment for the existing budget';end if;
 if treatment='add' and d.kind<>'Change order' then raise exception 'Only an approved change order can add to an existing budget';end if;
 if reimbursable_cents is null or reimbursable_cents<0 or reimbursable_cents>=(v->>'subtotal_cents')::bigint or length(trim(coalesce(reason,''))) not between 3 and 2000 then raise exception 'Provide the allocation and a reason. The service budget must be positive';end if;
 if exists(select 1 from budget_scope_history h where h.document_id=doc and h.budget_id=b.id) then raise exception 'This source was already applied to this budget. Use its approved revision for new scope';end if;
 service:=(v->>'subtotal_cents')::bigint-reimbursable_cents;
 if b.id is null then insert into budgets(workspace_id,project_id,amount) values(d.workspace_id,d.project_id,service::numeric/100) returning * into b;
 else update budgets set amount=(case when treatment='add' then (v->>'before_cents')::bigint else 0 end+service)::numeric/100 where id=b.id returning * into b;end if;
 insert into budget_scope_history(workspace_id,project_id,budget_id,document_id,document_version,source_snapshot,subtotal_cents,tax_cents,reimbursable_cents,service_cents,treatment,before_cents,after_cents,reason,created_by)
 values(d.workspace_id,d.project_id,b.id,d.id,d.version,to_jsonb(d),(v->>'subtotal_cents')::bigint,(v->>'tax_cents')::bigint,reimbursable_cents,service,treatment,(v->>'before_cents')::bigint,round(b.amount*100)::bigint,reason,auth.uid()) returning id into result;
 insert into audit_log(workspace_id,action,entity) values(d.workspace_id,'approved_scope_budget_applied',result::text);return result;
end$$;
revoke all on function preview_scope_budget(uuid),apply_scope_budget(uuid,integer,text,bigint,text) from public,anon,authenticated;
grant execute on function preview_scope_budget(uuid),apply_scope_budget(uuid,integer,text,bigint,text) to authenticated;
notify pgrst,'reload schema';
