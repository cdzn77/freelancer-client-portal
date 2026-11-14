-- Add a provider only. Existing access policies and path restrictions remain intact.
alter table public.project_files drop constraint project_files_provider_check;
alter table public.project_files add constraint project_files_provider_check
 check (provider in ('supabase','minio','r2','dropbox'));
alter table public.trash_file_cleanup drop constraint trash_file_cleanup_provider_check;
alter table public.trash_file_cleanup add constraint trash_file_cleanup_provider_check
 check (provider in ('supabase','minio','r2','dropbox'));
