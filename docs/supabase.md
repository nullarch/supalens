# Supabase 계정 통합 (Connect Supabase) — 구현 가이드

> **목표:** supalens 유저가 **본인의 Supabase 계정/프로젝트를 supalens에 연결**해서, supalens가 그 유저의 DB를 분석/관측(observability)할 수 있게 만든다.
>
> **결론 먼저:** 우리가 써야 하는 건 **"Build a Supabase Integration" (OAuth App / Management API OAuth 2.0 + PKCE)** 이다. (GA 상태)
>
> _작성 2026-06-29 · 공식 문서 직접 검증 기준. 핵심 4개 사실(엔드포인트·grant_type·scope 모델·GA/beta)은 공식 docs로 재확인됨._

---

## 1. TL;DR

유저가 "본인 Supabase 계정을 supalens에 통합"한다는 건 곧 **supalens가 OAuth 클라이언트가 되어 유저의 Supabase 계정(조직·프로젝트)에 위임 접근(delegated access)을 받는다**는 의미다.

- Supabase(회사)가 OAuth 프로바이더, 유저는 표준 Authorization Code + PKCE 플로우로 동의(consent).
- supalens는 `https://api.supabase.com/v1/oauth/*` 로 access/refresh token을 받아 **Management API**(`https://api.supabase.com/v1/...`)로 유저 프로젝트를 조회·관리.
- 이 기능은 **GA(일반 제공)** 상태. (별도 beta 배지 없음)

흔히 헷갈리는 **"OAuth 2.1 Server"**(우리 프로젝트가 IdP가 되어 *남이* 우리 앱으로 로그인)나 **`signInWithOAuth`**(Google/GitHub 소셜 로그인)는 **방향이 정반대**라 우리 케이스가 아니다.

---

## 2. 세 가지 "Supabase OAuth" 구분

| # | 기능 | 신뢰 방향 | 엔드포인트 호스트 | 우리 케이스? | 상태 |
|---|------|----------|-------------------|-------------|------|
| **1 (PRIMARY)** | **Build a Supabase Integration / OAuth App** (Management API) | **우리 앱이 유저의 Supabase 계정을 소비** | `api.supabase.com/v1/oauth/*` | ✅ **이것** | **GA** |
| 2 | **OAuth 2.1 Server** (Supabase Auth = IdP) | 우리 프로젝트가 *남의 앱*에 로그인 제공 | `<ref>.supabase.co/auth/v1/oauth/*` | ❌ | **Public Beta** (2025-11-26~) |
| 3 | **signInWithOAuth / linkIdentity** (소셜 로그인) | 우리 앱이 Google/GitHub를 소비 | 클라이언트 SDK (`supabase-js`) | ❌ | GA |

**분별법**
- "유저가 본인 Supabase 계정을 내 앱에 연결" → **#1**
- "남들이 *내* 프로젝트로 로그인" → #2
- "유저가 Google/GitHub로 *내 앱*에 로그인" → #3

세 개가 모두 "OAuth"지만 **역할이 정반대**다. 흔한 실수가 #1 대신 #2(OAuth 2.1 Server)를 집는 것 — 그건 우리 요구사항과 무관하다.

---

## 3. [핵심] Build a Supabase Integration 전체 플로우

### (a) OAuth App 등록

1. Supabase Dashboard → **Organization settings** → **"OAuth Apps"** 탭 (`https://supabase.com/dashboard/org/_/apps`)
2. 우측 상단 **"Add application"** 클릭
3. 입력: application name, website URL, **redirect/callback URI(s)**, **resource별 scope** 선택
4. **Confirm** → `client_id`(UUID) + `client_secret` 발급

> **중요 — Scope는 앱 생성 시점에 고정된다.** 런타임 `scope` 쿼리 파라미터로 요청하는 게 아니다(런타임 `scope`는 **deprecated**). 나중에 scope를 바꾸면 **기존 유저 전원이 재인증(re-authorize)** 해야 반영된다. → **필요한 scope를 처음에 다 설계.**

supalens(관측 도구) 최소 scope:
- **Projects (read)** — 프로젝트 목록/메타
- **Database (read + role 부트스트랩용 write)** — SQL 실행(`database/query`)은 Database **write**
- **Secrets (read)** — 선택. API key reveal 용. (단, §6 권장안에서는 이걸 피하는 방향)

### (b) "Connect Supabase" 버튼 → authorize redirect

유저를 아래 URL로 브라우저 리다이렉트:

```
GET https://api.supabase.com/v1/oauth/authorize
  ?response_type=code
  &client_id=<CLIENT_ID>
  &redirect_uri=<ENCODED_REDIRECT_URI>
  &state=<STATE>
  &code_challenge=<CHALLENGE>
  &code_challenge_method=S256
  [&organization_slug=<optional, ^[\w-]+$>]
```

- `response_type=code` (필수), `code_challenge_method=S256`
- `state` = CSRF 방어용, 콜백에 그대로 돌아옴. **`redirect_uri` + `state` 합계 ≤ 4kB**
- 동의 후 브라우저가 `redirect_uri?code=<code>&state=<state>` 로 돌아옴
- 버튼 UI는 [Supabase brand assets](https://supabase.com/brand-assets) 가이드라인 준수

**PKCE 헬퍼:**

```ts
// app/api/connect-supabase/_pkce.ts
import { createHash, randomBytes } from 'crypto'

const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const newVerifier = () => b64url(randomBytes(64))
export const challenge = (v: string) => b64url(createHash('sha256').update(v).digest())
export const newState = () => b64url(randomBytes(16))
```

**authorize Route Handler:**

```ts
// app/api/connect-supabase/authorize/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { newVerifier, challenge, newState } from '../_pkce'

export const runtime = 'nodejs'

export async function GET() {
  const verifier = newVerifier()
  const state = newState()

  const url = new URL('https://api.supabase.com/v1/oauth/authorize')
  url.searchParams.set('client_id', process.env.SUPA_CONNECT_CLIENT_ID!)
  url.searchParams.set('redirect_uri', process.env.SUPA_CONNECT_REDIRECT_URI!) // 토큰 단계와 EXACT match
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')

  const c = await cookies() // Next 15+ 에서 async
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  c.set('sb_oauth_state', state, opts)
  c.set('sb_oauth_verifier', verifier, opts) // verifier는 비밀값 → httpOnly 쿠키/서버세션에만
  return NextResponse.redirect(url)
}
```

### (c) callback에서 code + PKCE → token 교환

```
POST https://api.supabase.com/v1/oauth/token
  Content-Type: application/x-www-form-urlencoded
  Accept: application/json
  Authorization: Basic base64(client_id:client_secret)

  grant_type=authorization_code
  &code=<콜백 code>
  &redirect_uri=<authorize와 BYTE-FOR-BYTE 동일>
  &code_verifier=<원본 PKCE verifier>
```

응답:

```json
{ "access_token": "<token>", "refresh_token": "<token>", "expires_in": 86400, "token_type": "Bearer" }
```

> `expires_in`은 흔히 86400초(1일)지만 **하드코딩 금지 — 응답의 `expires_in`을 권위 있는 값으로 사용.** auth code는 **single-use, 5분 유효.**

```ts
// app/api/connect-supabase/callback/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const code = sp.get('code')
  const state = sp.get('state')

  const c = await cookies()
  const expState = c.get('sb_oauth_state')?.value
  const verifier = c.get('sb_oauth_verifier')?.value

  // CSRF + PKCE 검증: fail closed
  if (!code || !state || !expState || state !== expState || !verifier)
    return NextResponse.json({ error: 'invalid_state' }, { status: 400 })

  const basic = Buffer.from(
    `${process.env.SUPA_CONNECT_CLIENT_ID}:${process.env.SUPA_CONNECT_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://api.supabase.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SUPA_CONNECT_REDIRECT_URI!, // authorize와 정확히 동일
      code_verifier: verifier,
    }),
  })
  if (!res.ok) return NextResponse.json({ error: 'token_exchange_failed' }, { status: 502 })

  const t = await res.json() // { access_token, refresh_token, expires_in, token_type }

  // 유저별 저장. 만료는 expires_in 으로 계산 (하드코딩 X). refresh_token은 암호화 저장.
  await saveSupabaseTokens(currentUserId(), {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  })

  c.delete('sb_oauth_state')
  c.delete('sb_oauth_verifier')
  return NextResponse.redirect(new URL('/app/settings/integrations?connected=supabase', req.url))
}
```

### (d) Refresh — single-use + 로테이션 (가장 흔한 버그 지점)

```
POST https://api.supabase.com/v1/oauth/token
  Authorization: Basic base64(client_id:client_secret)
  Content-Type: application/x-www-form-urlencoded

  grant_type=refresh_token
  &refresh_token=<저장된 refresh token>
```

응답으로 **새 access_token AND 새 refresh_token**이 온다. Refresh token은 **single-use이고 매번 rotate**된다. 옛 토큰은 즉시 무효화되므로 **반드시 새 refresh_token을 atomic하게 덮어쓰기** 해야 한다.
(access_token만 저장하고 옛 refresh_token을 재전송 → `invalid refresh token` 이 대표적 버그.)

```ts
async function refresh(refreshToken: string) {
  const basic = Buffer.from(
    `${process.env.SUPA_CONNECT_CLIENT_ID}:${process.env.SUPA_CONNECT_CLIENT_SECRET}`
  ).toString('base64')
  const r = await fetch('https://api.supabase.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (r.status === 401) throw new Error('revoked') // 유저가 앱 access 회수 → 재연결 유도
  const t = await r.json() // NEW access_token + NEW refresh_token (둘 다 persist)
  return t
}
```

> 유저가 앱을 revoke 하면 refresh가 영구 실패하고 기존 access token도 죽는다. **모든 Management API 호출과 refresh에서 HTTP 401을 "재연결 필요"로 처리.**

### (e) 토큰으로 Management API 호출

```
GET https://api.supabase.com/v1/projects
  Authorization: Bearer <access_token>
```

공식 SDK:

```ts
import { SupabaseManagementAPI } from 'supabase-management-js'
const client = new SupabaseManagementAPI({ accessToken: '<access token>' })
// client.listAllProjects() 등으로 org/project 피커 UI 구성
```

### Revoke (disconnect 시)

```
POST https://api.supabase.com/v1/oauth/revoke
  Content-Type: application/json
  { "client_id": "...", "client_secret": "...", "refresh_token": "..." }
  -> 204
```

---

## 4. 토큰으로 할 수 있는 것 (Management API) + Scope 모델의 진실

**Scope 모델의 진실 (공식 docs가 두 가지로 말함 — 최신은 granular):**
- 메인 가이드는 아직 legacy 문구 *"tokens grant your application **full access** to the Management API on behalf of the user"* 를 남겨둠.
- 그러나 **전용 OAuth scopes 페이지가 진실:** *"Scopes restrict access to the specific Supabase Management API endpoints for OAuth tokens"*, *"All scopes can be specified as read and/or write."*
- 즉 **OAuth 토큰은 granular scope**(앱 생성 시 고정)를 갖는다. **full-access인 Personal Access Token(PAT)과 다르다** — OAuth 토큰을 PAT처럼 취급하지 마라.

**Resource scope 카테고리** (각 read/write): Auth, Database, Domains, Edge Functions, Environment(branches), Organizations, Projects, Rest(PostgREST), Secrets, Storage.

| 동작 | 엔드포인트 | 필요 scope |
|------|-----------|-----------|
| 프로젝트 목록 | `GET /v1/projects` | Projects read |
| 단일 프로젝트 | `GET /v1/projects/{ref}` | Projects read |
| 프로젝트 생성 | `POST /v1/projects` | Projects write |
| **임의 SQL 실행** | `POST /v1/projects/{ref}/database/query` (body `{ "query": "..." }`) | **Database write** |
| 마이그레이션 | `POST /v1/projects/{ref}/database/migrations` | Database write |
| **Pooler/연결 정보** | `GET /v1/projects/{ref}/config/database/pooler` | Database read |
| **API keys (service_role/secret 포함)** | `GET /v1/projects/{ref}/api-keys?reveal=true` | **Secrets read** |
| PostgREST 설정 | `GET/PATCH /v1/projects/{ref}/postgrest` | Rest read/write |
| Auth 설정 | `GET/PATCH /v1/projects/{ref}/config/auth` | Auth read/write |
| Edge Functions | `GET/POST /v1/projects/{ref}/functions` | Edge Functions read/write |
| Storage 버킷 | `GET /v1/projects/{ref}/storage/buckets` | Storage read |
| 조직 목록 | `GET /v1/organizations` | Organizations read |

**중요한 진실들**
- **임의 SQL은 가능하다** (Database write scope). 일부 웹 요약이 "Management API로 임의 SQL 불가"라고 잘못 말함 — 헷갈리는 건 별도의 analytics/logs 쿼리 엔드포인트다.
- **API key는 Secrets scope 뒤에 있다** (별도 keys scope 아님).
- **DB 비밀번호는 Management API로 가져올 수 없다** — 이게 핵심 한계. 풀 DB 접근은 유저에게 비번을 묻거나(나쁨), §6처럼 자체 role을 만들어야 한다.

**Rate limit:** 기본 **120 req/min**, per-user + per-scope(프로젝트·조직별 별도 추적) 격리. 일부 엔드포인트는 더 엄격(예: `GET /v1/projects/:ref/database/context` 10 req/min). 초과 시 HTTP 429, 응답 헤더 `X-RateLimit-Limit/Remaining/Reset`. → **고빈도 분석을 Management API에 의존하지 마라.**

**2025/2026 API key 마이그레이션:** legacy `anon`/`service_role` JWT → 새 `sb_publishable_…`/`sb_secret_…` 키로 전환 중. `GET /v1/projects/{ref}/api-keys` 가 둘 다 반환할 수 있으니 **방어적으로 코딩**하고 publishable/secret 있으면 선호.

---

## 5. 보안 베스트프랙티스 체크리스트

우리 integration은 **confidential (server-side) client** 다. (client_secret을 Basic auth로 사용)

- [ ] **PKCE 사용** — `code_challenge = BASE64URL(SHA256(code_verifier))`, `code_challenge_method=S256`
- [ ] **code_verifier는 비밀값** — httpOnly+Secure 쿠키 또는 서버 세션에 state로 키잉. **localStorage/URL/클라이언트 노출 금지.** (supabase-js의 기본 client-side verifier 저장에 의존 X)
- [ ] **state(CSRF)** — 암호학적 랜덤, single-use, 서버 세션 바인딩. 콜백에서 불일치/replay면 거부. `state` + `redirect_uri` ≤ 4kB
- [ ] **redirect_uri exact match** — authorize ↔ token byte-for-byte 동일 + 사전 등록. open redirector 금지
- [ ] **client_secret은 서버 전용** — 브라우저/SPA/모바일 절대 포함 금지
- [ ] **refresh token rotation 처리** — 새 access+refresh **둘 다 atomic persist**
- [ ] **reuse detection (family revocation)** — rotate/revoke된 refresh token replay 시 **토큰 패밀리 전체 revoke** + 재동의 강제
- [ ] **refresh token 암호화 저장 (at rest)** — envelope encryption (AES-256-GCM DEK ← KMS/Vault KEK). KEK는 DB·앱서버와 분리된 KMS에. **per-user RLS 격리**
- [ ] **BFF 패턴** — 브라우저엔 httpOnly+Secure+SameSite 세션 쿠키만, 토큰은 전부 서버 측
- [ ] **revoke-on-disconnect** — `POST /v1/oauth/revoke` + 저장된 암호화 토큰 삭제
- [ ] **에러 핸들링** — access 만료 → refresh, refresh 실패(revoke) → 깨끗한 재동의(재시도 루프 금지). auth code single-use·5분 → 실패 시 처음부터 재시작
- [ ] **최소 권한 scope** — Secrets scope는 service_role 키(RLS 우회 풀 DB)를, Database write는 production 임의 SQL을 노출. 토큰 유출 = 유저 프로젝트 완전 장악. **꼭 필요한 scope만**

---

## 6. supalens 아키텍처 권장안 (유저 DB를 안전하게 읽기)

OAuth 후 Management API 토큰은 있지만 **DB 비밀번호는 못 받는다.** 관측 도구는 고빈도 읽기가 필요한데, Management API SQL 엔드포인트는 **rate-limited + 쿼리당 HTTPS** 라 부적합. 그래서 권장 아키텍처:

### 권장 부트스트랩 (connect 시 1회)

1. `GET /v1/projects` → 각 프로젝트의 `id`(= project **ref**)
2. `GET /v1/projects/{ref}/config/database/pooler` → `db_host, db_port, db_user, db_name, connection_string, pool_mode` 획득 (Supavisor 호스트/포트 하드코딩 X, 여기서 읽어라)
3. **Management API SQL 엔드포인트(`POST /v1/projects/{ref}/database/query`, 비번 불필요·elevated)로 전용 READ-ONLY role 생성:**

```sql
CREATE ROLE supalens_ro WITH LOGIN PASSWORD '<우리가 생성한 강한 비번>';
-- USER 스키마에만 명시적 GRANT (pg_read_all_data 아님 — 아래 ⚠️ 참고).
--   FOR each non-system schema s (auth/vault/pgsodium/extensions/net/… 제외):
--     GRANT USAGE ON SCHEMA s; GRANT SELECT ON ALL TABLES IN SCHEMA s;
--     ALTER DEFAULT PRIVILEGES IN SCHEMA s GRANT SELECT ON TABLES;  -- 미래 테이블 커버
ALTER ROLE supalens_ro SET default_transaction_read_only = on;
ALTER ROLE supalens_ro SET statement_timeout = '30s';
```

4. 이후 **모든 고빈도 읽기는 `supalens_ro`로 Supavisor pooler 직접 연결.** Management API SQL은 schema introspection + 부트스트랩에만.

⚠️ **`pg_read_all_data`를 쓰지 않는다 (2026-07 변경).** 실증 결과 그것은 (a) BYPASSRLS가 **아니고**(RLS 켜진 고객 테이블 = 에러 없이 0행 → 에이전트 오답), (b) 시스템 스키마에 **암묵적 USAGE+SELECT**를 부여하는데 이건 `REVOKE`로 못 깎는다(`REVOKE USAGE ON SCHEMA vault` → "no privileges could be revoked"). 그 결과 `vault.secrets`(시크릿 이름·암호문), `pgsodium` 키, `extensions.pg_stat_statements`(실행된 모든 SQL 원문 → 리터럴 PII/토큰), `net._http_response`, `auth.oauth_*` 등이 읽혔다. 그래서 **user 스키마만 명시적 GRANT**로 전환 — 시스템 스키마는 구조적으로 `permission denied`. 트레이드오프/생명주기: `src/lib/supabase-management/bootstrap.ts`(`mintReadonlyRole`/`hardenReadonlyRole`/`dropReadonlyRole`).
   - **미래 스키마 커버 갭**: mint 이후 새로 만들어진 *스키마*는 다음 grant까지 0행. `hardenReadonlyRole`(비번 안 바꿈)이 스키마 sync마다 재-grant + 레거시 `pg_read_all_data` 백필. `POST /api/data-sources/[id]/introspect`("스키마 동기화")에 배선됨.
   - **teardown**: 명시적 GRANT + DEFAULT PRIVILEGES가 롤을 여러 객체의 의존성으로 만들어 `drop role`이 실패한다 → `dropReadonlyRole`은 `grant supalens_ro to current_user; drop owned by supalens_ro; drop role`(Supabase의 non-superuser `postgres`에서도 동작).
   - **잔여**: `information_schema`는 권한 기반 self-filter라 auth/vault/storage/pgsodium은 introspect에서 자동으로 안 보이지만, `extensions`/`net`은 PUBLIC 권한 때문에 *구조*가 여전히 보인다(데이터는 차단). 필요 시 `query/introspect.ts`에서 `SYSTEM_SCHEMAS` 제외로 정리 가능.
   - **RLS 0행(#1) — 해결됨 (2026-07-10 BUILT)**: Supabase 소스의 쿼리를 Management API
     `/database/query {read_only:true}`(owner 실행 → RLS 미적용)로 라우팅 (`src/lib/query/supabase-api.ts`,
     분기는 `query/dsn.ts`). supalens_ro/pooler는 direct-DB 소스 전용으로 유지. ⚠️ owner 실행은
     시스템 스키마(vault.decrypted_secrets/auth/pg_stat_statements)도 읽을 수 있으므로: introspect에서
     SYSTEM_SCHEMAS 제외 + SQL에 스키마-참조 deny-list(`assertNoSystemSchemaRefs`) 적용 — 단 이것은
     lexical 가드(best-effort)로, pooler 경로의 구조적 차단과 등가가 아니다(수용된 잔여 리스크).
     토큰은 `tokens.ts::getCachedAccessToken`(캐시+single-flight)으로만 — 쿼리당 refresh 회전 금지.

### 세 가지 접근 방식 비교

| 방식 | 평가 |
|------|------|
| **Management API SQL** (`/database/query`) | rate-limited·쿼리당 HTTPS. **부트스트랩/스키마 조사 전용.** 고빈도 분석 ❌ |
| **직접 Postgres / Supavisor pooler** (전용 read-only role) | ✅ **권장.** 고빈도 읽기, `pg_stat_*`/`EXPLAIN` 접근 가능 |
| **PostgREST + service_role** | API schema 테이블만, 기본 1000-row cap, 임의 SQL·`pg_stat_*` 불가 → **관측 도구로 구조적 부적합** + BYPASSRLS 키 보관 부담 |

### 연결 모드 (pooler)

- **Direct** `db.[REF].supabase.co:5432` — **IPv6-only(기본)**, IPv4는 유료 add-on. 호스팅/서버리스는 대개 IPv4-only라 **함정**.
- **Supavisor Session (5432)** — IPv4, prepared statements OK. **장수 분석 워커에 적합.**
- **Supavisor Transaction (6543)** — IPv4, prepared statements **불가**(드라이버 `prepare:false`/statement cache off 필수). 서버리스/단명 연결용.
- pooler username 포맷: `postgres.[PROJECT_REF]`, host `aws-[region].pooler.supabase.com`.
- ⚠️ Session mode on 6543은 **2025-02-28 deprecated** — 6543은 transaction 전용, 5432는 session 전용. 옛 가이드 믿지 마라.

### 멀티테넌트 키 관리 & 함정

- **service_role / sb_secret_ 키 저장을 피해라** — RLS 우회 + 풀 write. 멀티테넌트 저장소 유출 = 재앙. 게다가 PostgREST로만 쓸모 있고 관측 SQL도 못 돌린다.
- **자체 read-only role**이 정답: 비번을 우리가 소유, `statement_timeout` 제한. 단 "RLS-safe"는 보안 관점 서술일 뿐 — read-only role은 RLS를 **통과하지 못해** 켜진 테이블에서 0행을 본다(#1, 위 §6 ⚠️).
- ~~`GRANT pg_read_all_data`~~ 는 쓰지 않는다 — 시스템 스키마(vault/pgsodium/pg_stat_statements 등)까지 열어버리고 `REVOKE`로 못 막는다(위 §6 ⚠️). 대신 **user 스키마만 명시적 GRANT + `ALTER DEFAULT PRIVILEGES`**로 미래 테이블을 커버하고, 새 스키마는 `hardenReadonlyRole` 재-grant로 따라잡는다.
- **per-tenant credential 전부 envelope encryption** (per-tenant DEK ← KMS CMK). connection string을 **로그/에러트래커에 절대 쓰지 마라**.
- **Network Restrictions 함정** — 테넌트가 `POST /v1/projects/{ref}/network-restrictions/apply` 로 IP 제한을 걸면 Postgres+pooler 접근이 막힌다(HTTPS API엔 미적용). supalens가 **static egress IP** 를 가져 allowlist 돼야 한다. (Supabase Edge Functions는 static egress IP 제공 불가.)
- **reveal=true는 org Audit Log에 기록**된다 — 테넌트가 우리가 키 뽑는 걸 본다. 또 하나의 "service_role 대신 자체 role" 이유.

### Revoke-on-disconnect

```sql
DROP ROLE IF EXISTS tenant_ro;
```
\+ 우리가 mint한 API key 있으면 `DELETE /v1/projects/{ref}/api-keys/{id}`, 암호화 저장 credential purge, OAuth refresh 중단(어차피 revoke 후 실패).

---

## 7. 나머지 두 플로우 (참고 — 우리 케이스 아님)

### (#2) OAuth 2.1 Server — *Supabase Auth가 IdP*

우리 **프로젝트**가 OAuth 2.1 + OIDC identity provider가 되어 **다른 앱/에이전트가 "Sign in with [Our App]"** 하게 한다. 엔드포인트: `https://<ref>.supabase.co/auth/v1/oauth/{authorize,token,userinfo}`, JWKS/OIDC discovery 포함. 발급 JWT에 `user_id, role, client_id` claim → **RLS 자동 적용**(`auth.jwt() ->> 'client_id'`). grant: `authorization_code`(PKCE 필수) + `refresh_token`만. **헤드라인 용례: MCP 서버/LLM 툴/AI 에이전트 인증.** Scope는 표준 OIDC(`openid/email/profile/phone`)만 — granular/custom은 "coming soon". **자체 consent UI 직접 호스팅 필요.** **상태: Public Beta** (2025-11-26 출시). → 방향이 반대라 우리 케이스 아님.

### (#3) signInWithOAuth / linkIdentity — *소셜 로그인*

```ts
await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, scopes } })
```
유저가 Google/GitHub로 **우리 앱에 로그인**(Supabase Auth가 broker). `linkIdentity()`는 로그인된 유저에 추가 identity 연결(Manual Linking 활성화 필요, Beta). 여기 scope는 **써드파티 프로바이더 scope**(예: GitHub `repo gist`)지 Supabase scope가 아니다. → 우리 케이스 아님.

---

## 8. 구현 체크리스트 (순서대로)

1. **OAuth App 등록** — Org settings → OAuth Apps → Add application. redirect_uri(들) 등록, **필요 scope 전부**(Projects read, Database read+write, 선택 Secrets read). `client_id`/`client_secret` 저장.
2. **환경변수** — `SUPA_CONNECT_CLIENT_ID`, `SUPA_CONNECT_CLIENT_SECRET`(서버 전용), `SUPA_CONNECT_REDIRECT_URI`.
3. **PKCE 헬퍼** 작성 (`_pkce.ts`, Node runtime).
4. **authorize route** — state+verifier를 httpOnly 쿠키에, `api.supabase.com/v1/oauth/authorize` 로 redirect.
5. **"Connect Supabase" 버튼** — brand assets 준수, authorize route로 링크. 동적 post-auth redirect는 target URL을 `state`에 인코딩.
6. **callback route** — state 검증 → token 교환(Basic auth, form-urlencoded) → `expires_in`으로 만료 계산 → **refresh_token 암호화 저장(per-user)**.
7. **refresh 헬퍼** — rotation: 새 access+refresh **둘 다 atomic persist**. 401 → 재연결 유도.
8. **부트스트랩** — `GET /v1/projects` → pooler config → `database/query`로 `tenant_ro` read-only role 생성.
9. **읽기 경로** — Supavisor pooler(session mode 5432, prepared statements 가능)로 `tenant_ro` 연결. credential envelope 암호화.
10. **disconnect** — `/v1/oauth/revoke` + `DROP ROLE tenant_ro` + credential purge.
11. **보안 하드닝** — §5 체크리스트 전수 (reuse detection, network restriction 대비 static egress IP, audit-log 인지).
12. **방어적 코딩** — API key 마이그레이션(publishable/secret), Beta 엔드포인트 변경 가능성, 429 backoff.

---

## 9. 참고 링크

- [Build a Supabase Integration (메인 가이드)](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [OAuth Scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)
- [Token exchange API ref](https://supabase.com/docs/reference/api/v1-exchange-oauth-token)
- [Authorize API ref](https://supabase.com/docs/reference/api/authorize-user-through-oauth)
- [OpenAPI spec (machine-readable, canonical)](https://api.supabase.com/api/v1-json)
- [Management API introduction](https://supabase.com/docs/reference/api/introduction)
- [supabase-management-js SDK](https://github.com/supabase-community/supabase-management-js)
- [공식 reference 구현 (connect-supabase Edge Function)](https://github.com/supabase/supabase/tree/master/examples/edge-functions/supabase/functions/connect-supabase)
- [Connecting to Postgres (pooler/연결 모드)](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [새 API keys 마이그레이션](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Network restrictions](https://supabase.com/docs/guides/platform/network-restrictions)
- [Brand assets](https://supabase.com/brand-assets)
- (참고용·우리 케이스 아님) [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server)
- [OAuth 2.0 Security BCP (RFC draft)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics-23)
