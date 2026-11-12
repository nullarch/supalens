// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// process-revocations task (plain Node bundle), same convention as utils/supabase/admin.ts.
import { randomBytes } from 'crypto'

import { SupabaseManagementClient, type PoolerConfig } from './client'

/** Dedicated least-privilege read-only role supalens mints on the customer DB. */
export const READONLY_ROLE = 'supalens_ro'

/**
 * Postgres/Supabase SYSTEM & internal schemas the read-only role must NOT reach.
 * We grant on user schemas explicitly (below) rather than `pg_read_all_data`, because
 * `pg_read_all_data` also grants implicit USAGE+SELECT on these — and that CANNOT be
 * carved back out (`REVOKE USAGE ON SCHEMA vault …` emits "no privileges could be revoked").
 * Reading them leaks `vault.secrets` (secret names/ciphertext), `pgsodium` key rows,
 * `extensions.pg_stat_statements` (raw SQL text of every query → literal PII/tokens),
 * `net._http_response`, `auth.oauth_*`, etc. See docs/supabase.md §6.
 * `pg_%` (pg_catalog, pg_toast, pg_temp_*) is excluded separately via a LIKE guard.
 */
export const SYSTEM_SCHEMAS = [
  'information_schema',
  'auth',
  'storage',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'graphql',
  'graphql_public',
  'realtime',
  '_realtime',
  'supabase_functions',
  'supabase_migrations',
  'net',
  'cron',
  'pgbouncer',
  'extensions',
  '_analytics',
  '_supavisor',
] as const

/** SQL list literal, e.g. `'auth','storage',…`, for a `nspname not in (…)` filter. */
function systemSchemaList(): string {
  return SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ')
}

/**
 * A DO-loop that grants USAGE + SELECT (current tables) + default SELECT (future tables)
 * to supalens_ro on every NON-system schema. This is the structural replacement for
 * `pg_read_all_data`: it covers the user's data (incl. future tables in existing schemas
 * via ALTER DEFAULT PRIVILEGES) while leaving system schemas unreachable.
 *
 * Coverage gap (documented, mitigated by re-running on schema sync): schemas created
 * AFTER this runs are not covered until the next grant — a genuinely new user schema
 * reads as 0 rows until then. `hardenReadonlyRole` re-runs this loop idempotently.
 */
function grantUserSchemasSql(): string {
  return `
do $$
declare s text;
begin
  for s in
    select nspname from pg_namespace
    where nspname not in (${systemSchemaList()})
      and nspname not like 'pg\\_%'
  loop
    execute format('grant usage on schema %I to ${READONLY_ROLE}', s);
    execute format('grant select on all tables in schema %I to ${READONLY_ROLE}', s);
    execute format('alter default privileges in schema %I grant select on tables to ${READONLY_ROLE}', s);
  end loop;
end $$;`
}

/** Strong password using only base64url chars (no quotes/backslashes -> SQL-literal safe). */
export function generateRolePassword(): string {
  return randomBytes(36).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Create (or reset the password of) the supalens read-only role on a project's DB,
 * granting SELECT on USER schemas only (NOT `pg_read_all_data`) and forcing read-only
 * + a statement timeout. Uses the Management API SQL endpoint (no DB password needed).
 * Returns the password. See docs/supabase.md §6.
 */
export async function mintReadonlyRole(mgmt: SupabaseManagementClient, ref: string): Promise<string> {
  const password = generateRolePassword()
  // password is base64url (safe), embedded as a SQL string literal.
  const sql = `
do $$
begin
  if not exists (select from pg_roles where rolname = '${READONLY_ROLE}') then
    create role ${READONLY_ROLE} with login password '${password}';
  else
    alter role ${READONLY_ROLE} with login password '${password}';
  end if;
end $$;
${grantUserSchemasSql()}
alter role ${READONLY_ROLE} set default_transaction_read_only = on;
alter role ${READONLY_ROLE} set statement_timeout = '30s';
`
  await mgmt.runQuery(ref, sql)
  return password
}

/**
 * Re-grant user-schema SELECT to an EXISTING supalens_ro without rotating its password
 * (so stored credentials keep working). Two jobs:
 *  1. Backfill: strip a legacy `pg_read_all_data` grant (older roles were minted with it,
 *     which exposed system schemas) — harmless no-op on freshly-minted roles.
 *  2. Coverage: pick up user schemas created since the last mint.
 * Idempotent + best-effort. Safe to run on every schema sync.
 */
export async function hardenReadonlyRole(mgmt: SupabaseManagementClient, ref: string): Promise<void> {
  const sql = `
do $$
begin
  if exists (select from pg_roles where rolname = '${READONLY_ROLE}') then
    -- legacy roles were granted pg_read_all_data (reads system schemas); revoke it.
    if pg_has_role('${READONLY_ROLE}', 'pg_read_all_data', 'member') then
      revoke pg_read_all_data from ${READONLY_ROLE};
    end if;
  end if;
end $$;
${grantUserSchemasSql()}
alter role ${READONLY_ROLE} set default_transaction_read_only = on;
alter role ${READONLY_ROLE} set statement_timeout = '30s';
`
  await mgmt.runQuery(ref, sql)
}

/**
 * Drop the minted read-only role (disconnect path). Best-effort.
 * The explicit per-schema grants + ALTER DEFAULT PRIVILEGES make supalens_ro a dependency
 * of many objects, so a bare `drop role` fails ("cannot be dropped because some objects
 * depend on it"). We grant the role to the executing user so we can `DROP OWNED BY` (which
 * removes every grant + default-privilege entry, on Supabase's non-superuser postgres),
 * then drop the role. This also cleanly handles legacy `pg_read_all_data` roles.
 */
export async function dropReadonlyRole(mgmt: SupabaseManagementClient, ref: string): Promise<void> {
  const sql = `
do $$
begin
  if exists (select from pg_roles where rolname = '${READONLY_ROLE}') then
    execute format('grant ${READONLY_ROLE} to %I', current_user);
    execute 'drop owned by ${READONLY_ROLE}';
    execute 'drop role ${READONLY_ROLE}';
  end if;
end $$;`
  await mgmt.runQuery(ref, sql)
}

/**
 * Best-effort pooler/connection details for a project; returns null on failure.
 * The Management API returns one config per database — pick the PRIMARY (a read
 * replica's host would silently point every query at the replica). Tolerates a
 * bare-object response defensively in case the API shape changes.
 */
export async function fetchPoolerConfig(
  mgmt: SupabaseManagementClient,
  ref: string
): Promise<PoolerConfig | null> {
  try {
    const res = await mgmt.getPoolerConfigs(ref)
    const list = (Array.isArray(res) ? res : [res]).filter((c): c is PoolerConfig => Boolean(c))
    return list.find((c) => c.database_type === 'PRIMARY') ?? list[0] ?? null
  } catch {
    return null
  }
}
