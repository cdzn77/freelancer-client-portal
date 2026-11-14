#!/bin/sh
set -eu
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'create table if not exists public.pms_schema_migrations(name text primary key, applied_at timestamptz default now()); alter table public.pms_schema_migrations enable row level security;'
for migration in supabase/migrations/*.sql; do
 name=$(basename "$migration")
 applied=$(docker compose exec -T db psql -U postgres -d postgres -tAc "select count(*) from public.pms_schema_migrations where name='$name'")
 if [ "$applied" = "0" ]; then
  { printf 'BEGIN;\n'; cat "$migration"; printf "\nINSERT INTO public.pms_schema_migrations(name) VALUES ('%s');\nCOMMIT;\n" "$name"; } | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1
 fi
done
docker compose exec -T db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
