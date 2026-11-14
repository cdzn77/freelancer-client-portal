-- Private staging avoids serverless binary payload limits. Nothing here is client-readable.
alter table collaboration_blobs drop constraint collaboration_blobs_size_check;
alter table collaboration_blobs add constraint collaboration_blobs_size_check check(size between 1 and 26214400);
alter table collaboration_blobs add column upload_claimed_at timestamptz;
alter table collaboration_blobs add column upload_staged boolean not null default false;
insert into storage.buckets(id,name,public,file_size_limit) values('collaboration-staging','collaboration-staging',false,26214400);
notify pgrst,'reload schema';
