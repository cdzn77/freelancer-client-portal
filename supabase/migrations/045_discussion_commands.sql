create function collab_notify(t uuid,actor uuid,recipients uuid[],event text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d discussion_threads;u uuid;begin
 select * into d from discussion_threads where id=t;
 foreach u in array recipients loop
  if u is distinct from actor and collab_can_read(t,u) then
   insert into studio_notifications(workspace_id,user_id,project_id,title,event_key,discussion_id,task_id)
   values(d.workspace_id,u,d.project_id,'New discussion update',event||':'||u,t,d.task_id) on conflict(user_id,event_key) do nothing;
  end if;
 end loop;
end $$;
create function collab_resolve_mentions(t uuid,people uuid[],tags text[]) returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
declare d discussion_threads;result uuid[]:=coalesce(people,'{}');tag text;more uuid[];begin
 select * into d from discussion_threads where id=t;
 if cardinality(result)>100 or cardinality(tags)>20 then raise exception 'Too many mentions';end if;
 if exists(select 1 from unnest(result)u where not exists(select 1 from collab_people(d.project_id,t)p where p.user_id=u)) then raise exception 'Mention only people who can read this thread. Share it before mentioning a client.';end if;
 foreach tag in array coalesce(tags,'{}') loop
  more:='{}';
  if tag in('project','everyone') then select array_agg(user_id) into more from collab_people(d.project_id,t);
  elsif tag='here' then select array_agg(s.user_id) into more from discussion_subscribers s join collab_people(d.project_id,t)p using(user_id) where s.thread_id=t;
  elsif tag='leader' then select array_agg(p.user_id) into more from collab_people(d.project_id,t)p join project_members m on m.project_id=d.project_id and m.user_id=p.user_id and m.role='owner';
  elsif tag='assignee' then select array_agg(p.user_id) into more from collab_people(d.project_id,t)p join tasks x on x.id=d.task_id and x.assignee_id=p.user_id;
  elsif tag like 'team:%' then
   select array_agg(p.user_id) into more from discussion_teams g join collab_people(d.project_id,t)p on p.user_id=any(g.user_ids) where g.project_id=d.project_id and lower(g.name)=lower(substr(tag,6));
  else raise exception 'Unknown mention group';end if;
  result:=result||coalesce(more,'{}');
 end loop;
 return array(select distinct x from unnest(result)x where x is not null);
end $$;

create function collaboration_command(p_action text,p_project uuid,p_thread uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
<<cmd>>
declare pr projects;d discussion_threads;c discussion_posts;target discussion_threads;actor uuid:=auth.uid();manager boolean;guest boolean;
 id uuid;post_id uuid;task uuid;dest uuid;people uuid[];tags text[];recipients uuid[];body text;title text;request uuid;mins integer;result jsonb;source record;post_map jsonb:='{}';
begin
 if not pms_session_ready() or actor is null then raise exception 'Sign in required';end if;
 select * into pr from projects where id=p_project for update;
 if not found or not collab_person(pr.workspace_id,pr.id,actor) then raise exception 'Project unavailable';end if;
 manager:=project_manager(pr.workspace_id,pr.id);guest:=workspace_role(pr.workspace_id)='client';
 if pr.archived_at is not null or pr.deleted_at is not null then raise exception 'Restore the project before changing discussions';end if;
 if p_action='settings' then
  if workspace_role(pr.workspace_id)<>'owner' then raise exception 'Administrator access required';end if;
  mins:=(p_payload->>'minutes')::integer;
  insert into collaboration_settings values(pr.workspace_id,mins) on conflict(workspace_id) do update set comment_edit_minutes=excluded.comment_edit_minutes;
  return jsonb_build_object('ok',true);
 elsif p_action='team' then
  if not manager then raise exception 'Project owner access required';end if;
  people:=array(select jsonb_array_elements_text(coalesce(p_payload->'people','[]'))::uuid);
  if exists(select 1 from unnest(people)u where not collab_person(pr.workspace_id,pr.id,u)) then raise exception 'Choose project members';end if;
  if p_payload->>'name' in('here','project','everyone','leader','assignee') then raise exception 'This mention name is reserved';end if;
  insert into discussion_teams(workspace_id,project_id,name,user_ids) values(pr.workspace_id,pr.id,p_payload->>'name',people)
  on conflict(project_id,name) do update set user_ids=excluded.user_ids;return jsonb_build_object('ok',true);
 elsif p_action='ensure_task' then
  task:=(p_payload->>'task')::uuid;
  if not exists(select 1 from tasks x where x.id=task and x.project_id=pr.id and (not guest or (x.is_published and project_guest(pr.workspace_id,pr.id,'tasks')))) then raise exception 'Task unavailable';end if;
  insert into discussion_threads(workspace_id,project_id,task_id,title,hidden_from_clients,created_by)
   select workspace_id,project_id,x.id,x.title,not x.is_published,actor from tasks x where x.id=task
   on conflict(task_id) do nothing returning discussion_threads.id into id;
  if id is not null then
   insert into discussion_subscribers values(id,actor) on conflict do nothing;
   insert into discussion_subscribers select cmd.id,x.assignee_id from tasks x where x.id=task and x.assignee_id is not null and collab_can_read(cmd.id,x.assignee_id) on conflict do nothing;
   insert into discussion_subscribers select cmd.id,m.user_id from project_members m where m.project_id=pr.id and m.role='owner' and collab_can_read(cmd.id,m.user_id) on conflict do nothing;
  end if;
  select x.id into id from discussion_threads x where x.task_id=task;
  return jsonb_build_object('thread',id);
 elsif p_action='create' then
  if guest and not project_guest(pr.workspace_id,pr.id,'discussions') then raise exception 'Discussions are not enabled for this project';end if;
  if not guest and not project_staff(pr.workspace_id,pr.id) then raise exception 'Project access required';end if;
  if not guest and not manager and coalesce((p_payload->>'hidden')::boolean,true)=false then raise exception 'A project owner must share discussions';end if;
  id:=coalesce((p_payload->>'request')::uuid,gen_random_uuid());
  select * into d from discussion_threads where discussion_threads.id=cmd.id;
  if found then
   if d.created_by<>actor or d.project_id<>pr.id then raise exception 'Request already used';end if;
   return jsonb_build_object('thread',id);
  end if;
  insert into discussion_threads(id,workspace_id,project_id,title,description,hidden_from_clients,created_by)
  values(id,pr.workspace_id,pr.id,trim(p_payload->>'title'),coalesce(p_payload->>'description',''),case when guest then false else coalesce((p_payload->>'hidden')::boolean,true) end,actor);
  if manager and coalesce((p_payload->>'hidden')::boolean,true)=false and not('discussions'=any(pr.client_tools)) then
   update projects set client_tools=client_tools||array['discussions'] where projects.id=pr.id;
  end if;
  insert into discussion_subscribers values(id,actor);
  insert into discussion_subscribers select cmd.id,m.user_id from project_members m where m.project_id=pr.id and m.role='owner' and collab_can_read(cmd.id,m.user_id) on conflict do nothing;
  -- A client-created topic must reach the workspace administrator even when no project leader was selected.
  if guest then insert into discussion_subscribers select cmd.id,m.user_id from workspace_members m where m.workspace_id=pr.workspace_id and m.role='owner' and collab_can_read(cmd.id,m.user_id) on conflict do nothing;end if;
  select array_agg(user_id) into recipients from discussion_subscribers where thread_id=cmd.id;
  perform collab_notify(id,actor,coalesce(recipients,'{}'),'discussion-created:'||id);
  return jsonb_build_object('thread',id);
 end if;
 select * into d from discussion_threads where discussion_threads.id=p_thread and project_id=pr.id for update;
 if not found or not collab_can_read(d.id,actor,p_action in('restore','delete')) then raise exception 'Discussion unavailable';end if;
 if p_action='post' then
  body:=trim(p_payload->>'body');request:=coalesce((p_payload->>'request')::uuid,gen_random_uuid());
  select * into c from discussion_posts where created_by=actor and request_id=request;
  if found then
   if c.thread_id<>d.id or c.body<>body then raise exception 'Request key already used';end if;
   return jsonb_build_object('post',c.id,'thread',d.id);
  end if;
  if (select count(*) from discussion_posts where created_by=actor and created_at>now()-interval '1 minute')>=30 then raise exception 'Please wait before posting another message';end if;
  people:=array(select jsonb_array_elements_text(coalesce(p_payload->'people','[]'))::uuid);
  tags:=array(select jsonb_array_elements_text(coalesce(p_payload->'tags','[]')));
  people:=collab_resolve_mentions(d.id,people,tags);
  post_id:=(p_payload->>'reply_to')::uuid;
  if post_id is not null and not exists(select 1 from discussion_posts where discussion_posts.id=post_id and thread_id=d.id and deleted_at is null) then raise exception 'Reply target unavailable';end if;
  insert into discussion_posts(thread_id,body,created_by,reply_to,mentions,mention_tags,request_id)
  values(d.id,body,actor,post_id,people,tags,request) returning discussion_posts.id into id;
  insert into discussion_subscribers values(d.id,actor) on conflict do nothing;
  select array_agg(distinct u) into recipients from (select user_id u from discussion_subscribers where thread_id=d.id union select unnest(people))s;
  perform collab_notify(d.id,actor,coalesce(recipients,'{}'),'discussion-post:'||id);
  update discussion_threads set updated_at=now() where discussion_threads.id=d.id;
  delete from discussion_presence where thread_id=d.id and user_id=actor;
  return jsonb_build_object('post',id,'thread',d.id);
 elsif p_action in('edit_post','delete_post','react','comment_task','append_task') then
  post_id:=(p_payload->>'post')::uuid;
  select * into c from discussion_posts where discussion_posts.id=post_id and thread_id=d.id and deleted_at is null for update;
  if not found then raise exception 'Comment unavailable';end if;
  if p_action='react' then
   if exists(select 1 from discussion_reactions where discussion_reactions.post_id=c.id and user_id=actor and emoji=p_payload->>'emoji') then delete from discussion_reactions where discussion_reactions.post_id=c.id and user_id=actor and emoji=p_payload->>'emoji';
   else insert into discussion_reactions values(c.id,actor,p_payload->>'emoji');end if;
  elsif p_action in('edit_post','delete_post') then
   if not collab_editable(c.id) then raise exception 'The editing window has ended or this comment belongs to someone else';end if;
   if p_action='delete_post' then update discussion_posts set deleted_at=now() where discussion_posts.id=c.id;
   else
    people:=array(select jsonb_array_elements_text(coalesce(p_payload->'people','[]'))::uuid);
    tags:=array(select jsonb_array_elements_text(coalesce(p_payload->'tags','[]')));
    people:=collab_resolve_mentions(d.id,people,tags);
    update discussion_posts set body=trim(p_payload->>'body'),edited_at=now(),mentions=people,mention_tags=tags where discussion_posts.id=c.id;
    perform collab_notify(d.id,actor,array(select u from unnest(people)u where not(u=any(c.mentions))),'discussion-mention:'||c.id);

   end if;
  else
   if not manager then raise exception 'Project owner access required';end if;
   if p_action='comment_task' then
    insert into tasks(workspace_id,project_id,title,description,is_published) values(pr.workspace_id,pr.id,left(coalesce(nullif(p_payload->>'title',''),c.body),200),c.body,false) returning tasks.id into task;
   else
    task:=(p_payload->>'task')::uuid;
    if not exists(select 1 from tasks where tasks.id=task and project_id=pr.id) then raise exception 'Choose a task in this project';end if;
    if d.hidden_from_clients and exists(select 1 from tasks where tasks.id=task and is_published) then raise exception 'Internal comments cannot be appended to shared tasks';end if;
   end if;
   result:=collaboration_command('ensure_task',pr.id,null,jsonb_build_object('task',task));id:=(result->>'thread')::uuid;
   insert into discussion_posts(thread_id,body,created_by) values(id,c.body,actor) returning discussion_posts.id into post_id;
   -- Attachment links are copied by the file migration's helper.
   if to_regprocedure('public.collab_copy_files(uuid,uuid,uuid)') is not null then perform collab_copy_files(c.id,id,post_id);end if;
   insert into discussion_subscribers select id,user_id from discussion_subscribers where thread_id=d.id and collab_can_read(id,user_id) on conflict do nothing;
   return jsonb_build_object('task',task,'thread',id);
  end if;
 elsif p_action='edit_thread' then
  if not manager and d.created_by<>actor then raise exception 'Only the author or project owner can edit this discussion';end if;
  if d.task_id is not null then raise exception 'Edit task details from the task';end if;
  if not manager and p_payload ? 'hidden' and (p_payload->>'hidden')::boolean<>d.hidden_from_clients then raise exception 'Only project owners control client visibility';end if;
  if manager and coalesce((p_payload->>'hidden')::boolean,d.hidden_from_clients)=false and not('discussions'=any(pr.client_tools)) then
   update projects set client_tools=client_tools||array['discussions'] where projects.id=pr.id;
  end if;
  update discussion_threads set title=coalesce(p_payload->>'title',title),description=coalesce(p_payload->>'description',description),hidden_from_clients=case when manager then coalesce((p_payload->>'hidden')::boolean,hidden_from_clients) else hidden_from_clients end,updated_at=now() where discussion_threads.id=d.id;
 elsif p_action in('delete','restore') then
  if d.task_id is not null then raise exception 'Manage this conversation through its task';end if;
  if not manager and d.created_by<>actor then raise exception 'Only the author or project owner can delete this discussion';end if;
  if p_action='restore' and d.deleted_at<now()-interval '30 days' then raise exception 'The 30-day recovery period has ended';end if;
  update discussion_threads set deleted_at=case when p_action='delete' then now() else null end,updated_at=now() where discussion_threads.id=d.id;
 elsif p_action='pin' then
  if not manager then raise exception 'Project owner access required';end if;
  update discussion_threads set pinned=not pinned where discussion_threads.id=d.id;
 elsif p_action='subscribe' then
  id:=coalesce((p_payload->>'user')::uuid,actor);
  if id<>actor and not manager then raise exception 'Only project owners manage other subscribers';end if;
  if not collab_can_read(d.id,id) then raise exception 'Subscriber cannot read this discussion';end if;
  if coalesce((p_payload->>'enabled')::boolean,true) then insert into discussion_subscribers values(d.id,id) on conflict do nothing;
  else delete from discussion_subscribers where thread_id=d.id and user_id=id;end if;
 elsif p_action='open' then
  insert into discussion_views(thread_id,user_id) values(d.id,actor) on conflict(thread_id,user_id) do update
  set last_opened_at=now(),open_count=discussion_views.open_count+case when discussion_views.last_opened_at<now()-interval '5 minutes' then 1 else 0 end;
 elsif p_action='typing' then
  if coalesce((p_payload->>'active')::boolean,true) then insert into discussion_presence values(d.id,actor,now()) on conflict(thread_id,user_id) do update set typing_at=now();
  else delete from discussion_presence where thread_id=d.id and user_id=actor;end if;
 elsif p_action='reminder' then
  recipients:=array(select jsonb_array_elements_text(coalesce(p_payload->'people','[]'))::uuid);
  if cardinality(recipients)=0 then recipients:=array[actor];end if;
  if guest and recipients<>array[actor] then raise exception 'Clients can set reminders only for themselves';end if;
  if cardinality(recipients)>100 or exists(select 1 from unnest(recipients)u where not collab_can_read(d.id,u)) then raise exception 'Choose people who can read this discussion';end if;
  if (p_payload->>'due')::timestamptz<=now() or (p_payload->>'due')::timestamptz>now()+interval '2 years' then raise exception 'Choose a future reminder within two years';end if;
  insert into discussion_reminders(thread_id,created_by,recipients,due_at) values(d.id,actor,recipients,(p_payload->>'due')::timestamptz);
 elsif p_action='cancel_reminder' then
  delete from discussion_reminders where discussion_reminders.id=(p_payload->>'id')::uuid and thread_id=d.id and (created_by=actor or manager) and sent_at is null;
 elsif p_action='convert' then
  if not manager or d.task_id is not null then raise exception 'Project owner access to a discussion is required';end if;
  if not d.hidden_from_clients then update projects set client_tools=array(select distinct unnest(client_tools||array['tasks'])) where projects.id=pr.id;end if;
  insert into tasks(workspace_id,project_id,title,description,is_published) values(pr.workspace_id,pr.id,d.title,d.description,not d.hidden_from_clients) returning tasks.id into task;
  update discussion_threads set task_id=task where discussion_threads.id=d.id;
  return jsonb_build_object('task',task,'thread',d.id);
 elsif p_action in('move','copy') then
  dest:=(p_payload->>'project')::uuid;
  if not manager or d.task_id is not null or not exists(select 1 from projects where projects.id=dest and workspace_id=pr.workspace_id and archived_at is null and deleted_at is null and project_manager(workspace_id,id)) then raise exception 'Choose an active project you manage in this workspace';end if;
  if dest=pr.id then raise exception 'Choose another project';end if;
  if p_action='move' then
   update discussion_threads set project_id=dest,hidden_from_clients=true,updated_at=now() where discussion_threads.id=d.id;
   delete from discussion_subscribers where thread_id=d.id and not collab_can_read(d.id,user_id);
   delete from discussion_presence where thread_id=d.id;
   delete from discussion_reminders where thread_id=d.id and sent_at is null;
   update studio_notifications set deleted_at=now() where discussion_id=d.id;
   id:=d.id;
  else
   insert into discussion_threads(workspace_id,project_id,title,description,hidden_from_clients,created_by)
   values(pr.workspace_id,dest,d.title,d.description,true,actor) returning discussion_threads.id into id;
   for source in select * from discussion_posts where thread_id=d.id and deleted_at is null order by created_at,id loop
    insert into discussion_posts(thread_id,body,created_by,created_at,edited_at) values(id,source.body,source.created_by,source.created_at,source.edited_at) returning discussion_posts.id into post_id;
    post_map:=post_map||jsonb_build_object(source.id::text,post_id::text);
    if to_regprocedure('public.collab_copy_files(uuid,uuid,uuid)') is not null then perform collab_copy_files(source.id,id,post_id);end if;
   end loop;
   for source in select x.id,x.reply_to from discussion_posts x where x.thread_id=d.id and x.deleted_at is null and x.reply_to is not null loop
    update discussion_posts set reply_to=(post_map->>source.reply_to::text)::uuid where discussion_posts.id=(post_map->>source.id::text)::uuid;
   end loop;
   if to_regprocedure('public.collab_copy_thread_files(uuid,uuid)') is not null then perform collab_copy_thread_files(d.id,id);end if;
   insert into discussion_subscribers select id,user_id from discussion_subscribers where thread_id=d.id and collab_can_read(id,user_id) on conflict do nothing;
   insert into discussion_subscribers values(id,actor) on conflict do nothing;
  end if;
  insert into audit_log(workspace_id,action,entity) values(pr.workspace_id,'discussion_'||p_action,d.id||':'||id||':'||dest);
  return jsonb_build_object('thread',id,'project',dest);
 else raise exception 'Unknown discussion action';end if;
 return jsonb_build_object('ok',true,'thread',d.id);
end $$;
