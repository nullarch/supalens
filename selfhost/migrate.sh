#!/bin/sh
# Apply supabase/migrations/*.sql in order, once each. Runs as the one-shot `migrate` service
# before the app starts, on first install and on every upgrade.
#
# Applied versions are recorded in supabase_migrations.schema_migrations — the table the Supabase
# CLI uses — so a database set up here can later be managed with `supabase db push` as well.
set -eu

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

applied=0
for file in /migrations/*.sql; do
  [ -e "$file" ] || continue
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}
  case "$version" in
    *[!0-9]*|'') echo "migrate: skipping $base (no numeric version prefix)"; continue ;;
  esac
  if [ "$(psql -tAq -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = "1" ]; then
    continue
  fi
  echo "migrate: applying $base"
  # the file and its bookkeeping row commit together, or not at all
  psql -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  applied=$((applied + 1))
done

# PostgREST caches the schema; tell a running instance to re-read it
psql -q -c "notify pgrst, 'reload schema'" || true
echo "migrate: done ($applied applied)"
