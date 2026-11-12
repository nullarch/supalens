-- =====================================================================
-- supalens integrations: provider connections, data sources, secrets vault,
-- key hierarchy, audit & revocation. See docs/db-schema.md §4.
-- =====================================================================

-- 1. Provider connections (OAuth seam) + token rotation / reuse detection
create type provider_kind     as enum ('supabase');                  -- extend: neon, planetscale...
create type connection_status as enum ('active','revoked','error','expired','pending');

create table provider_connections (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  provider            provider_kind not null,
  external_account_id text,                          -- supabase org id
  display_name        text,
  status              connection_status not null default 'pending',
  scopes              text[],
  metadata            jsonb not null default '{}',   -- no secrets (enforced by trigger)
  -- OAuth refresh rotation / reuse detection (RFC 6819 / OAuth 2.1 BCP)
  token_family_id     uuid not null default gen_random_uuid(),
  refresh_generation  int  not null default 0,
  prev_refresh_hash   text,                           -- base64 sha256(previous refresh)
  token_refreshed_at  timestamptz,
  reuse_detected_at   timestamptz,
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (id, org_id)                                 -- composite FK backing
);
-- one live connection per (org, provider, account); soft-deleted rows don't squat the tuple
create unique index provider_connections_account_live on provider_connections (org_id, provider, external_account_id)
  where deleted_at is null and external_account_id is not null;
-- prevent duplicate pending OAuth handshakes (external_account_id still null)
create unique index pc_pending_uq on provider_connections (org_id, provider)
  where external_account_id is null and status = 'pending';
create index provider_connections_active_idx on provider_connections (org_id) where status = 'active';
create trigger trg_pc_upd before update on provider_connections
  for each row execute function app.set_updated_at();

-- 2. Data sources (polymorphic + JSONB config) ---------------------------
create type ds_engine   as enum ('postgres','mysql');                 -- wire protocol / driver
create type ds_provider as enum ('supabase','self_hosted','rds','neon','planetscale','generic');
create type ds_status   as enum ('pending','active','error','disabled');

create table data_sources (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  connection_id       uuid,                            -- null for direct DBs
  name                text not null,
  engine              ds_engine not null,
  provider            ds_provider not null default 'generic',
  config              jsonb not null default '{}',     -- NON-secret: host/port/db/ssl/pooler_mode/project_ref/region
  status              ds_status not null default 'pending',
  last_connected_at   timestamptz,
  last_error_code     text,                            -- normalized code (no raw)
  last_error_redacted text,                            -- message after DSN/password scrub
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (id, org_id),                                 -- composite FK backing
  -- supabase provider MUST have an OAuth connection
  constraint ds_supabase_requires_conn
    check (provider <> 'supabase' or connection_id is not null),
  -- only same-org connection (block cross-tenant). Destructive -> RESTRICT.
  constraint data_sources_connection_fk
    foreign key (connection_id, org_id)
    references provider_connections (id, org_id) on delete restrict
);
create unique index data_sources_org_name_live on data_sources (org_id, name) where deleted_at is null;
create index data_sources_connection_idx on data_sources (connection_id);
create index data_sources_active_idx on data_sources (org_id) where status = 'active' and deleted_at is null;
create trigger trg_ds_upd before update on data_sources
  for each row execute function app.set_updated_at();

-- defense-in-depth: reject credential-bearing keys in non-secret JSONB.
-- Generic over the column name (passed as a trigger arg) via to_jsonb(new) so the
-- same function works for tables with different column sets.
create or replace function app.reject_secret_keys()
returns trigger language plpgsql as $$
declare col text := tg_argv[0];
        doc jsonb;
begin
  doc := coalesce(to_jsonb(new) -> col, '{}'::jsonb);
  if exists (
    select 1 from jsonb_object_keys(doc) k
    where lower(k) ~ '(password|secret|token|service_role|private_key|credential|connection_string|dsn)'
  ) then
    raise exception 'secret-like key in non-secret jsonb (table=%, column=%)', tg_table_name, col;
  end if;
  return new;
end $$;
create trigger ds_config_guard before insert or update on data_sources
  for each row execute function app.reject_secret_keys('config');
create trigger pc_meta_guard before insert or update on provider_connections
  for each row execute function app.reject_secret_keys('metadata');

-- 3. Key hierarchy: per-tenant DEK (KEK lives in external KMS/IAM) --------
create table data_encryption_keys (
  id           text primary key,                       -- dek_id (KMS / logical id)
  org_id       uuid not null references organizations(id) on delete restrict,
  wrapped_dek  text not null,                           -- base64 DEK wrapped by the KEK
  kek_provider text not null,                           -- 'local' | 'gcp_kms' | 'aws_kms'
  kek_uri      text not null,                           -- KEK resource identifier
  algo         text not null default 'aes-256-gcm',
  state        text not null default 'active'
               check (state in ('active','rotating','retired','destroyed')),
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,
  destroyed_at timestamptz,
  unique (org_id, id)
);
-- exactly one ACTIVE DEK per tenant (makes the app's race-recovery deterministic)
create unique index dek_one_active_per_org on data_encryption_keys (org_id) where state = 'active';
-- The KEK that unwraps wrapped_dek lives in KMS and needs *separate* IAM the DB
-- role does not hold; unwrap is an API call, not a column read.

-- 4. Secrets vault (envelope encryption, server-only) --------------------
create type secret_kind   as enum ('db_password','oauth_refresh_token','ssl_client_key',
                                   'provisioning_service_role'); -- one-shot provisioning, shred immediately
create type secret_status as enum ('active','revoked','expired','compromised');

create table secrets (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  data_source_id   uuid,
  connection_id    uuid,
  kind             secret_kind not null,
  ciphertext       text not null,                       -- base64 AES-256-GCM(payload); tag appended
  dek_id           text  not null references data_encryption_keys (id),
  nonce            text not null,                       -- base64 96-bit random, unique per DEK
  algo             text  not null default 'aes-256-gcm',
  aad_version      smallint not null default 1,         -- AAD = (id || org_id || kind || dek_id)
  is_current       boolean not null default true,
  version          int     not null default 1,          -- value-rotation counter (separate from key rotation)
  status           secret_status not null default 'active',
  expires_at       timestamptz,
  not_after        timestamptz,                          -- refresh-token expiry / idle revoke boundary
  last_accessed_at timestamptz,
  access_count     bigint not null default 0,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  rotated_at       timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text,
  -- exactly one parent
  check (num_nonnulls(data_source_id, connection_id) = 1),
  -- kind <-> parent must match
  check (
    (kind in ('db_password','ssl_client_key','provisioning_service_role')
       and data_source_id is not null and connection_id is null)
    or
    (kind = 'oauth_refresh_token'
       and connection_id is not null and data_source_id is null)
  ),
  -- enforce same org (block cross-tenant ciphertext swap). Custody rows -> RESTRICT.
  constraint secrets_ds_fk
    foreign key (data_source_id, org_id)
    references data_sources (id, org_id) on delete restrict,
  constraint secrets_conn_fk
    foreign key (connection_id, org_id)
    references provider_connections (id, org_id) on delete restrict
);
-- single current secret per (parent, kind); rotation = insert new + flip old in one tx
create unique index secrets_current_ds   on secrets (data_source_id, kind)
  where is_current and data_source_id is not null;
create unique index secrets_current_conn on secrets (connection_id, kind)
  where is_current and connection_id is not null;
create index secrets_org_idx  on secrets (org_id);
create index secrets_ds_idx   on secrets (data_source_id);
create index secrets_conn_idx on secrets (connection_id);
create trigger trg_secrets_upd before update on secrets
  for each row execute function app.set_updated_at();

-- 5. Secret access log (append-only reveal audit) ------------------------
create table secret_access_log (
  id         bigint generated always as identity primary key,
  secret_id  uuid references secrets(id) on delete cascade,
  org_id     uuid not null,
  action     text not null check (action in ('create','reveal','rotate','revoke','rewrap')),
  actor_kind text not null check (actor_kind in ('user','mcp_token','api_key','system')),
  actor_id   text,
  purpose    text,
  request_id text,
  source_ip  inet,
  prev_hash  text,                                      -- optional hash-chain tamper-evidence (base64)
  at         timestamptz not null default now()
);

-- 6. supalens own keys / issued MCP tokens = one-way hash (verify-only) ---
create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  kind         text not null default 'sl_api_key'
               check (kind in ('sl_api_key','mcp_access_token','mcp_refresh_token')),
  prefix       text not null,                            -- non-secret lookup prefix
  token_hash   text not null,                            -- base64 sha256/HMAC(server pepper)
  last_four    text,
  scopes       text[] not null default '{}',
  created_by   uuid references profiles(id) on delete set null,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (token_hash)
);
create index api_keys_prefix_idx on api_keys (prefix);
create index api_keys_org_idx on api_keys (org_id);

-- 7. Credential revocation outbox (reliable upstream revoke) -------------
create table credential_revocations (
  id            uuid primary key default gen_random_uuid(),
  secret_id     uuid,
  connection_id uuid,
  org_id        uuid not null,
  kind          text not null,                           -- 'oauth_grant' | 'minted_db_role' | 'dek_shred'
  status        text not null default 'pending' check (status in ('pending','done','failed')),
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index cred_revocations_pending_idx on credential_revocations (status) where status = 'pending';

-- 8. General audit log ---------------------------------------------------
create table audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references organizations(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  actor_kind text not null default 'user',
  action     text not null,                              -- e.g. 'data_source.create'
  entity     text not null,
  entity_id  uuid,
  diff       jsonb,                                       -- no secrets
  request_id text,
  source_ip  inet,
  at         timestamptz not null default now()
);
create index audit_log_org_at_idx on audit_log (org_id, at desc);

-- 9. Schema introspection cache (MCP get_schema read path) ---------------
create type introspection_status as enum ('pending','syncing','fresh','stale','failed');
create table data_source_schemas (
  data_source_id uuid primary key references data_sources(id) on delete cascade,
  status         introspection_status not null default 'pending',
  synced_at      timestamptz,
  content_hash   text,
  object_count   int,
  error          text,
  updated_at     timestamptz not null default now()
);
create trigger trg_dss_upd before update on data_source_schemas
  for each row execute function app.set_updated_at();

create table data_source_objects (
  id               uuid primary key default gen_random_uuid(),
  data_source_id   uuid not null references data_sources(id) on delete cascade,
  schema_name      text not null,
  object_name      text not null,
  object_type      text not null,                         -- 'table'|'view'|'matview'
  columns          jsonb not null,
  primary_key      text[],
  approx_row_count bigint,                                 -- volatile stats refreshed separately
  stats_synced_at  timestamptz,
  introspected_at  timestamptz not null default now(),
  unique (data_source_id, schema_name, object_name)
);
