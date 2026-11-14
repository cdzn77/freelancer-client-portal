-- Private avatar storage. Users can alter only their own fixed photo object.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('profile-photos','profile-photos',false,1048576,array['image/jpeg'])
on conflict (id) do nothing;
create policy profile_photos_read on storage.objects for select to authenticated
using (bucket_id='profile-photos' and public.pms_session_ready() and
 (name=auth.uid()::text||'/avatar.jpg' or exists (
   -- workspace_members RLS limits this to people already visible to this user.
   select 1 from public.workspace_members m where name=m.user_id::text||'/avatar.jpg'
 )));
create policy profile_photos_insert on storage.objects for insert to authenticated
with check (bucket_id='profile-photos' and public.pms_session_ready() and name=auth.uid()::text||'/avatar.jpg');
create policy profile_photos_update on storage.objects for update to authenticated
using (bucket_id='profile-photos' and public.pms_session_ready() and name=auth.uid()::text||'/avatar.jpg')
with check (bucket_id='profile-photos' and public.pms_session_ready() and name=auth.uid()::text||'/avatar.jpg');
create policy profile_photos_delete on storage.objects for delete to authenticated
using (bucket_id='profile-photos' and public.pms_session_ready() and name=auth.uid()::text||'/avatar.jpg');
