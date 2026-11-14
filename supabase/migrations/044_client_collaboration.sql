-- Shared discussions and task conversations. Direct writes are RPC-only.
create table collaboration_settings (
 workspace_id uuid primary key references workspaces(id) on delete cascade,
 comment_edit_minutes integer default 30 check(comment_edit_minutes is null or comment_edit_minutes between 30 and 525600)
);
create table discussion_threads (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 project_id uuid not null, task_id uuid unique references tasks(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '' check(length(description)<=30000),
 hidden_from_clients boolean not null default true, pinned boolean not null default false,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), deleted_at timestamptz,
 foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade
);
create index discussion_project_activity on discussion_threads(project_id,updated_at desc,id);
create table discussion_posts (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references discussion_threads(id) on delete cascade,
 body text not null check(length(body) between 1 and 30000), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz,
 reply_to uuid references discussion_posts(id) on delete set null,
 mentions uuid[] not null default '{}', mention_tags text[] not null default '{}', request_id uuid not null default gen_random_uuid(),
 unique(created_by,request_id)
);
create index discussion_post_thread on discussion_posts(thread_id,created_at desc,id);
create table discussion_subscribers (
 thread_id uuid not null references discussion_threads(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, primary key(thread_id,user_id)
);
create table discussion_reactions (
 post_id uuid not null references discussion_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 emoji text not null check(emoji in ('👍','😊','👏','❤️','🎉','🤔','👎')), primary key(post_id,user_id,emoji)
);
create table discussion_presence (
 thread_id uuid not null references discussion_threads(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 typing_at timestamptz not null default now(), primary key(thread_id,user_id)
);
create table discussion_views (
 thread_id uuid not null references discussion_threads(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 first_opened_at timestamptz not null default now(), last_opened_at timestamptz not null default now(),
 open_count integer not null default 1, primary key(thread_id,user_id)
);
create table discussion_reminders (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references discussion_threads(id) on delete cascade,
 created_by uuid not null references auth.users(id), recipients uuid[] not null,
 due_at timestamptz not null, sent_at timestamptz, created_at timestamptz not null default now()
);
create table discussion_teams (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,project_id uuid not null,
 name text not null check(name ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$'),user_ids uuid[] not null,
 unique(project_id,name),foreign key(workspace_id,project_id) references projects(workspace_id,id) on delete cascade
);
alter table studio_notifications add column discussion_id uuid references discussion_threads(id) on delete cascade;
alter table studio_notifications add column task_id uuid references tasks(id) on delete cascade;

-- Preserve every legacy message, author, timestamp, tag and sharing decision.
insert into discussion_threads(id,workspace_id,project_id,title,hidden_from_clients,created_by,created_at,updated_at)
 select id,workspace_id,project_id,coalesce(nullif(trim(left(regexp_replace(body,E'[\n\r]+',' ','g'),100)),''),'Discussion'),not is_published,created_by,created_at,coalesce(edited_at,created_at) from comments;
insert into discussion_posts(id,thread_id,body,created_by,created_at,edited_at,mentions)
 select id,id,body,created_by,created_at,edited_at,mentions from comments;
insert into discussion_subscribers select id,created_by from discussion_threads;

create function collab_person(w uuid,p uuid,u uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from workspace_members m join projects q on q.workspace_id=m.workspace_id and q.id=p
 where m.workspace_id=w and m.user_id=u and q.deleted_at is null and
 (m.role='owner' or (m.role in('member','contractor') and q.access_type='workspace') or exists(select 1 from project_members pm where pm.workspace_id=w and pm.project_id=p and pm.user_id=u)))
$$;
create function collab_can_read(t uuid,u uuid,trash boolean default false) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from discussion_threads d join projects p on p.id=d.project_id join workspace_members m on m.workspace_id=d.workspace_id and m.user_id=u
 where d.id=t and collab_person(d.workspace_id,d.project_id,u)
 and (d.deleted_at is null or (trash and (m.role<>'client' or d.created_by=u)))
 and (m.role<>'client' or (not d.hidden_from_clients and exists(select 1 from project_members pm where pm.project_id=d.project_id and pm.user_id=u and pm.role='guest') and
 case when d.task_id is null then 'discussions'=any(p.client_tools) else 'tasks'=any(p.client_tools) and exists(select 1 from tasks x where x.id=d.task_id and x.is_published) end)))
$$;
create function collab_readable(t uuid,trash boolean default false) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select pms_session_ready() and collab_can_read(t,auth.uid(),trash)
$$;
create function collab_manage(t uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select pms_session_ready() and exists(select 1 from discussion_threads d where d.id=t and project_manager(d.workspace_id,d.project_id))
$$;
create function collab_post_readable(p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from discussion_posts c where c.id=p and c.deleted_at is null and collab_readable(c.thread_id))
$$;
create function collab_editable(p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from discussion_posts c join discussion_threads d on d.id=c.thread_id
 left join collaboration_settings s on s.workspace_id=d.workspace_id
 where c.id=p and c.deleted_at is null and collab_readable(d.id)
 and (project_manager(d.workspace_id,d.project_id) or (c.created_by=auth.uid() and
 (case when s.workspace_id is null then 30 else s.comment_edit_minutes end is null or c.created_at+make_interval(mins=>coalesce(s.comment_edit_minutes,30))>=now()))))
$$;
-- Client mention pickers show explicit project people, not the full internal team.
create function collab_people(p uuid,t uuid default null) returns table(user_id uuid,display_name text,role text,unavailable boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select m.user_id,m.display_name,m.role,exists(select 1 from team_time_off o where o.workspace_id=m.workspace_id and o.user_id=m.user_id and current_date between o.starts_on and o.ends_on)
 from projects q join workspace_members m on m.workspace_id=q.workspace_id
 where q.id=p and pms_session_ready() and collab_person(q.workspace_id,q.id,auth.uid()) and collab_person(q.workspace_id,q.id,m.user_id)
 and (workspace_role(q.workspace_id)<>'client' or exists(select 1 from project_members pm where pm.project_id=q.id and pm.user_id=m.user_id))
 and (t is null or (exists(select 1 from discussion_threads d where d.id=t and d.project_id=p) and collab_can_read(t,auth.uid()) and collab_can_read(t,m.user_id)))
$$;

-- Client assignment explicitly shares the task with invited project clients.
create or replace function validate_task_assignee_access() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r text;begin
 if new.assignee_id is null then return new;end if;
 select role into r from workspace_members where workspace_id=new.workspace_id and user_id=new.assignee_id;
 if r is null or not collab_person(new.workspace_id,new.project_id,new.assignee_id) then raise exception 'Invite this person to the project before assigning tasks';end if;
 if r='client' then
  if not exists(select 1 from project_members where project_id=new.project_id and user_id=new.assignee_id and role='guest') then raise exception 'Invite this client to the project first';end if;
  if tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id then
   if not project_manager(new.workspace_id,new.project_id) and auth.role()<>'service_role' then raise exception 'A project owner must assign client work';end if;
   new.is_published:=true;
   update projects set client_tools=array(select distinct unnest(client_tools||array['tasks'])) where id=new.project_id;
  elsif not new.is_published then raise exception 'Unassign the client before hiding their task';end if;
 end if;
 return new;
end $$;
-- Preserve sharing on ordinary staff edits to an already client-assigned task.
create or replace function guard_publishing() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.project_id<>old.project_id) then raise exception 'Content cannot be moved between projects';end if;
 if (tg_op='INSERT' and new.is_published) or (tg_op='UPDATE' and new.is_published is distinct from old.is_published) then
  if not project_manager(new.workspace_id,new.project_id) and not(tg_table_name='comments' and tg_op='INSERT' and project_guest(new.workspace_id,new.project_id,'discussions')) and auth.role()<>'service_role' then raise exception 'Only project owners can publish content';end if;
 end if;
 if tg_op='UPDATE' and auth.role()='authenticated' and not project_manager(new.workspace_id,new.project_id) then
  if tg_table_name='tasks' then
   if not exists(select 1 from workspace_members where workspace_id=new.workspace_id and user_id=new.assignee_id and role='client') then new.is_published=false;end if;
  elsif tg_table_name='comments' and project_staff(new.workspace_id,new.project_id) then new.is_published=false;end if;
 end if;
 return new;
end $$;

-- Legacy REST routes must respect the new thread's privacy, Trash and edited text.
-- The missing-thread case permits INSERT RETURNING before the AFTER INSERT bridge runs.
create function collab_legacy_visible(c uuid,b text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select pms_session_ready() and (not exists(select 1 from discussion_threads where id=c) or exists(
  select 1 from discussion_threads d where d.id=c and collab_can_read(c,auth.uid()) and
  exists(select 1 from discussion_posts p where p.id=c and p.deleted_at is null)))
$$;
create policy collaboration_legacy_visibility on comments as restrictive for all to authenticated using(collab_legacy_visible(id,body)) with check(true);
create policy collaboration_legacy_edit_window on comments as restrictive for update to authenticated using(collab_editable(id)) with check(true);
create policy collaboration_legacy_delete_window on comments as restrictive for delete to authenticated using(collab_editable(id));

-- New tables are read-only through REST. Mutation RPCs perform ownership checks.
do $$declare t text;begin foreach t in array array['collaboration_settings','discussion_threads','discussion_posts','discussion_subscribers','discussion_reactions','discussion_presence','discussion_views','discussion_reminders','discussion_teams'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated',t);
 execute format('grant select on %I to authenticated',t);
 execute format('grant all on %I to service_role',t);
 execute format('create policy pms_session_security on %I as restrictive for all to authenticated using(pms_session_ready()) with check(pms_session_ready())',t);
end loop;end $$;
create policy settings_read on collaboration_settings for select to authenticated using(workspace_role(workspace_id) is not null);
create policy threads_read on discussion_threads for select to authenticated using(collab_readable(id,true));
create policy posts_read on discussion_posts for select to authenticated using(deleted_at is null and collab_readable(thread_id));
create policy subscribers_read on discussion_subscribers for select to authenticated using(collab_readable(thread_id));
create policy reactions_read on discussion_reactions for select to authenticated using(collab_post_readable(post_id));
create policy presence_read on discussion_presence for select to authenticated using(collab_readable(thread_id));
create policy views_read on discussion_views for select to authenticated using(collab_manage(thread_id));
create policy reminders_read on discussion_reminders for select to authenticated using(collab_readable(thread_id) and (created_by=auth.uid() or collab_manage(thread_id)));
create policy teams_read on discussion_teams for select to authenticated using(project_staff(workspace_id,project_id));
create function collab_sync_task() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 update discussion_threads set title=new.title,hidden_from_clients=not new.is_published,updated_at=now() where task_id=new.id;
 return new;end $$;
create trigger collaboration_task_sync after update of title,is_published on tasks for each row execute function collab_sync_task();
create function collab_sync_legacy() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if pg_trigger_depth()>1 then return coalesce(new,old);end if;
 if tg_op='DELETE' then update discussion_threads set deleted_at=coalesce(deleted_at,now()) where id=old.id;return old;end if;
 insert into discussion_threads(id,workspace_id,project_id,title,hidden_from_clients,created_by,created_at,updated_at)
 values(new.id,new.workspace_id,new.project_id,coalesce(nullif(trim(left(regexp_replace(new.body,E'[\n\r]+',' ','g'),100)),''),'Discussion'),not new.is_published,new.created_by,new.created_at,now())
 on conflict(id) do update set hidden_from_clients=case when tg_op='UPDATE' and new.is_published is not distinct from old.is_published then discussion_threads.hidden_from_clients else excluded.hidden_from_clients end,updated_at=now();
 insert into discussion_posts(id,thread_id,body,created_by,created_at,edited_at,mentions)
 values(new.id,new.id,new.body,new.created_by,new.created_at,new.edited_at,new.mentions)
 on conflict(id) do update set body=excluded.body,mentions=excluded.mentions,edited_at=excluded.edited_at;
 insert into discussion_subscribers values(new.id,new.created_by) on conflict do nothing;return new;
end $$;
create trigger collaboration_legacy_sync after insert or update or delete on comments for each row execute function collab_sync_legacy();
create function collab_sync_post_legacy() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin
 if pg_trigger_depth()>1 then return new;end if;
 update comments set body=new.body,mentions=array(select u from unnest(new.mentions)u limit 30) where id=new.id and body is distinct from new.body;
 return new;
end $$;
create trigger collaboration_post_legacy_sync after update of body on discussion_posts for each row execute function collab_sync_post_legacy();
-- Explicit role revokes matter on hosted Supabase, whose default ACLs differ from local PostgreSQL.
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'collab\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
end loop;end $$;
grant execute on function collab_readable(uuid,boolean),collab_manage(uuid),collab_post_readable(uuid),collab_editable(uuid),collab_people(uuid,uuid),collab_legacy_visible(uuid,text) to authenticated;
