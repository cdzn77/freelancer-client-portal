-- Blob records are immutable; copied threads share a blob without breaking either copy on deletion.
create table collaboration_blobs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id) on delete cascade,
 path text unique,provider text not null check(provider in('supabase','dropbox','minio','r2')),
 name text not null check(length(name) between 1 and 250),mime text not null default 'application/octet-stream',
 size bigint not null check(size between 1 and 10485760),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),ready boolean not null default false
);
create table discussion_attachments (
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references discussion_threads(id) on delete cascade,
 post_id uuid references discussion_posts(id) on delete cascade,blob_id uuid not null references collaboration_blobs(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),deleted_at timestamptz
);
create index on discussion_attachments(thread_id,post_id);
create function collab_file_readable(a uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select pms_session_ready() and exists(select 1 from discussion_attachments f where f.id=a and f.deleted_at is null and collab_readable(f.thread_id) and (f.post_id is null or collab_post_readable(f.post_id)))
$$;
create function collab_blob_readable(b uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from discussion_attachments f where f.blob_id=b and collab_file_readable(f.id))
$$;
create function collab_copy_files(source uuid,t uuid,p uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 insert into discussion_attachments(thread_id,post_id,blob_id,created_by)
 select t,p,blob_id,auth.uid() from discussion_attachments where post_id=source and deleted_at is null
$$;
create function collab_copy_thread_files(source uuid,t uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 insert into discussion_attachments(thread_id,blob_id,created_by)
 select t,blob_id,auth.uid() from discussion_attachments where thread_id=source and post_id is null and deleted_at is null
$$;
-- The server uploads the reserved blob, then commits its storage path. No arbitrary path is accepted from a browser.
create function collab_file_reserve(t uuid,p uuid,n text,m text,s bigint,provider_name text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d discussion_threads;b uuid;a uuid;begin
 select * into d from discussion_threads where id=t;
 if not collab_readable(t) or exists(select 1 from projects where id=d.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Active discussion access required';end if;
 if p is not null and not exists(select 1 from discussion_posts where id=p and thread_id=t and created_by=auth.uid() and collab_editable(id)) then raise exception 'Attach files to your own comment within the editing window';end if;
 if (select count(*) from collaboration_blobs where created_by=auth.uid() and created_at>now()-interval '1 hour')>=100 then raise exception 'Upload limit reached. Try again later.';end if;
 insert into collaboration_blobs(workspace_id,provider,name,mime,size,created_by) values(d.workspace_id,provider_name,n,m,s,auth.uid()) returning id into b;
 insert into discussion_attachments(thread_id,post_id,blob_id,created_by) values(t,p,b,auth.uid()) returning id into a;
 return jsonb_build_object('blob',b,'attachment',a,'workspace',d.workspace_id,'project',d.project_id);
end $$;
create function collab_file_finish(b uuid,object_path text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Service-only: provider paths must come from the upload adapter, never an untrusted request field.
 update collaboration_blobs set path=object_path,ready=true where id=b and not ready;
 if not found then raise exception 'Upload reservation unavailable';end if;
end $$;
create function collab_file_remove(a uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f discussion_attachments;begin
 select * into f from discussion_attachments where id=a for update;
 if not found or not collab_file_readable(a) then raise exception 'File unavailable';end if;
 if exists(select 1 from discussion_threads d join projects p on p.id=d.project_id where d.id=f.thread_id and (p.archived_at is not null or p.deleted_at is not null)) then raise exception 'Restore the project before removing files';end if;
 if not collab_manage(f.thread_id) and not(f.created_by=auth.uid() and (f.post_id is null or collab_editable(f.post_id))) then raise exception 'Only the uploader within the editing window or a project owner can remove this file';end if;
 update discussion_attachments set deleted_at=now() where id=a;
end $$;
alter table collaboration_blobs enable row level security;
alter table discussion_attachments enable row level security;
revoke all on collaboration_blobs,discussion_attachments from public,anon,authenticated;
grant select on collaboration_blobs,discussion_attachments to authenticated;
grant all on collaboration_blobs,discussion_attachments to service_role;
create policy blobs_read on collaboration_blobs for select to authenticated using(collab_blob_readable(id));
create policy attachments_read on discussion_attachments for select to authenticated using(collab_file_readable(id));
-- Existing project-file policies continue to protect ordinary uploads. Collaboration uploads use the server adapter after a checked reservation.
create policy collaboration_storage_read on storage.objects for select to authenticated using(bucket_id='project-files' and pms_session_ready() and exists(select 1 from collaboration_blobs b where b.path=storage.objects.name and b.ready and collab_blob_readable(b.id)));

create function collaboration_snapshot(p_project uuid,p_thread uuid default null,p_task uuid default null,p_before uuid default null,p_offset integer default 0,p_sort text default 'activity',p_search text default '',p_trash boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare pr projects;d discussion_threads;result jsonb;selected uuid:=p_thread;before_time timestamptz;before_id uuid;begin
 if not pms_session_ready() then raise exception 'Sign in required';end if;
 select * into pr from projects where id=p_project;
 if not found or not collab_person(pr.workspace_id,pr.id,auth.uid()) then raise exception 'Project unavailable';end if;
 if p_task is not null then
  if not exists(select 1 from tasks x where x.id=p_task and x.project_id=pr.id and (project_staff(pr.workspace_id,pr.id) or (x.is_published and project_guest(pr.workspace_id,pr.id,'tasks')))) then raise exception 'Task unavailable';end if;
  select id into selected from discussion_threads where task_id=p_task;
 end if;
 if selected is not null then
  select * into d from discussion_threads where id=selected and project_id=pr.id;
  if not found or not collab_readable(selected,true) then raise exception 'Discussion unavailable';end if;
 end if;
 if p_before is not null then
  select created_at,id into before_time,before_id from discussion_posts where id=p_before and thread_id=selected and collab_readable(selected);
  if before_id is null then raise exception 'Invalid comment cursor';end if;
 end if;
 result:=jsonb_build_object(
  'threads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select t.* from discussion_threads t where project_id=pr.id and task_id is null and (deleted_at is not null)=p_trash and position(lower(left(p_search,200)) in lower(title||' '||description))>0 and collab_readable(id,true) order by pinned desc,case when p_sort='name' then lower(title) end,case when p_sort='created' then created_at else updated_at end desc,id limit 100 offset greatest(0,least(p_offset,10000)))x),
  'has_more_threads',(select count(*)>greatest(0,p_offset)+100 from discussion_threads where project_id=pr.id and task_id is null and (deleted_at is not null)=p_trash and position(lower(left(p_search,200)) in lower(title||' '||description))>0 and collab_readable(id,true)),
  'thread',case when selected is null then null else to_jsonb(d) end,
  'people',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from collab_people(pr.id,case when d.deleted_at is null then selected else null end)x),
  'posts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select c.*,collab_editable(c.id) as can_edit from discussion_posts c where thread_id=selected and deleted_at is null and collab_readable(selected) and (before_time is null or (created_at,id)<(before_time,before_id)) order by created_at desc,id desc limit 100)x),
  'has_more_posts',(select count(*)>100 from discussion_posts where thread_id=selected and deleted_at is null and collab_readable(selected) and (before_time is null or (created_at,id)<(before_time,before_id))),
  'subscribers',(select coalesce(jsonb_agg(user_id),'[]') from discussion_subscribers where thread_id=selected and collab_readable(selected) and collab_can_read(selected,user_id)),
  'reactions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from discussion_reactions r join discussion_posts c on c.id=r.post_id where c.thread_id=selected and collab_post_readable(c.id)),
  'attachments',(select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('name',b.name,'mime',b.mime,'size',b.size)),'[]') from discussion_attachments f join collaboration_blobs b on b.id=f.blob_id where f.thread_id=selected and b.ready and collab_file_readable(f.id)),
  'typing',(select coalesce(jsonb_agg(user_id),'[]') from discussion_presence where thread_id=selected and typing_at>now()-interval '12 seconds' and user_id<>auth.uid() and collab_readable(selected)),
  'views',case when collab_manage(selected) then (select coalesce(jsonb_agg(to_jsonb(v)),'[]') from discussion_views v where thread_id=selected) else '[]'::jsonb end,
  'reminders',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from discussion_reminders r where thread_id=selected and collab_readable(selected) and (created_by=auth.uid() or collab_manage(selected))),
  'teams',(select coalesce(jsonb_agg(jsonb_build_object('name',g.name,'user_ids',array(select u from unnest(g.user_ids)u where exists(select 1 from collab_people(pr.id,selected)p where p.user_id=u)))),'[]') from discussion_teams g where project_id=pr.id and exists(select 1 from unnest(g.user_ids)u where exists(select 1 from collab_people(pr.id,selected)p where p.user_id=u))),
  'edit_minutes',case when exists(select 1 from collaboration_settings where workspace_id=pr.workspace_id) then (select comment_edit_minutes from collaboration_settings where workspace_id=pr.workspace_id) else 30 end,
  'manager',project_manager(pr.workspace_id,pr.id));
 return result;
end $$;

-- Preview reads reuse exactly the same scope checks. No presence or access-log writes.
create function preview_client_collaboration(p_project uuid,p_client uuid,p_thread uuid default null,p_task uuid default null,p_before uuid default null,p_offset integer default 0,p_sort text default 'activity',p_search text default '',p_trash boolean default false) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare pr projects;result jsonb;claims text:=current_setting('request.jwt.claims',true);sub text:=current_setting('request.jwt.claim.sub',true);begin
 select * into pr from projects where id=p_project;
 if not found or workspace_role(pr.workspace_id) is distinct from 'owner' then raise exception 'Administrator access required';end if;
 if not exists(select 1 from project_members pm join workspace_members m using(workspace_id,user_id) where pm.project_id=pr.id and pm.user_id=p_client and pm.role='guest' and m.role='client') then raise exception 'Choose an invited client';end if;
 perform set_config('request.jwt.claims',(coalesce(nullif(claims,''),'{}')::jsonb||jsonb_build_object('sub',p_client,'role','authenticated'))::text,true);
 perform set_config('request.jwt.claim.sub',p_client::text,true);
 result:=collaboration_snapshot(p_project,p_thread,p_task,p_before,p_offset,p_sort,p_search,p_trash);
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);return result;
 exception when others then perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);raise;
end $$;

create function client_task_status(p_task uuid,p_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t tasks;begin
 select * into t from tasks where id=p_task for update;
 if not pms_session_ready() or not found or t.assignee_id is distinct from auth.uid() or not t.is_published or not project_guest(t.workspace_id,t.project_id,'tasks') then raise exception 'Only the assigned client can update this task';end if;
 if p_status not in('To do','In progress','Done') or not exists(select 1 from workspaces where id=t.workspace_id and p_status=any(workflow_states)) then raise exception 'Choose an available task status';end if;
 if exists(select 1 from projects where id=t.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Project is not active';end if;
 update tasks set status=p_status where id=t.id;
 insert into audit_log(workspace_id,action,entity) values(t.workspace_id,'client_task_status:'||p_status,t.id::text);
end $$;

create function process_discussion_reminders() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r discussion_reminders;u uuid;d discussion_threads;n integer:=0;begin
 for r in select * from discussion_reminders where sent_at is null and due_at<=now() order by due_at for update skip locked limit 100 loop
  select * into d from discussion_threads where id=r.thread_id;
  foreach u in array r.recipients loop
   if collab_can_read(d.id,u) then insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,discussion_id,task_id)
    values(d.workspace_id,u,d.project_id,'Discussion reminder','discussion-reminder:'||r.id||':'||u,d.id,d.task_id) on conflict(user_id,event_key) do nothing;end if;
  end loop;
  update discussion_reminders set sent_at=now() where id=r.id;n:=n+1;
 end loop;
 -- Trash content becomes unrecoverable only after the documented 30-day interval.
 delete from comments where id in(select id from discussion_threads where deleted_at<now()-interval '30 days');
 delete from discussion_threads where deleted_at<now()-interval '30 days';
 delete from discussion_attachments where deleted_at<now()-interval '30 days';
 delete from discussion_posts where deleted_at<now()-interval '30 days';
 delete from discussion_presence where typing_at<now()-interval '1 hour';
 return n;
end $$;
-- Reply tokens bind one verified email recipient to one discussion and expire in 30 days.
create table discussion_email_replies (
 token uuid primary key default gen_random_uuid(),notification_id uuid not null unique references studio_notifications(id) on delete cascade,
 thread_id uuid not null references discussion_threads(id) on delete cascade,user_id uuid not null references auth.users(id),expires_at timestamptz not null default now()+interval '30 days'
);
create table discussion_email_receipts (
 provider_id text primary key,created_at timestamptz not null default now(),post_id uuid references discussion_posts(id) on delete set null
);
alter table google_email_connections add column reply_enabled boolean not null default false;
alter table discussion_email_replies enable row level security;
alter table discussion_email_receipts enable row level security;
revoke all on discussion_email_replies,discussion_email_receipts from public,anon,authenticated;
grant all on discussion_email_replies,discussion_email_receipts to service_role;
create function receive_discussion_email(p_token uuid,p_sender text,p_provider_id text,p_body text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare r discussion_email_replies;d discussion_threads;id uuid;recipients uuid[];begin
 select * into r from discussion_email_replies where token=p_token for update;
 if not found or r.expires_at<now() or not collab_can_read(r.thread_id,r.user_id) then raise exception 'Reply access expired';end if;
 if not exists(select 1 from auth.users where id=r.user_id and lower(email)=lower(trim(p_sender)) and email_confirmed_at is not null) then raise exception 'Reply sender does not match the notified member';end if;
 if length(p_provider_id) not between 1 and 500 or length(trim(p_body)) not between 1 and 30000 then raise exception 'Invalid reply';end if;
 select post_id into id from discussion_email_receipts where provider_id=p_provider_id;
 if found then return id;end if;
 select * into d from discussion_threads where id=r.thread_id;
 if exists(select 1 from projects where id=d.project_id and (archived_at is not null or deleted_at is not null)) then raise exception 'Project is not active';end if;
 insert into discussion_posts(thread_id,body,created_by) values(d.id,trim(p_body),r.user_id) returning discussion_posts.id into id;
 insert into discussion_email_receipts(provider_id,created_at,post_id) values(p_provider_id,now(),id);
 insert into discussion_subscribers values(d.id,r.user_id) on conflict do nothing;
 select array_agg(user_id) into recipients from discussion_subscribers where thread_id=d.id;
 perform collab_notify(d.id,r.user_id,coalesce(recipients,'{}'),'discussion-email:'||id);
 update discussion_threads set updated_at=now() where discussion_threads.id=d.id;
 return id;
end $$;
-- Service delivery must recheck thread visibility immediately before sending an email.
create function discussion_recipient_allowed(t uuid,u uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select collab_can_read(t,u)$$;

-- Explicit function ACLs, including direct hosted role grants.
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and
 (proname like 'collab\_%' escape '\' or proname in('collaboration_command','collaboration_snapshot','preview_client_collaboration','client_task_status','process_discussion_reminders','receive_discussion_email','discussion_recipient_allowed')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
end loop;end $$;
grant execute on function collab_readable(uuid,boolean),collab_manage(uuid),collab_post_readable(uuid),collab_editable(uuid),collab_people(uuid,uuid),collab_legacy_visible(uuid,text),
 collab_file_readable(uuid),collab_blob_readable(uuid),collab_file_reserve(uuid,uuid,text,text,bigint,text),collab_file_remove(uuid),
 collaboration_command(text,uuid,uuid,jsonb),collaboration_snapshot(uuid,uuid,uuid,uuid,integer,text,text,boolean),preview_client_collaboration(uuid,uuid,uuid,uuid,uuid,integer,text,text,boolean),client_task_status(uuid,text) to authenticated;
grant execute on function collab_file_finish(uuid,text),process_discussion_reminders(),receive_discussion_email(uuid,text,text,text),discussion_recipient_allowed(uuid,uuid) to service_role;
-- Realtime row delivery remains subject to SELECT RLS. Typing expires server-side.
do $$declare t text;begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 foreach t in array array['discussion_threads','discussion_posts','discussion_reactions','discussion_presence','discussion_attachments'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename=t and schemaname='public') then execute format('alter publication supabase_realtime add table public.%I',t);end if;
 end loop;
end if;end $$;
notify pgrst,'reload schema';
