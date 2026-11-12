# supalens 데이터베이스 스키마 설계 (최종 하드닝본)

> 대상: supalens 자체 백엔드(Supabase Postgres + RLS + `auth.users`). 멀티테넌트 SaaS로서 사용자의 외부 DB(Supabase OAuth, 직접 MySQL/Postgres)에 연결해 analytics/observability를 제공한다. 본 문서는 BASELINE에 3개 리뷰(보안/시크릿, 멀티테넌시/RLS, 데이터 모델링/확장성)를 반영해 충돌을 결정으로 정리한 production-grade 확정본이다.

---

## 1. 이 구조 괜찮은가?

**YES — 방향은 정확하다.** `org → provider_connection → data_source → secret`로 내려가는 4단 추상화는 업계 표준과 일치한다. Grafana는 `data_source` + `jsonData`(비밀 아님)/`secureJsonData`(암호화) 분리를, Metabase는 `database` + `engine` + `details` JSON을, Airbyte는 `source_definition`(커넥터 카탈로그) + `configuration` JSON을 사용한다 — 즉 "폴리모픽 단일 테이블 + JSONB config + 시크릿 분리"는 다수 커넥터를 다루는 도구의 정답이다. 우리가 여기에 더한 핵심 정제 3가지는 (1) **engine(와이어 프로토콜/드라이버) ↔ provider(브랜드)를 분리**해 옛 `source_type` 단일 enum의 개념 혼동을 제거했고, (2) **`provider_connections`를 OAuth seam으로 도입**해 "1 Supabase org OAuth → N project DB"라는 현실을 정확히 모델링(직접 DB는 `connection_id` null)했으며, (3) **`secrets`를 `config`에서 물리적으로 분리하고 KMS 봉투(envelope) 암호화 + 테넌트별 DEK**로 보관해 옛 prod의 평문 토큰/평문 per-org API 키 설계를 폐기했다. 단, 리뷰가 일치하여 지적했듯 BASELINE 그대로는 안전하지 않다 — RLS 부재, 암호문의 행 바인딩(AAD) 부재, DEK 키 계층 부재, 리프레시 토큰 회전 동시성/재사용 탐지 부재, reveal 감사 부재가 치명적이며 본 확정본에서 모두 닫는다.

---

## 2. 개념 모델 (텍스트 ERD)

```
auth.users (1)──(1) profiles
                     │
                     │ (member)
                     ▼
organizations ──<  organization_members  >── profiles
     │  (1:N)
     ├──< provider_connections        (OAuth 계정 1개 = seam)
     │         │ (1:N, connection_id nullable)
     │         ▼
     ├──<  data_sources  >── (composite same-org FK) ── provider_connections
     │         │ (1:N)
     │         ├──< data_source_endpoints      (pooler/replica)   [선택]
     │         ├──  data_source_schemas (1:1)  ──< data_source_objects  [선택, 스키마 캐시]
     │         │
     │         ▼
     ├──<  secrets  >── data_encryption_keys (dek_id FK)
     │         │
     │         ├──< secret_access_log          (append-only reveal 감사)
     │
     ├──< data_encryption_keys                 (테넌트별 DEK, KEK은 외부 KMS)
     ├──< api_keys                             (sl_ 키 / MCP 토큰 = 단방향 해시)
     ├──< credential_revocations               (upstream 폐기 outbox)
     └──< audit_log                            (일반 변경 감사)
```

| 엔티티 | 한 줄 역할 |
|---|---|
| `organizations` | 테넌트 경계의 루트. 모든 하위 테이블의 `org_id` 소유자. |
| `profiles` | `auth.users` 미러. 전역(글로벌) 식별자, org_id 없음. |
| `organization_members` | profile ↔ org 다대다 + 역할(owner/admin/member/viewer). RLS 멤버십의 기준. |
| `provider_connections` | 외부 **계정**(주로 Supabase org)으로의 인증된 OAuth 링크 = seam. 토큰 패밀리/재사용 탐지 상태 보유. |
| `data_sources` | 읽을 수 있는 모든 DB에 대한 폴리모픽 추상화. `engine`+`provider`+JSONB `config`. org 소유. |
| `secrets` | 봉투 암호화된 가역 시크릿(refresh token, db_password). config에서 분리, 서버 전용. |
| `data_encryption_keys` | 테넌트별 DEK(래핑된 상태로 저장). 풀기용 KEK은 외부 KMS/IAM. crypto-shred 단위. |
| `secret_access_log` | reveal/rotate/revoke의 append-only 감사 로그. |
| `api_keys` | supalens 자체 `sl_` 키 및 발급 MCP 토큰 = 단방향 해시(검증 전용). |
| `credential_revocations` | 연결 해제 시 upstream(OAuth revoke + DROP role + crypto-shred) 신뢰성 outbox. |
| `audit_log` | 일반 엔티티 변경 감사(생성/수정/삭제). |
| `data_source_schemas`/`_objects` | 스키마 인트로스펙션 캐시(MCP `get_schema`의 핵심 read path). 선택. |

---

## 3. 핵심 설계 결정

| 결정 | 이유 | 대안 기각 이유 |
|---|---|---|
| **engine(와이어/드라이버) ↔ provider(브랜드) 분리** | 라우팅은 와이어 프로토콜(`postgres`/`mysql`)로, UX/제약은 브랜드(`supabase`/`rds`/`neon`…)로 결정된다. 옛 `source_type` 단일 enum은 둘을 섞어 `mariadb` 같은 값에서 드라이버/브랜드 판단이 불가능했다. | 단일 enum 유지 시 같은 브랜드의 복수 transport(supabase wire vs management API)를 표현 불가. |
| **단일 폴리모픽 `data_sources` + JSONB `config`** (CTI 아님) | Metabase `details`/Grafana `jsonData`/Airbyte `configuration`와 동일. 커넥터가 늘어도 마이그레이션/조인이 폭발하지 않는다. `host/port`가 없는 warehouse도 JSONB가 흡수. | table-per-type(CTI)은 커넥터마다 테이블·마이그레이션·조인 증가. 단, JSON Schema 검증(`connectors.config_schema` 또는 앱단)으로 무검증 JSONB의 위험을 보완. |
| **`provider_connections`를 OAuth seam으로, 직접 DB는 `connection_id` null** | "1 OAuth 계정 → N project DB"는 실제 Supabase 구조 그대로다. 직접 Postgres는 상위 계정이 없으므로 null이 정답. | 직접 DB마다 가짜 connection을 합성하면 over-engineering. nullable이 올바른 모델. |
| **`secrets` 분리 + KMS 봉투 암호화(테넌트별 DEK)** | 멀티테넌트 자격증명 수탁(custody)에서는 한 테넌트 유출이 다른 테넌트 복호로 번지면 안 된다. 테넌트별 DEK + 외부 KEK이 crypto-shred와 KEK 격리를 보장. | Supabase Vault/pgsodium은 키가 **프로젝트 단위**(supalens 자기 것) → 테넌트 암호학적 격리 불가. Vault는 supalens 자체 인프라 시크릿(웹훅 서명키 등) 전용으로 한정. |
| **커넥터 분류: 현 단계 enum, 확장 시 `connector_definition` 승격** | v1 커넥터 집합(supabase/postgres/mysql)은 소수·안정적 → enum이 명시적이고 제약 가능. | enum은 `ALTER TYPE ADD VALUE`가 트랜잭션 밖이라 마이그레이션 마찰이 크다. BigQuery/Snowflake 등 churn 시작 시 즉시 `connectors` 카탈로그(dialect/transport/auth_methods/config_schema/secret_kinds)로 승격. status/role enum은 그대로 유지(진짜 닫힌 집합). |
| **시크릿/리소스는 org 소유(유저 아님)** | 대시보드·위젯·알럿이 org 멤버 전체에 공유되므로 data_source는 org에 속해야 한다. `created_by`는 nullable 귀속만. | 유저 소유 시 멤버 탈퇴/삭제로 공유 리소스가 사라짐. |
| **자기 키(`sl_`/MCP 토큰)는 해시, 외부 DB 자격증명은 암호화** | 전자는 검증 전용(reveal 불필요) → 단방향 해시가 정답. 후자는 사용을 위해 가역 필요. | 자기 키를 가역 암호화하면 불필요한 평문 복원 경로. 옛 prod는 평문 동등비교 — 폐기. |
| **하드 삭제 대신 soft-revoke + 폐기 outbox** | `ON DELETE CASCADE`로 secret 행만 지우면 고객 인프라의 라이브 자격증명(OAuth grant, 민트된 RO role)이 추적 불가 상태로 살아남는다(leak-by-deletion). | 즉시 cascade는 upstream 폐기를 건너뜀. revoke 완료 후에만 물리 삭제. |

> 플래그(채택 보류): `data_source_endpoints`(pooler/replica 별도 테이블)와 풀 `connectors` 카탈로그는 올바른 방향이지만 v1 단일 엔드포인트에선 over-engineering 소지. pooler/replica가 실제 필요해지는 시점에 승격(YAGNI 게이트). 본 DDL에는 선택 섹션으로만 포함.

---

## 4. 전체 DDL (Postgres / Supabase)

```sql
-- =====================================================================
-- 0. extensions & helper schema (RLS 헬퍼는 PostgREST 비노출 스키마에)
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists app;          -- RLS 헬퍼/내부 함수 전용 (API 미노출)

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- =====================================================================
-- 1. Tenancy
-- =====================================================================
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index organizations_slug_live on organizations (slug) where deleted_at is null;
create trigger trg_org_upd before update on organizations
  for each row execute function app.set_updated_at();

create table profiles (                    -- mirrors auth.users
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create type org_role as enum ('owner','admin','member','viewer');
create table organization_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       org_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on organization_members (user_id); -- 'find my orgs'
create trigger trg_om_upd before update on organization_members
  for each row execute function app.set_updated_at();

-- =====================================================================
-- 2. Provider connections (OAuth seam) + 토큰 패밀리/재사용 탐지
-- =====================================================================
create type provider_kind     as enum ('supabase');                  -- 확장: neon, planetscale...
create type connection_status as enum ('active','revoked','error','expired','pending');

create table provider_connections (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  provider            provider_kind not null,
  external_account_id text,                      -- supabase org id
  display_name        text,
  status              connection_status not null default 'pending',
  scopes              text[],
  metadata            jsonb not null default '{}', -- 비밀 금지(트리거로 강제)
  -- OAuth refresh 회전 / 재사용 탐지 상태 (RFC 6819 / OAuth 2.1 BCP)
  token_family_id     uuid not null default gen_random_uuid(),
  refresh_generation  int  not null default 0,
  prev_refresh_hash   bytea,                      -- sha256(직전 refresh)
  token_refreshed_at  timestamptz,
  reuse_detected_at   timestamptz,
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (id, org_id),                            -- composite FK 백킹
  unique (org_id, provider, external_account_id)
);
-- pending OAuth 핸드셰이크 중복 방지(external_account_id 아직 null)
create unique index pc_pending_uq on provider_connections (org_id, provider)
  where external_account_id is null and status = 'pending';
create index provider_connections_active_idx on provider_connections (org_id) where status = 'active';
create trigger trg_pc_upd before update on provider_connections
  for each row execute function app.set_updated_at();

-- =====================================================================
-- 3. Data sources (폴리모픽 + JSONB config)
-- =====================================================================
create type ds_engine   as enum ('postgres','mysql');                 -- 와이어 프로토콜/드라이버
create type ds_provider as enum ('supabase','self_hosted','rds','neon','planetscale','generic');
create type ds_status   as enum ('pending','active','error','disabled');

create table data_sources (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  connection_id     uuid,                          -- 직접 DB는 null
  name              text not null,
  engine            ds_engine not null,
  provider          ds_provider not null default 'generic',
  config            jsonb not null default '{}',   -- 비밀 아님: host/port/db/ssl/pooler_mode/project_ref/region
  status            ds_status not null default 'pending',
  last_connected_at timestamptz,
  last_error_code     text,                        -- 정규화 코드 (raw 금지)
  last_error_redacted text,                        -- DSN/password 스크럽 후 메시지
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (id, org_id),                             -- composite FK 백킹
  -- supabase provider는 반드시 OAuth connection이 있어야 함
  constraint ds_supabase_requires_conn
    check (provider <> 'supabase' or connection_id is not null),
  -- 같은 org의 connection만 참조 (cross-tenant 차단). 연결은 destructive하므로 RESTRICT.
  constraint data_sources_connection_fk
    foreign key (connection_id, org_id)
    references provider_connections (id, org_id) on delete restrict
);
create unique index data_sources_org_name_live on data_sources (org_id, name) where deleted_at is null;
create index data_sources_connection_idx on data_sources (connection_id);
create index data_sources_active_idx on data_sources (org_id) where status = 'active' and deleted_at is null;
create trigger trg_ds_upd before update on data_sources
  for each row execute function app.set_updated_at();

-- config/metadata에 비밀 유입 거부 (defense-in-depth)
create or replace function app.reject_secret_keys()
returns trigger language plpgsql as $$
declare doc jsonb;
begin
  doc := coalesce(case TG_TABLE_NAME when 'data_sources' then NEW.config
                                     else NEW.metadata end, '{}'::jsonb);
  if exists (select 1 from jsonb_object_keys(doc) k
             where lower(k) ~ '(password|secret|token|service_role|private_key|credential|connection_string|dsn)') then
    raise exception 'secret-like key in non-secret jsonb (table=%)', TG_TABLE_NAME;
  end if;
  return NEW;
end $$;
create trigger ds_config_guard before insert or update on data_sources
  for each row execute function app.reject_secret_keys();
create trigger pc_meta_guard before insert or update on provider_connections
  for each row execute function app.reject_secret_keys();

-- =====================================================================
-- 4. Key hierarchy: 테넌트별 DEK (KEK은 외부 KMS/IAM)
-- =====================================================================
create table data_encryption_keys (
  id           text primary key,                  -- dek_id (KMS/논리 식별자)
  org_id       uuid not null references organizations(id) on delete restrict,
  wrapped_dek  bytea not null,                     -- KEK으로 래핑된 DEK
  kek_provider text not null,                      -- 'gcp_kms' | 'aws_kms'
  kek_uri      text not null,                      -- KEK 리소스 식별자
  algo         text not null default 'aes-256-gcm',
  state        text not null default 'active'
               check (state in ('active','rotating','retired','destroyed')),
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,
  destroyed_at timestamptz,
  unique (org_id, id)
);
-- 핵심: wrapped_dek를 푸는 KEK은 GCP/AWS KMS에 있고, DB role이 갖지 않은 *별도 IAM*을 요구한다.
-- unwrap은 컬럼 읽기가 아니라 API 호출이다. 따라서 service-role 유출/SQLi만으로는 평문 복호 불가.

-- =====================================================================
-- 5. Secrets vault (봉투 암호화, 서버 전용)
-- =====================================================================
create type secret_kind   as enum ('db_password','oauth_refresh_token','ssl_client_key',
                                   'provisioning_service_role'); -- 일회성 프로비저닝, 즉시 shred
create type secret_status as enum ('active','revoked','expired','compromised');

create table secrets (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  data_source_id uuid,
  connection_id  uuid,
  kind           secret_kind not null,
  ciphertext     bytea not null,                  -- AES-256-GCM(payload), tag는 ciphertext에 append
  dek_id         text  not null references data_encryption_keys (id),
  nonce          bytea not null,                  -- 96-bit random, dek당 유일
  algo           text  not null default 'aes-256-gcm',
  aad_version    smallint not null default 1,     -- AAD = (id || org_id || kind || dek_id)
  is_current     boolean not null default true,
  version        int     not null default 1,      -- 값 회전 카운터 (키 회전과 분리)
  status         secret_status not null default 'active',
  expires_at     timestamptz,
  not_after      timestamptz,                      -- refresh 토큰 만료/유휴 폐기 경계
  last_accessed_at timestamptz,
  access_count   bigint not null default 0,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  rotated_at     timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  -- 정확히 하나의 부모
  check (num_nonnulls(data_source_id, connection_id) = 1),
  -- kind ↔ 부모 일치 (db_password는 source, oauth_refresh는 connection)
  check (
    (kind in ('db_password','ssl_client_key','provisioning_service_role')
       and data_source_id is not null and connection_id is null)
    or
    (kind = 'oauth_refresh_token'
       and connection_id is not null and data_source_id is null)
  ),
  -- 같은 org 강제 (cross-tenant 암호문 스왑 방지). custody 행이므로 RESTRICT.
  constraint secrets_ds_fk
    foreign key (data_source_id, org_id)
    references data_sources (id, org_id) on delete restrict,
  constraint secrets_conn_fk
    foreign key (connection_id, org_id)
    references provider_connections (id, org_id) on delete restrict
);
-- 부모+kind당 단일 current (회전: 새 행 insert + 옛 행 is_current=false, 한 트랜잭션)
create unique index secrets_current_ds   on secrets (data_source_id, kind)
  where is_current and data_source_id is not null;
create unique index secrets_current_conn on secrets (connection_id, kind)
  where is_current and connection_id is not null;
create index secrets_org_idx  on secrets (org_id);
create index secrets_ds_idx   on secrets (data_source_id);
create index secrets_conn_idx on secrets (connection_id);
create trigger trg_secrets_upd before update on secrets
  for each row execute function app.set_updated_at();

-- =====================================================================
-- 6. Secret access log (append-only reveal 감사)
-- =====================================================================
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
  prev_hash  bytea,                               -- 선택: 해시 체인 tamper-evidence
  at         timestamptz not null default now()
);
-- 메타데이터만 기록(평문/암호문 금지). 클라이언트 UPDATE/DELETE 차단.
revoke update, delete on secret_access_log from public, anon, authenticated;

-- =====================================================================
-- 7. supalens 자기 키 / 발급 MCP 토큰 = 단방향 해시 (검증 전용)
-- =====================================================================
create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  kind        text not null default 'sl_api_key'
              check (kind in ('sl_api_key','mcp_access_token','mcp_refresh_token')),
  prefix      text not null,                       -- 비밀 아닌 조회용 접두사
  token_hash  bytea not null,                      -- sha256/HMAC(server pepper)
  last_four   text,
  scopes      text[] not null default '{}',
  created_by  uuid references profiles(id) on delete set null,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (token_hash)
);
create index api_keys_prefix_idx on api_keys (prefix);
create index api_keys_org_idx on api_keys (org_id);

-- =====================================================================
-- 8. Credential revocation outbox (upstream 폐기 신뢰성)
-- =====================================================================
create table credential_revocations (
  id            uuid primary key default gen_random_uuid(),
  secret_id     uuid,
  connection_id uuid,
  org_id        uuid not null,
  kind          text not null,                     -- 'oauth_grant' | 'minted_db_role' | 'dek_shred'
  status        text not null default 'pending' check (status in ('pending','done','failed')),
  attempts      int not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index cred_revocations_pending_idx on credential_revocations (status) where status = 'pending';

-- =====================================================================
-- 9. 일반 audit_log
-- =====================================================================
create table audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references organizations(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  actor_kind text not null default 'user',
  action     text not null,                        -- 'data_source.create' 등
  entity     text not null,
  entity_id  uuid,
  diff       jsonb,                                -- 비밀 금지
  request_id text,
  source_ip  inet,
  at         timestamptz not null default now()
);
create index audit_log_org_at_idx on audit_log (org_id, at desc);

-- =====================================================================
-- 10. (선택) 스키마 인트로스펙션 캐시 — MCP get_schema 핵심 read path
-- =====================================================================
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
  id              uuid primary key default gen_random_uuid(),
  data_source_id  uuid not null references data_sources(id) on delete cascade,
  schema_name     text not null,
  object_name     text not null,
  object_type     text not null,                   -- 'table'|'view'|'matview'
  columns         jsonb not null,
  primary_key     text[],
  approx_row_count bigint,                          -- 휘발 통계는 구조와 분리 갱신
  stats_synced_at timestamptz,
  introspected_at timestamptz not null default now(),
  unique (data_source_id, schema_name, object_name)
);
```

### 4.1 리프레시 토큰 회전 (애플리케이션 트랜잭션 패턴)

```sql
-- 서버리스 다중 인스턴스에서 동일 토큰으로 동시 refresh 경쟁 방지: advisory lock + CAS
begin;
select pg_advisory_xact_lock(hashtextextended(:connection_id::text, 0));

-- 이미 다른 인스턴스가 회전했는지 확인 (CAS)
update secrets
   set ciphertext = :new_ct, nonce = :new_nonce,
       version = version + 1, rotated_at = now()
 where id = :secret_id and version = :expected_version
returning id;
-- 0 rows => peer가 이미 회전함: 재조회 후 새 토큰 사용 (Supabase 재호출 금지)

-- 회전 성공 시 패밀리/세대 갱신 + 직전 해시 보관
update provider_connections
   set refresh_generation = refresh_generation + 1,
       prev_refresh_hash  = :sha256_old_refresh,
       token_refreshed_at = now()
 where id = :connection_id;
commit;
```
> 토큰 엔드포인트가 `invalid_grant`를 반환하면 에러가 아니라 **"peer가 회전함"** 으로 처리(재조회). 제시된 refresh 해시가 이미 진행된 세대의 `prev_refresh_hash`와 일치하면 **재사용(도난) 신호** → `reuse_detected_at=now()`, `status='revoked'`, 패밀리 전체 upstream 폐기를 `credential_revocations`에 enqueue.

---

## 5. RLS 정책

원칙: **deny-by-default + 멤버십 기반 org 격리.** Next.js 서버 액션은 user JWT(`authenticated`)로 RLS를 강제 경계로 통과한다. FastAPI 워커/MCP 서버는 `service_role`(BYPASSRLS)로 동작하되 앱 코드에서 명시적 `org_id` 필터를 belt-and-suspenders로 유지한다. **`secrets`는 RLS로 클라이언트 접근을 전면 차단** — `authenticated`/`anon`에 정책을 일절 주지 않고, 오직 `service_role` 또는 SECURITY DEFINER `checkout_secret()` RPC만 닿는다.

```sql
-- 1) 전 테이블 RLS on
alter table organizations         enable row level security;
alter table profiles              enable row level security;
alter table organization_members  enable row level security;
alter table provider_connections  enable row level security;
alter table data_sources          enable row level security;
alter table secrets               enable row level security;
alter table data_encryption_keys  enable row level security;
alter table api_keys              enable row level security;
alter table secret_access_log     enable row level security;
alter table audit_log             enable row level security;

-- 2) 시크릿/키 계열: 클라이언트 전면 차단 (정책 없음 = deny, service_role만 bypass)
revoke all on secrets, data_encryption_keys, secret_access_log, api_keys,
              credential_revocations
  from anon, authenticated;
-- anon은 모든 테넌트 테이블에서도 차단
revoke all on organizations, organization_members, provider_connections,
              data_sources, profiles
  from anon;

-- 3) RLS 헬퍼 (재귀 회피: SECURITY DEFINER로 멤버십 테이블 자체 정책 우회, search_path 고정)
create or replace function app.current_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.organization_members where user_id = (select auth.uid())
$$;
create or replace function app.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any(p_roles)
  )
$$;

-- 4) 읽기 정책 (멤버, soft-delete 제외)
create policy org_sel on organizations for select to authenticated
  using (id in (select app.current_org_ids()) and deleted_at is null);
create policy om_sel on organization_members for select to authenticated
  using (org_id in (select app.current_org_ids()));
create policy pc_sel on provider_connections for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);
create policy ds_sel on data_sources for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);
create policy prof_sel on profiles for select to authenticated
  using (id = (select auth.uid()));

-- 5) 쓰기 정책 (WITH CHECK으로 다른 org로의 행 이동 차단 + 역할 게이트)
create policy ds_write on data_sources for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));
create policy pc_write on provider_connections for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin']::org_role[]));

-- 6) 최소권한 reveal 경로: 직접 SELECT 금지, SECURITY DEFINER RPC만 허용
create or replace function app.checkout_secret(
  p_secret_id uuid, p_purpose text, p_request_id text
) returns table(ciphertext bytea, dek_id text, nonce bytea, algo text, aad_version smallint)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select s.org_id into v_org from public.secrets s where s.id = p_secret_id and s.status = 'active';
  if v_org is null then raise exception 'secret not found or inactive'; end if;
  -- 호출자 멤버십/역할 검증은 service 전용 role 컨텍스트에서 수행 (앱이 actor 주입)
  insert into public.secret_access_log(secret_id, org_id, action, actor_kind, actor_id, purpose, request_id)
    values (p_secret_id, v_org, 'reveal', 'system', current_user, p_purpose, p_request_id);
  update public.secrets set last_accessed_at = now(), access_count = access_count + 1
    where id = p_secret_id;
  return query
    select s.ciphertext, s.dek_id, s.nonce, s.algo, s.aad_version
    from public.secrets s where s.id = p_secret_id and s.status = 'active';
end $$;
revoke all on function app.checkout_secret(uuid,text,text) from public, anon, authenticated;
```
> `checkout_secret()`는 암호문/DEK 식별자만 반환한다. 앱은 그 뒤 **외부 KMS(별도 IAM)** 로 `wrapped_dek`를 unwrap → AAD=`(id||org_id||kind||dek_id)`로 복호한다. 행이 이동/변조되면 AAD 검증 실패로 복호가 거부된다 — cut-and-paste/cross-tenant 스왑 방어.

---

## 6. Supabase 매핑 예시

### 6.1 Supabase OAuth (1 organization → N data_sources)

```text
connect 흐름:
  1) org "Acme"가 Supabase OAuth 동의 → provider_connections 1행
       { provider:'supabase', external_account_id:'<supabase_org_id>', status:'active',
         token_family_id, refresh_generation:0 }
  2) refresh token → secrets 1행
       { connection_id:<conn>, kind:'oauth_refresh_token', is_current:true,
         ciphertext:AEAD(refresh, AAD=id||org||kind||dek), dek_id:<acme_dek> }
       (access token은 저장하지 않음 — 6.3 참조)
  3) Management API로 project 목록 조회 → project별 data_sources 1행씩 (N개)
       { connection_id:<conn>, engine:'postgres', provider:'supabase',
         config:{ project_ref:'abcd', region:'ap-northeast-2',
                  host:'aws-0-ap-northeast-2.pooler.supabase.com', port:6543,
                  database:'postgres', pooler_mode:'transaction', ssl:'require' } }
  4) 각 data_source마다 supalens가 Management API로 *읽기 전용 role*(tenant_ro) 비번을 mint
       → secrets 1행
       { data_source_id:<ds>, kind:'db_password', is_current:true,
         ciphertext:AEAD(tenant_ro_pw, AAD...), dek_id:<acme_dek> }
```
- config에는 **비밀이 전혀 없다**(host/port/project_ref/pooler만). `db_password`는 supalens가 민트한 `tenant_ro` 비번이며 고객의 service-role 키를 저장하지 않는다(최소권한 — 그래서 `service_role_key`는 `secret_kind`에서 제거).
- 쿼리 실행 경로: transport에 따라 분기(pooler wire → asyncpg, 또는 Management API `/v1/projects/{ref}/database/query` → HTTPS). 같은 supabase 브랜드라도 transport가 갈릴 수 있어 `config`/(향후 connector)로 라우팅한다.

### 6.2 직접 Postgres/MySQL (connection_id null)

```text
data_sources 1행 (직접 DB는 상위 OAuth 계정 없음 → connection_id = null)
  { connection_id:null, engine:'postgres', provider:'self_hosted',
    config:{ host:'db.acme.internal', port:5432, database:'analytics', ssl:'verify-full' } }
secrets 1행
  { data_source_id:<ds>, kind:'db_password', is_current:true, ciphertext:AEAD(user_pw, AAD...) }
-- MySQL이면 engine:'mysql', provider:'generic'/'rds', 나머지 동일
```

---

## 7. 확장 시나리오 — 새 커넥터 (BigQuery / Snowflake)

host/port가 없는 warehouse가 들어올 때 본 구조의 변경 폭은 작다.

1. **즉시(현 enum 단계):** `config` JSONB가 비-host/port 형상을 흡수한다.
   - BigQuery: `config:{ project_id, dataset, location }`, 자격증명은 `secrets.kind` 신규 값 `service_account_json`(가역 암호화). dialect=GoogleSQL, transport=cloud_sdk.
   - Snowflake: `config:{ account, warehouse, role, database }`, `secrets.kind='keypair_private_key'`(key-pair 인증).
   - `ds_engine`/`secret_kind` enum에 값 추가가 필요해지는데, 이것이 바로 **승격 트리거**다.

2. **승격(churn 시작 시):** enum → `connector_definition`(`connectors`) 카탈로그로 전환.
   ```sql
   create table connectors (
     key            text primary key,        -- 'bigquery','snowflake','supabase','postgres_direct'...
     display_name   text not null,
     dialect        text not null,           -- 'postgres'|'mysql'|'googlesql'|'snowflake'
     transport      text not null,           -- 'pg_wire'|'mysql_wire'|'https_query_api'|'cloud_sdk'
     auth_methods   text[] not null,         -- {'oauth'}|{'password'}|{'service_account_json'}|{'keypair'}
     requires_connection boolean not null default false,
     config_schema  jsonb not null default '{}',   -- data_sources.config 검증용 JSON Schema
     secret_kinds   text[] not null default '{}',
     capabilities   jsonb not null default '{}'
   );
   -- data_sources: engine/provider enum 제거 → connector_key text references connectors(key)
   -- (denormalized dialect는 라우팅용으로 유지 가능)
   ```
   - 각 행이 **유효한 (dialect, transport, auth) 튜플**이므로 `provider='neon',engine='mysql'` 같은 무의미 조합이 표현 불가능해지고, 새 커넥터는 마이그레이션이 아니라 **INSERT**가 된다(Airbyte/Metabase 모델).
   - `secret_kind`도 `text` + `connectors.secret_kinds` 검증으로 바꿔 warehouse 자격증명 종류 추가 시 `ALTER TYPE` 마찰을 제거.
   - 라우팅 코드는 `connectors.transport`로 분기 → 같은 브랜드의 wire vs API 커넥터를 모델 포크 없이 공존.

---

## 8. 안티패턴 / 주의

- **`secrets`를 절대 `config`/`metadata` JSONB에 넣지 말 것.** `reject_secret_keys()` 트리거가 `password|secret|token|service_role|private_key|credential|connection_string|dsn` 키를 거부하지만, 1차 방어는 코드단 리댁션이다.
- **access_token 장기 저장 지양.** Supabase access token은 ~1h. `secrets`에 영속화하지 말고 짧은 TTL 캐시(Redis/in-memory, exp − 60~300s 버퍼)에 두고 refresh로 on-demand 파생. cold-start로 부득이하면 별도 `oauth_access_token_cache`(UNLOGGED, hard `expires_at`, sweeper)로 격리 — `secrets`/reveal-감사 경로에 섞지 말 것.
- **평문 connection string / DSN 로깅 금지.** `last_error`는 raw 드라이버 에러를 그대로 담지 말고 `last_error_code` + `last_error_redacted`(DSN/`password=`/URL userinfo 스크럽)로만 저장. 동일 리댁션 필터를 로그에도 적용.
- **고객 service-role 키를 저장/사용하지 말 것.** RLS를 우회하는 crown-jewel. 항상 Management API로 `tenant_ro` 비번을 민트해서 사용. 프로비저닝용 임시 키가 필요하면 `provisioning_service_role`로 받아 role 민트 직후 crypto-shred.
- **GCM nonce 재사용 금지.** DEK당 96-bit random nonce, 동일 키로 2^32 메시지 전 DEK 회전. nonce-never-reused-per-dek를 불변식으로 문서화(볼륨 허용 시 `unique(dek_id, nonce)`).
- **시크릿/연결을 하드 cascade로 지우지 말 것.** 먼저 `status='revoked'` + `credential_revocations` outbox로 (a) Supabase OAuth revoke (b) 민트된 role DROP (c) DEK crypto-shred 완료 후에만 물리 삭제. 즉시 삭제는 고객 인프라에 추적 불가 자격증명을 남긴다(leak-by-deletion).
- **DEK unwrap을 DB role로 하지 말 것.** KEK은 외부 KMS, DB role이 갖지 않은 별도 IAM. ciphertext와 unwrap 키가 같은 role/DB에서 닿으면 봉투 암호화가 아니다.
- **자기 키를 가역 암호화하지 말 것.** `sl_` 키·발급 MCP 토큰은 `api_keys.token_hash`(단방향) + `prefix`로 검증. 옛 prod의 평문 동등비교는 폐기.
- **Supabase Vault/pgsodium를 고객 자격증명에 쓰지 말 것.** 키가 프로젝트 단위라 테넌트 암호학적 격리가 없다. Vault는 supalens 자체 인프라 시크릿 전용.
- **enum churn 주의.** `ALTER TYPE ADD VALUE`는 트랜잭션 밖 + 같은 트랜잭션 내 사용 불가 + 제거/재정렬 불가. 커넥터/시크릿-종류 분류가 흔들리기 시작하면 즉시 lookup 테이블로 승격(status/role enum은 유지).
