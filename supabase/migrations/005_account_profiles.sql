-- Personal account details live in Supabase Auth metadata, which each user can
-- update only for their own identity. Never use editable metadata for roles.
-- Only the display name is mirrored into tenant-scoped membership records.
create function public.sync_account_display_name() returns trigger language plpgsql security definer set search_path=public as $$
declare display text;
begin
 display=left(nullif(trim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name','')),''),100);
 if display is not null then update workspace_members set display_name=display where user_id=new.id; end if;
 return new;
end $$;
revoke all on function public.sync_account_display_name() from public;
create trigger account_display_name after update of raw_user_meta_data on auth.users for each row execute function public.sync_account_display_name();
create or replace function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path=public as $$ declare w uuid; display text; begin
if auth.uid() is null then raise exception 'Sign in first'; end if;
select coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1)) into display from auth.users where id=auth.uid();
insert into workspaces(name) values(trim(workspace_name)) returning id into w;
insert into workspace_members values(w,auth.uid(),'owner',left(display,100));
return w; end $$;
create or replace function public.add_workspace_member(w uuid,member_email text,member_role text) returns void language plpgsql security definer set search_path=public as $$ declare u uuid; display text;begin
if public.workspace_role(w)<>'owner' or public.workspace_role(w) is null then raise exception 'Only owners can add members';end if;
if member_role not in ('member','contractor','client') then raise exception 'Choose member, contractor, or client';end if;
select id,coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1)) into u,display from auth.users where lower(email)=lower(trim(member_email));
if u is null then raise exception 'This person must create an account first';end if;
insert into workspace_members(workspace_id,user_id,role,display_name) values(w,u,member_role,left(display,100));end $$;
