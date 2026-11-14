-- Local/hosted Supabase defaults can grant table privileges automatically.
revoke all on google_email_connections from public,anon,authenticated;
grant select(workspace_id,sender,connected_at) on google_email_connections to authenticated;

create or replace function public.submit_public_intake(link_token text,fingerprint text,title text,brief text,client_name text,email text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare link intake_links;n integer;result uuid;begin
 select * into link from intake_links where token=link_token for update;
 if not found or not link.enabled or link.expires_on<current_date then raise exception 'This intake form is unavailable';end if;
 if not exists(select 1 from workspace_members where workspace_id=link.workspace_id and user_id=link.created_by and role='owner') then raise exception 'This intake form is unavailable';end if;
 if title is null or brief is null or client_name is null or email is null or fingerprint is null or length(trim(title)) not between 1 and 200 or length(trim(brief)) not between 1 and 12000 or length(client_name)>200 or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(fingerprint)<>64 then raise exception 'Check the form fields';end if;
 insert into intake_rate_limits values(link.id,fingerprint,date_trunc('hour',now()),1) on conflict on constraint intake_rate_limits_pkey do update set count=intake_rate_limits.count+1 returning count into n;
 if n>5 then raise exception 'Too many submissions. Try again later';end if;
 select sum(count) into n from intake_rate_limits where link_id=link.id and window_start=date_trunc('hour',now());
 if n>30 then raise exception 'This form has reached its hourly limit. Try again later';end if;
 insert into work_requests(workspace_id,title,kind,brief,client_name,details,created_by) values(link.workspace_id,trim(title),'Other',trim(brief),client_name,jsonb_build_object('contact_email',email,'source','Public intake: '||link.title),link.created_by) returning id into result;
 delete from intake_rate_limits where window_start<now()-interval '2 days';return result;
end $$;


create or replace function public.decide_review_stage(stage uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s review_stages; v deliverable_versions; d deliverables; upcoming review_stages;begin
 select * into s from review_stages where id=stage;
 if not found then raise exception 'Stage not found';end if;
 perform 1 from projects where id=s.project_id for update;
 select * into s from review_stages where id=stage for update;
 select * into v from deliverable_versions where id=s.version_id for update;
 select * into d from deliverables where id=v.deliverable_id;
 if s.reviewer_id is distinct from auth.uid() or not(project_staff(s.workspace_id,s.project_id) or (v.is_published and project_guest(s.workspace_id,s.project_id,'approvals') and project_guest(s.workspace_id,s.project_id,'files') and exists(select 1 from project_files where id=v.file_id and is_published))) then raise exception 'Only the assigned reviewer can decide';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' or d.archived_at is not null or d.deleted_at is not null or s.status<>'Pending' then raise exception 'This stage is no longer awaiting a decision';end if;
 if exists(select 1 from review_stages where version_id=v.id and position<s.position and status<>'Approved') then raise exception 'Earlier reviewers must approve first';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 update review_stages set status=decision,decided_at=now() where id=s.id;
 if decision='Changes requested' then update deliverable_versions set status=decision,decided_at=now(),decided_by=auth.uid() where id=v.id;
 elsif not exists(select 1 from review_stages where version_id=v.id and status<>'Approved') then update deliverable_versions set status='Approved',decided_at=now(),decided_by=auth.uid() where id=v.id;
 else select * into upcoming from review_stages where version_id=v.id and status='Pending' order by position limit 1;
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(s.workspace_id,upcoming.reviewer_id,s.project_id,'Your review stage is ready','review-stage:'||v.id||':'||upcoming.position||':'||upcoming.reviewer_id) on conflict do nothing;end if;
 if exists(select 1 from deliverable_versions where id=v.id and status<>'Pending') then
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,v.created_by,v.project_id,'Review completed: '||d.title,'review-decision:'||v.id) on conflict do nothing;end if;
 insert into audit_log(workspace_id,action,entity) values(s.workspace_id,'review_stage:'||decision,s.id::text);
end $$;

create or replace function public.decide_deliverable_version(version_id uuid,decision text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v deliverable_versions; d deliverables;begin
 -- Serialize decisions and new revisions on the same project lock.
 select * into v from deliverable_versions where id=version_id;
 if not found then raise exception 'Review not found';end if;
 perform 1 from projects where id=v.project_id for update;
 select * into v from deliverable_versions where id=version_id for update;
 select * into d from deliverables where id=v.deliverable_id;
 if not (project_manager(v.workspace_id,v.project_id) or (v.is_published and project_guest(v.workspace_id,v.project_id,'approvals') and project_guest(v.workspace_id,v.project_id,'files') and exists(select 1 from project_files where id=v.file_id and is_published))) then raise exception 'Not authorized';end if;
 if d.archived_at is not null or d.deleted_at is not null then raise exception 'Restore the deliverable first';end if;
 if exists(select 1 from review_stages rs where rs.version_id=v.id) then raise exception 'Use the assigned review stages';end if;
 if decision is null or decision not in ('Approved','Changes requested') then raise exception 'Invalid decision';end if;
 if d.current_version_id<>v.id or v.status<>'Pending' then raise exception 'This version is no longer awaiting a decision';end if;
 update deliverable_versions set status=decision,decided_by=auth.uid(),decided_at=now() where id=v.id;
 insert into audit_log(workspace_id,action,entity) values(v.workspace_id,'review:'||decision,v.id::text);
 insert into studio_notifications(workspace_id,user_id,project_id,title,event_key) values(v.workspace_id,v.created_by,v.project_id,decision||': '||d.title||' · v'||v.version_number,'review-decision:'||v.id) on conflict do nothing;
end $$;

create function public.remove_invoice_receipt(receipt uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r invoice_receipts;begin
 select * into r from invoice_receipts where id=receipt;
 if not found or workspace_role(r.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 perform 1 from invoices where id=r.invoice_id for update;
 delete from invoice_receipts where id=r.id;
 update invoices set status='Sent' where id=r.invoice_id and status='Paid';
 insert into audit_log(workspace_id,action,entity) values(r.workspace_id,'receipt_removed',r.id::text);
end $$;
revoke all on function public.remove_invoice_receipt(uuid) from public,anon,authenticated;
grant execute on function public.remove_invoice_receipt(uuid) to authenticated;

-- Replace inherited privileges with only the operations supported by each surface.
revoke all on task_field_definitions,resource_bookings,scope_changes,project_expenses,invoice_receipts,review_stages,intake_links,intake_rate_limits,email_preferences,studio_email_jobs from public,anon,authenticated;
grant select,insert,update on task_field_definitions,email_preferences to authenticated;
grant select,insert,update,delete on resource_bookings,project_expenses,intake_links to authenticated;
grant select on scope_changes,invoice_receipts,review_stages,studio_email_jobs to authenticated;
