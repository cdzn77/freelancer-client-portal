-- Include shared discussion metadata in the administrator's existing client preview.
do $$declare definition text;begin
 select pg_get_functiondef('public.preview_client_project(uuid,uuid)'::regprocedure) into definition;
 if position($needle$'comments',(select$needle$ in definition)=0 then raise exception 'Review client preview before extending it';end if;
 definition:=replace(definition,$needle$'comments',(select$needle$,$patch$'discussion_threads',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from discussion_threads t where project_id=p.id),
 'comments',(select$patch$);
 execute definition;
end $$;
alter table google_email_connections add column reply_page_token text;
alter table google_email_connections add column reply_checked_at timestamptz;
alter table google_email_connections add column reply_last_error text;
alter table collaboration_blobs add column email_source text unique;
grant select(reply_enabled,reply_checked_at,reply_last_error) on google_email_connections to authenticated;
create function receive_discussion_attachment(p_token uuid,p_provider_id text,p_file_key text,p_name text,p_mime text,p_size bigint,p_provider text,p_path text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r discussion_email_replies;post uuid;b uuid;w uuid;begin
 select * into r from discussion_email_replies where token=p_token;
 if not found or r.expires_at<now() or not collab_can_read(r.thread_id,r.user_id) then raise exception 'Reply access expired';end if;
 select post_id into post from discussion_email_receipts where provider_id=p_provider_id;
 if post is null or not exists(select 1 from discussion_posts where id=post and thread_id=r.thread_id and created_by=r.user_id and deleted_at is null) then raise exception 'Reply unavailable';end if;
 select workspace_id into w from discussion_threads where id=r.thread_id;
 insert into collaboration_blobs(workspace_id,path,provider,name,mime,size,created_by,ready,email_source)
 values(w,p_path,p_provider,p_name,p_mime,p_size,r.user_id,true,p_provider_id||':'||p_file_key) on conflict(email_source) do nothing returning id into b;
 if b is null then return false;end if;
 insert into discussion_attachments(thread_id,post_id,blob_id,created_by) values(r.thread_id,post,b,r.user_id);return true;
end $$;
create function collaboration_orphan_blobs() returns setof collaboration_blobs language sql security definer set search_path=public,pg_temp as $$
 select b.* from collaboration_blobs b where created_at<now()-interval '30 days' and not exists(select 1 from discussion_attachments a where a.blob_id=b.id) order by created_at limit 50
$$;
revoke all on function receive_discussion_attachment(uuid,text,text,text,text,bigint,text,text),collaboration_orphan_blobs() from public,anon,authenticated;
grant execute on function receive_discussion_attachment(uuid,text,text,text,text,bigint,text,text),collaboration_orphan_blobs() to service_role;
-- New task assignments generate in-app notifications; delivery respects the recipient's email preference.
create function collab_task_notice() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id) and new.assignee_id is distinct from auth.uid() then
  insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,task_id) values(new.workspace_id,new.assignee_id,new.project_id,'A task was assigned to you','task-assigned:'||new.id||':'||gen_random_uuid(),new.id);
 end if;return new;
end $$;
revoke all on function collab_task_notice() from public,anon,authenticated;
create trigger collaboration_task_notice after insert or update of assignee_id on tasks for each row execute function collab_task_notice();
notify pgrst,'reload schema';

alter table discussion_email_receipts add column attachments_complete boolean not null default false;

alter table google_email_connections add column reply_locked_until timestamptz;
create function claim_discussion_reply_sync(w uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update google_email_connections set reply_locked_until=now()+interval '4 minutes' where workspace_id=w and reply_enabled and (reply_locked_until is null or reply_locked_until<now());
 return found;
end $$;
revoke all on function claim_discussion_reply_sync(uuid) from public,anon,authenticated;
grant execute on function claim_discussion_reply_sync(uuid) to service_role;
