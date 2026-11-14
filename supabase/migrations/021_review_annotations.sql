alter table review_feedback add column annotation jsonb, add column resolved_at timestamptz, add column resolved_by uuid references auth.users(id);
create function public.valid_review_annotation(a jsonb) returns boolean language sql immutable as $$
 select a is null or coalesce(jsonb_typeof(a)='object' and
 case a->>'type'
 when 'image' then jsonb_typeof(a->'x')='number' and jsonb_typeof(a->'y')='number' and (a->>'x')::numeric between 0 and 1 and (a->>'y')::numeric between 0 and 1
 when 'pdf' then jsonb_typeof(a->'page')='number' and (a->>'page')::numeric between 1 and 10000 and (a->>'page')::numeric=trunc((a->>'page')::numeric)
 else false end,false)
$$;
alter table review_feedback add constraint valid_annotation check(valid_review_annotation(annotation));
create function public.resolve_review_feedback(feedback uuid, resolved boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f review_feedback; d deliverables;begin
 select * into f from review_feedback where id=feedback for update;
 if not found then raise exception 'Feedback not found';end if;
 select x.* into d from deliverables x join deliverable_versions v on v.deliverable_id=x.id where v.id=f.version_id for share of x;
 if not project_manager(f.workspace_id,f.project_id) then raise exception 'Project owner access required';end if;
 if d.archived_at is not null or d.deleted_at is not null then raise exception 'Restore the deliverable first';end if;
 update review_feedback set resolved_at=case when resolved then now() else null end,resolved_by=case when resolved then auth.uid() else null end where id=f.id;
end $$;
revoke all on function public.resolve_review_feedback(uuid,boolean) from public;
grant execute on function public.resolve_review_feedback(uuid,boolean) to authenticated;
-- Resolution is an owner action; insert callers cannot forge completed feedback.
create function public.guard_feedback_resolution() returns trigger language plpgsql as $$begin
 if new.resolved_at is not null or new.resolved_by is not null then raise exception 'New feedback starts unresolved';end if;return new;end $$;
create trigger feedback_starts_unresolved before insert on review_feedback for each row execute function guard_feedback_resolution();
