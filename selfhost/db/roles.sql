-- Give the service roles the stack actually uses the generated database password.
-- Adapted from the Supabase self-hosting kit (docker/volumes/db/roles.sql, Apache-2.0): only the
-- roles this stack runs are listed. A role that does not exist would abort the image's init
-- sequence here and leave the database half set up.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
