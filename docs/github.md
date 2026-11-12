# GitHub 통합 (Connect GitHub) — 구현 마스터 플랜

> **목표:** supalens 유저가 **본인의 GitHub 레포를 supalens에 연결**해서, supalens가 (1) 그 레포를 **`git clone` 해 에이전트로 코드 분석**하고, (2) **커밋(push)을 지속적으로 인식**해 자동 재분석하게 만든다.
>
> **결론 먼저:** **GitHub App**으로 만든다 (OAuth App 아님). 그리고 **clone·분석은 Trigger.dev**에서 돈다 — 기존 DB-분석 에이전트와 동일 토폴로지를 거울처럼 복제한다.
>
> **v1 핵심 단순화:** v1은 **installation token만** 쓴다 → user 토큰 없음 → **vault/secret_kind 변경 불필요**. App 개인키는 env, installation token은 메모리 TTL 캐시, 연결 시 저장하는 건 비밀이 아닌 `installation_id`뿐.
>
> _작성 2026-06-30 · 공식 docs(`docs.github.com`) 직접 검증 기준. 토폴로지·보안 불변식은 [agent-implementation-plan.md](./agent-implementation-plan.md)·[agent-architecture.html](./agent-architecture.html)을 따른다._

---

## 세 가지 "GitHub 인증" — 섞지 말 것

`docs/supabase.md`의 "세 가지 OAuth" 구분과 동일한 함정. 목적·토큰·경로가 전부 다르다.

| # | 무엇 | 방향 | 경로 | 토큰 | 용도 |
|---|---|---|---|---|---|
| **1. GitHub 로그인** | supalens가 GitHub를 **IdP로 소비** | 로그인 | `signInWithOAuth({provider:'github'})` → `/auth/callback` | Supabase Auth가 쥔 user token(저권한) | **신원/세션** |
| **2. GitHub App 통합** | 앱이 **installation으로 레포 접근** | 리소스 | `/api/connect-github/*` | installation token(1h, `Contents:read`) | **clone + webhook** |
| 3. App user-to-server | 1+2를 한 앱으로 통합 | 로그인+리소스 | App user-auth | user token(App permission 기반) | 앱 1개로 합칠 때만 |

**#1과 #2는 직교**한다. 우리 설계는 로그인 방식에 의존하지 않음(연결고리는 `org_id`). **절대 금지: #1의 로그인 토큰으로 레포를 clone**(저권한 + Supabase가 관리 → refresh 불가). clone은 무조건 #2의 installation token. v1은 #2만 구현(로그인은 Supabase Auth에 GitHub provider만 추가).

## 구현 상태 (2026-06-30)

- [x] **P1** 마이그레이션 `20260630130000_github_integration.sql` (provider_kind+github, installation_id, github_repositories/code_analysis_runs/github_webhook_events + RLS)
- [x] **P0** `.env.example` GitHub App 블록
- [x] **P2** 코어 `src/lib/github-app/{config,app-jwt,installation-token,client,connect,disconnect}.ts` (App JWT는 Node crypto RS256, 의존성 0)
- [x] **P2** 연결 라우트 `src/app/api/connect-github/{authorize,callback}`
- [x] **로그인** `LoginForm.tsx` GitHub 버튼 (+ Supabase Dashboard provider 등록 필요)
- [x] **P2 UI** `integrations/` 디자인 토큰 리팩터 + GitHub 카드 + 레포 토글(`GithubReposList`) + `actions.ts` + dev 프리뷰 `/dev/integrations`
- [x] **P3** clone 엔진 `src/lib/repo/clone.ts`(GIT_ASKPASS) + jail FS 도구 `src/lib/code-agent/tools.ts`
- [x] **P4** 코드 에이전트 `src/lib/code-agent/{run-code-analysis,system-prompt,run-record}.ts` + `trigger/analyze-code.ts` + BFF `/api/code/analyze`
- [x] **P5** 웹훅 `/api/github/webhook` (HMAC + delivery 멱등 + push→incremental run + installation 정리)
- [ ] **사용자**: 마이그레이션 적용(`db:reset`/`db:push`) + `db:types`, GitHub App env 설정(또는 레거시 재사용), Supabase Dashboard GitHub provider, `npx trigger.dev deploy`
- [ ] **다음**: 레포 카드 "분석 실행" 버튼 + 코드 run 스트림 뷰(`AgentStream`/`AgentView` 재사용), Phase 6 코드×DB 교차분석(v1.5)

---

## 0. 한눈에

세 흐름 — **연결 / 분석 / 지속 인식** — 모두 기존 패턴을 그대로 따른다.

```
① 연결 (GitHub App 설치)
  Browser → /api/connect-github/authorize           (state 쿠키 발급)
         → github.com/apps/<slug>/installations/new?state=…  (유저가 레포 선택)
         → /api/connect-github/callback?installation_id&setup_action&state
              · state 검증(CSRF) → installation_id를 App JWT로 서버 재검증(스푸핑 방지)
              · provider_connections(provider='github', installation_id) upsert
              · 설치된 레포 목록 조회 → github_repositories upsert
              · 비밀 저장 없음 (installation_id는 비밀 아님)

② 분석 run (DB 에이전트와 동일 토폴로지)
  Browser/Webhook → /api/code/analyze  (BFF: TRIGGER_SECRET_KEY만 보유)
      · 멤버십 확인 → code_analysis_runs insert(queued)
      · tasks.trigger("analyze-code", {orgId, repoId, installationId,
                       repoFullName, ref, beforeSha?, afterSha?, dataSourceId?, runId},
                       { concurrencyKey: repoId })
      · auth.createPublicToken({ read:{ runs:[triggerRunId] }}) → Browser
                                  │
                                  ▼
  Trigger.dev  trigger/analyze-code.ts        [HOST = 부모 프로세스]
   env(부모에만): GITHUB_APP_ID·GITHUB_APP_PRIVATE_KEY·SERVICE_ROLE·KEK_*·ANTHROPIC_API_KEY
   1. installation token 발급 (lib/github-app/installation-token.ts, 메모리 TTL 캐시)
   2. git clone (GIT_ASKPASS로 토큰 주입) → /scratch/run-<id>/repo
        --depth 1 --single-branch  [대형: --filter=blob:none --sparse]
   3. .git/config 자격증명 제거 + 메모리 토큰 폐기
   4. runCodeAnalysis()  → Claude Agent SDK query()  [서브프로세스, env 비움]
        도구: in-process list_files / read_file / grep_code / get_diff (경로 jail)
        (+교차분석 run이면 execute_sql / get_schema 도 — 둘 다 read-only)
   5. code_analysis_runs.result 영속화 → rm -rf /scratch/run-<id>
   6. metadata.stream("agent", …) ──→ Browser가 Trigger Realtime 직접 구독

③ 지속 인식 (커밋 감지)
  GitHub push → /api/github/webhook  (BFF)
      · X-Hub-Signature-256 HMAC-SHA256 검증 (raw body, 상수시간 비교)
      · 10초 내 2XX → 이후 비동기 처리
      · X-GitHub-Delivery GUID 멱등 (재전송 중복 방지)
      · installation.id + repo.full_name → github_repositories 매핑
      · (analysis_enabled인 레포만) 짧은 디바운스 → ②의 analyze run 트리거 (변경 파일 incremental)
```

### 핵심 결정 (확정)

- **GitHub App** — 읽기 전용 코드 접근(`Contents: Read-only`)은 App에서만 표현 가능하고, **앱당 웹훅 1개**로 전 레포 push를 받으며, 토큰 수명이 1시간이라 유출 피해가 작다. (§2)
- **clone·분석 = Trigger.dev** — 장시간 루프 + 서브프로세스 + 디스크가 필요. Vercel은 thin BFF(트리거 + run-scoped 토큰 발급)만. 기존 `trigger/analyze.ts`와 동일.
- **v1 = installation token only** — user-to-server 토큰/refresh 회전/secret vault 변경 **전부 v1 범위 밖**. App 개인키는 env, installation token은 메모리 캐시.
- **clone은 신뢰된 host 코드가 수행**, lockdown된 에이전트는 **경로 jail된 in-process 도구로 "읽기만"** 한다. 빌드·설치·실행 도구는 아예 없음(no-execute는 구조적). 기존 SQL 에이전트의 불변식을 그대로 반전 적용. (§10)
- **레포는 `data_sources`가 아니다** — 신규 `github_repositories` 테이블. 쿼리 엔진(`src/lib/query/*`)은 재사용 안 함.
- **fresh clone per run** (v1). 캐시+incremental fetch는 측정 후 전환(§6.3).
- **github.com 한정** (v1). GitHub Enterprise Server는 v2(연결 시 SSRF 가드 경유).

---

## 1. 재사용하는 기존 자산

| 자산 | 위치 | GitHub에서의 역할 |
|---|---|---|
| OAuth 핸드셰이크 (state/CSRF 쿠키, `isSafeReturnTo`) | `src/lib/supabase-oauth/{config,pkce,connect}.ts` | 연결 라우트의 state 발급·검증·`returnTo` 패턴 복제 |
| 테넌시/멤버십 + `ensurePrimaryOrg` | `src/lib/org/*`, `core_tenancy.sql` | 연결을 org에 귀속 |
| `provider_connections` 테이블 | `integrations.sql` | `provider='github'` 행으로 연결 표현 (+`installation_id`) |
| service-role admin client | `src/utils/supabase/admin.ts` (`requireAdminClient`) | 서버 전용 쓰기(연결·레포·run 기록) |
| Trigger 에이전트 토폴로지 | `trigger/analyze.ts`, `trigger.config.ts` | `trigger/analyze-code.ts`가 그대로 미러링 |
| 에이전트 런타임/락다운 | `src/lib/agent/{run-analysis,tools,system-prompt,run-record}.ts` | `src/lib/code-agent/*`가 도구 프로파일만 바꿔 복제 |
| BFF → Trigger 핸드오프 + 토큰 발급 | `src/app/api/agent/analyze/route.ts` | `/api/code/analyze`가 동일 패턴 |
| run 기록 모델 | `agent_runs` (`20260629110000_agent_runs.sql`) | `code_analysis_runs`로 복제 |
| 실시간 스트림 UI | `src/components/agent/AgentStream.tsx`, `AgentView` | 코드 run에도 그대로 |
| (교차분석 시) 읽기전용 쿼리 엔진 | `src/lib/query/*` (`executeReadOnly`, `getSchema`) | code×DB 교차분석 run의 DB 렌즈 |

**신규로 만드는 것:** GitHub App JWT/토큰 모듈, clone 엔진 + jail FS 도구, 코드 분석 에이전트 태스크, 웹훅 핸들러, 연결/레포/run DB 모델, 연결 UI.

**v1에서 손대지 않는 것 (중요):** `src/lib/secrets/*`, `src/lib/crypto/*`, `secret_kind` enum, `data_sources`, `src/lib/query/*`(교차분석 Phase 6 전까지). ← installation-token-only 결정 덕분.

---

## 2. 왜 GitHub App인가 (OAuth App 아님)

GitHub의 "2가지 통합 방식"의 차이는 **"누구로서 행동하는가"**: OAuth App은 **항상 사용자 본인으로만**, GitHub App은 **앱 자신이 1급 행위자**(사용자 없이 독립 동작 가능 — 웹훅/백그라운드 분석에 최적).

| 요구 | GitHub App ✅ | OAuth App ❌ |
|---|---|---|
| 코드 **읽기 전용** | `Contents: Read-only` (clone 가능, 그 이상 불가) | `repo` 스코프 = 읽기+**쓰기** 전체. 읽기전용 사설 스코프 없음 |
| **특정 레포만**, 멀티 조직 | 설치 단위 "선택 레포만" — GitHub이 강제, 오너가 통제 | 사용자가 접근 가능한 **전부** |
| **커밋 지속 인식** | **앱당 웹훅 1개**가 모든 레포 push 자동 수신 | 레포마다 웹훅 생성 (`admin:repo_hook` 필요) |
| 토큰 저장 | 개인키(서명 전용)만, 1h 토큰 on-demand | 비만료·과권한 토큰 영구 저장 |
| B2B 거버넌스 | 조직별 설치, 오너 승인, 설치자 퇴사해도 유지 | 인증 사용자 종속, 나가면 끊김 |
| Rate limit | 5,000/h → 12,500/h (GHEC 15,000) | 사용자당 5,000/h |

GitHub 공식 입장(2026): *"일반적으로 GitHub App이 OAuth App보다 선호된다."* OAuth가 나은 유일 케이스는 enterprise 객체 접근 — 우리와 무관. **OAuth App의 유일한 장점인 "설치 UX 단순함"보다 "선택 레포 읽기전용" 신뢰가 B2B에 훨씬 중요.**

---

## 3. Phase 0 — 토대 & 결정 (먼저)

### 0.1 GitHub App 등록
GitHub → Settings → Developer settings → GitHub Apps → New.
- **Permissions (Repository):** `Metadata: Read-only`(필수 베이스), **`Contents: Read-only`**(clone + push 웹훅의 핵심 grant). (PR 분석까지 하려면 `Pull requests: Read-only` 추가 — v1 선택)
- **Subscribe to events:** `Push`. (PR 이벤트는 선택)
- **Webhook:** Active 체크, URL = `https://supalens.ai/api/github/webhook`, Secret 설정.
- **Where can this app be installed:** Any account (멀티 테넌트).
- **Setup URL** = `https://supalens.ai/api/connect-github/callback`, **"Redirect on update" 체크**(설치 레포 변경 시 콜백 재호출 → 레포 목록 동기화).
- 개인키(PEM) 발급 → `GITHUB_APP_PRIVATE_KEY`로 보관. App ID·slug·client id/secret 기록.

> **연결 시작 방식(state 유지):** 설치 URL `…/installations/new?state=<state>`로 보내면 콜백에 `state`가 되돌아온다(우리 org 매핑용). state 파라미터가 환경에서 안정적이지 않으면, App 설정에서 **"Request user authorization (OAuth) during installation"**을 켜고 표준 `login/oauth/authorize?...&state=` 로 시작 → 콜백에 `code`+`installation_id`+`state`가 함께 온다(v1은 `code` 미사용/무시 가능). 둘 중 동작하는 쪽 채택.

### 0.2 환경변수 (`.env.example`에 블록 추가)
```bash
# ─────────────────────────────────────────────────────────
# GitHub App ("Connect GitHub" — clone + push 웹훅 + 코드분석)
# Register: GitHub → Settings → Developer settings → GitHub Apps
# Permissions: Metadata:read, Contents:read · Events: push
# ─────────────────────────────────────────────────────────
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=supalens                       # 설치 URL: github.com/apps/<slug>
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxx              # user-auth 결합 시작 방식일 때만
GITHUB_APP_CLIENT_SECRET=xxxxxxxx              # (v1 미사용 가능)
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n…\n-----END…"  # JWT 서명(호스트 비밀)
GITHUB_APP_WEBHOOK_SECRET=xxxxxxxx             # HMAC-SHA256 웹훅 검증
GITHUB_APP_REDIRECT_URI=http://localhost:3000/api/connect-github/callback
```
- **BFF(Vercel)에 필요:** `GITHUB_APP_WEBHOOK_SECRET`(웹훅 검증), `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`(콜백에서 installation_id 서버검증), `GITHUB_APP_SLUG`, `TRIGGER_SECRET_KEY`.
- **Trigger.dev 호스트에 필요:** `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`(토큰 발급→clone), 기존 `ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`KEK_*`.
- App 개인키·웹훅시크릿은 **테넌트별 비밀이 아니라 supalens 자체 호스트 비밀** → vault 아님, env/Secret Manager.

### 0.3 의존성
```bash
npm i jsonwebtoken            # App JWT(RS256) 서명. (대안: @octokit/auth-app)
# git, ripgrep(rg) 는 바이너리 — Trigger.dev 런타임 이미지에 존재 확인 (0.5)
```
GitHub API 호출은 가벼우면 `fetch`로 충분(octokit 선택). Claude Agent SDK는 기존 에이전트가 이미 핀해둔 버전 재사용.

### 0.4 `server-only` 가드 (⚠️ 기존 함정 동일 적용)
신규 공유 모듈 `src/lib/github-app/*`, `src/lib/repo/*`, `src/lib/code-agent/*`는 Trigger 태스크에서 import된다 → `import 'server-only'` **넣지 말 것**(react-server 조건 없는 Node 번들에서 throw). 대신 ESLint `no-restricted-imports`로 클라이언트 컴포넌트에서의 import만 차단(`admin.ts`/`secrets/service.ts`와 동일 규약).

### 0.5 Trigger.dev 런타임 점검
- 이미지에 **`git`** + (빠른 grep용) **`ripgrep`** 존재 확인. 없으면 설치하거나 `isomorphic-git`(순수 JS, 느림) + JS 검색 폴백.
- 디스크 헤드룸 위해 clone 태스크는 `machine` 프리셋 상향(예: `medium`). `maxDuration` 충분히.
- **고정 egress IP** 있으면 좋음(향후 GHE allowlist 대비; github.com엔 불필요).

---

## 4. Phase 1 — 데이터 모델

`supabase/migrations/20260630130000_github_integration.sql` (마지막이 `…120000_dashboards.sql` → 다음 타임스탬프). 작성 후 `npm run db:types`.

```sql
-- 1) provider enum 확장
ALTER TYPE provider_kind ADD VALUE IF NOT EXISTS 'github';

-- 2) provider_connections: installation_id (비밀 아님). 멀티-installation 허용.
ALTER TABLE provider_connections ADD COLUMN IF NOT EXISTS installation_id bigint;
-- 한 org가 여러 GitHub 계정/조직을 설치 가능 → external_account_id = GitHub account login,
-- installation_id 로 설치 식별. 기존 partial-unique(org_id, provider, external_account_id) 재사용.

-- 3) 연결된 레포
CREATE TABLE github_repositories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  connection_id   uuid NOT NULL,
  github_repo_id  bigint NOT NULL,          -- GitHub 숫자 id (rename 안전)
  full_name       text   NOT NULL,          -- "owner/repo"
  default_branch  text   NOT NULL DEFAULT 'main',
  is_private      boolean NOT NULL DEFAULT true,
  clone_url       text,                      -- https://github.com/owner/repo.git
  analysis_enabled boolean NOT NULL DEFAULT true,   -- push 자동분석 on/off
  sparse_paths    text[],                    -- 모노레포: 분석 대상 경로(선택)
  last_synced_sha text,
  last_pushed_at  timestamptz,
  status          text NOT NULL DEFAULT 'active',   -- active|disabled|error
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (id, org_id),
  UNIQUE (org_id, github_repo_id),
  FOREIGN KEY (connection_id, org_id)
    REFERENCES provider_connections(id, org_id) ON DELETE RESTRICT
);

-- 4) 분석 run 기록 (agent_runs 미러)
CREATE TABLE code_analysis_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  repo_id       uuid REFERENCES github_repositories(id),     -- nullable: 순수 DB run과 공유 가능
  data_source_id uuid,                                       -- 교차분석(code×DB) 시 바인딩
  user_id       uuid,                                        -- 수동 실행자 (push면 null)
  kind          text NOT NULL,                  -- manual | push | full | combined
  status        text NOT NULL DEFAULT 'queued', -- queued|running|succeeded|failed|cancelled
  trigger_run_id text,
  ref           text,                           -- refs/heads/main
  before_sha    text,
  after_sha     text,
  turns         int,
  tokens_in     int,
  tokens_out    int,
  cost_usd      numeric,
  result        jsonb,                          -- 구조화 findings + 스트림 산출
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  UNIQUE (id, org_id)
);

-- 5) 웹훅 이벤트 (멱등 + 감사)
CREATE TABLE github_webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  text NOT NULL,                  -- X-GitHub-Delivery (멱등 키)
  event_type   text NOT NULL,                  -- X-GitHub-Event (push, installation, …)
  installation_id bigint,
  repo_full_name text,
  org_id       uuid,                           -- 매핑 성공 시
  run_id       uuid REFERENCES code_analysis_runs(id),
  status       text NOT NULL DEFAULT 'received', -- received|skipped|triggered|invalid
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id)
);

-- 6) RLS: 모든 신규 테이블 enable + REVOKE FROM anon
--    github_repositories / code_analysis_runs: 멤버 read (app.current_org_ids()),
--      write는 service_role 만 (BFF/Trigger). 또는 owner/admin/member (레포 enable 토글용).
--    github_webhook_events: 서버 전용(REVOKE all from anon, authenticated → policy 없음 = deny).
ALTER TABLE github_repositories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_analysis_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON github_webhook_events FROM anon, authenticated;
-- member-read 정책은 rls_policies.sql 패턴(app.current_org_ids() / app.has_org_role()) 그대로.
```

> **secrets 테이블·`secret_kind`·vault 코드는 v1에서 안 건드린다.** installation token만 쓰므로 저장할 테넌트 비밀이 없다. (user 토큰을 도입하는 Phase 7에서 `github_oauth_refresh_token` kind + CHECK 제약 + 회전 로직을 추가)

---

## 5. Phase 2 — 연결 플로우 (인증)

`src/lib/supabase-oauth/`를 거울로 `src/lib/github-app/` 신설.

| 파일 | 미러 | 책임 |
|---|---|---|
| `github-app/config.ts` | `supabase-oauth/config.ts` | App env 읽기, 설치 URL 빌드, 쿠키 상수(`gh_oauth_state`), `isSafeReturnTo` 재사용 |
| `github-app/app-jwt.ts` | (신규) | `mintAppJwt()` — `GITHUB_APP_PRIVATE_KEY`로 RS256 JWT 서명(iat/exp ≤10분, iss=App ID) |
| `github-app/installation-token.ts` | `query/dsn.ts`의 TTL 캐시 | `getInstallationToken(installationId)` — JWT로 `POST /app/installations/{id}/access_tokens` → **1h 토큰 메모리 캐시**(만료 5분 전 갱신). refresh 회전 없음 |
| `github-app/client.ts` | `supabase-management/client.ts` | `api.github.com` 얇은 래퍼: `getInstallation`, `listInstallationRepos`, (선택)`compareCommits` |
| `github-app/connect.ts` | `supabase-oauth/connect.ts` | service-role로 `provider_connections(provider='github', installation_id)` upsert → `listInstallationRepos` → `github_repositories` upsert. **putSecret 호출 없음** |
| `github-app/disconnect.ts` | `supabase-oauth/disconnect.ts` | 연결·레포 soft-delete. (실제 App 제거는 유저가 GitHub UI에서 → `installation` 웹훅으로 동기화) |
| `github-app/webhook.ts` | (신규) | `verifySignature(raw, sig)` — HMAC-SHA256 + `crypto.timingSafeEqual`. 멱등 헬퍼 |

**라우트:**
- `src/app/api/connect-github/authorize/route.ts` — 유저 인증 → `ensurePrimaryOrg` → `state` 쿠키(httpOnly/secure/lax/600s) → `github.com/apps/<slug>/installations/new?state=…` 로 302. (`supabase-oauth/authorize` 미러)
- `src/app/api/connect-github/callback/route.ts` — `state`/쿠키 검증(fail-closed) → **`installation_id`를 App JWT로 `getInstallation()` 서버검증**(스푸핑 방지) → `connectGithubAccount({orgId, installationId, userId})` → `/app/settings/integrations?connected=github&repos=N`로 리다이렉트.

**UI:** `src/app/app/settings/integrations/page.tsx`에 "Connect GitHub"(설치 버튼) + 연결된 레포 리스트(분석 on/off 토글) 섹션 추가. `actions.ts`에 `disconnectGithubAction`(owner/admin 게이트, `disconnectSupabaseAction` 미러).

---

## 6. Phase 3 — clone 엔진

`src/lib/repo/` 신설 (호스트=부모 프로세스 전용, Trigger에서 import).

### 6.1 토큰 주입 = `GIT_ASKPASS` (안전)
URL에 `x-access-token:TOKEN@`을 박으면 `.git/config`·`ps`·reflog에 토큰이 남는다. 대신:
```
# repo/clone.ts (스케치)
const askpass = writeTmpExecutable(`#!/bin/sh\nexec cat "$GH_TOKEN_FILE"`)  // 토큰은 파일/fd로만
env = { ...minimal, GIT_ASKPASS: askpass, GH_TOKEN_FILE: tokenPath,
        GIT_TERMINAL_PROMPT: '0' }
exec('git', ['clone','--depth','1','--single-branch','--branch',ref,
             `https://x-access-token@github.com/${fullName}.git`, dir], { env })
// clone 후: git remote set-url origin https://github.com/${fullName}.git  (자격증명 제거)
//          tokenPath unlink, 메모리 토큰 폐기 → 이후 분석은 토큰 불필요(네트워크 fetch만 인증)
```
토큰은 **부모 프로세스 클로저/임시파일에만** 존재. 기존 `dsn.ts`가 복호화된 DB 비번을 풀 클로저에 가두는 패턴과 동형.

### 6.2 clone 범위 최소화
| 상황 | 권장 |
|---|---|
| 기본(대부분 레포) | `--depth 1 --single-branch` — 빠르고 1h 토큰 안에 완료. tip 커밋만 |
| 대형 모노레포 | `--filter=blob:none`(blobless) + `--sparse` + `sparse-checkout set <paths>` — 메타데이터만, 에이전트가 연 파일만 lazy fetch. lazy fetch가 토큰 만료를 넘기면 **GIT_ASKPASS가 매번 fresh 토큰 재발급** |

push run이면 변경 파일 디렉토리로 sparse 세트 자동 도출. 작업 트리 크기 캡(예: 2GB 초과 시 early abort)으로 악성/거대 레포가 디스크·`maxDuration` 못 잡아먹게.
> **clone 트래픽은 REST rate limit을 소비하지 않는다**(별도 transport) — 큰 이점.

### 6.3 저장/캐싱
- **v1: run마다 fresh clone** (`/scratch/run-<runId>/repo`, 기존 `/tmp/agent-run-${runId}` 동형) → `finally`에서 `rm -rf`. 테넌트 격리 최강.
- **전환 조건(측정 후):** 레포가 크고 push가 잦아 재clone 지연이 지배적일 때만 `repoId`별 캐시 working copy + 매 run `git fetch` → `reset --hard <afterSha>` → `clean -ffdx`(심은 파일 제거). 캐시도 **매 run untrusted 취급**. v1은 fresh 유지.

---

## 7. Phase 4 — 코드 분석 에이전트

`src/lib/agent/`를 거울로 `src/lib/code-agent/` 신설. **구조는 `run-analysis.ts`와 동일, 도구 프로파일·프롬프트만 반전.**

### 7.1 jail된 in-process 도구 — `code-agent/tools.ts`
SDK 내장 `Read`/`Glob`/`Grep`을 쓰지 **않는다**(경로 인자 검증 부담 + 중앙 redact 불가). 대신 부모 프로세스 핸들러가 `cloneDir`에 jail된 MCP 도구 제공 — 모델은 핸들러가 반환한 JSON만 본다(`execute_sql`이 행만 반환하는 것과 동형):
- `list_files({glob?})` → 상대경로만, `.git`/`node_modules`/빌드/바이너리 스킵.
- `read_file({path})` → `path.resolve(cloneDir,path)`가 `cloneDir` 안인지 assert(`..`/심링크 이스케이프 reject), 바이트 캡, **`.env`/키 등 비밀 패턴 redact**.
- `grep_code({pattern,glob?})` → 호스트가 `execFile('rg', ['--json','-e',pattern, cloneDir])`(셸 없음, 고정 인자, jail root). 모델은 패턴만 제공(=`execute_sql`이 SQL을 guard 통과시키는 것과 동형).
- `get_diff({before,after})` → 호스트가 바인딩된 SHA로 `git diff` 실행, read-only.

### 7.2 락다운 — `code-agent/run-code-analysis.ts`
```
ALLOWED_TOOLS = ['mcp__supalens_code__list_files','…read_file','…grep_code','…get_diff']
                (+교차분석이면 'mcp__supalens__execute_sql','…get_schema')
tools: []                       // 내장 하니스 도구 전부 제거
disallowedTools: ['Bash','Read','Write','Edit','WebFetch','WebSearch','Glob','Grep']
settingSources: [], strictMcpConfig: true   // 레포가 심은 .mcp.json/.claude/CLAUDE.md 무시
permissionMode: 'dontAsk', canUseTool: deny-gate
env: buildChildEnv()            // 서브프로세스 env 비움 — GH토큰/App키/KEK/service_role 없음
cwd: /scratch/run-<id>/repo
maxTurns + maxTotalTokens abort // 코드 트랜스크립트는 크다 → 예산 캡 필수
```
**no-execute는 정책이 아니라 구조** — 실행하는 도구 자체가 없다(`Bash` 금지 + `tools:[]` + read/list/grep/diff만). `npm install`·테스트 실행 불가능(SQL 에이전트가 `UPDATE` 못 하는 것과 동일 원리).

### 7.3 프롬프트 — `code-agent/system-prompt.ts`
신규 작성(SQL 분석가용 `agent/system-prompt.ts` 재사용 금지, `claude_code` 프리셋도 금지). 핵심: 파일 내용·README·주석을 **UNTRUSTED 데이터**로 취급, 절대 지시로 해석 안 함. 산출은 **구조화 findings**(severity/file/line/category/suggested-fix) — DB 에이전트가 `VisualizationSpec` 객체를 내는 것과 동형.

### 7.4 태스크 — `trigger/analyze-code.ts`
`trigger/analyze.ts` 미러: `markRunning` → (clone → runCodeAnalysis) → `persistRun`(throw에도 terminal 상태 기록). `queue.concurrencyLimit` + `concurrencyKey: repoId`로 push 폭주 시 디스크/egress 보호. `emit()` → `metadata.stream('agent',…)` 브리지 그대로 → 브라우저 `AgentStream` 무변경.

### 7.5 BFF — `src/app/api/code/analyze/route.ts`
`agent/analyze/route.ts` 미러: 유저 인증 → `github_repositories` 멤버십 확인(RLS) → `code_analysis_runs` insert → `tasks.trigger('analyze-code', …, {concurrencyKey: repoId})` → `auth.createPublicToken({read:{runs:[triggerRunId]}})` 반환. **이 라우트는 DB/KMS/GH 비밀 없음** — `TRIGGER_SECRET_KEY`만.

---

## 8. Phase 5 — 웹훅 (커밋 지속 인식)

`src/app/api/github/webhook/route.ts` (`runtime='nodejs'`, `dynamic='force-dynamic'`):
1. **HMAC 검증** — `X-Hub-Signature-256`(`sha256=<hex>`), webhook secret 키, **raw body 바이트**(파싱 전)에 HMAC-SHA256, `crypto.timingSafeEqual` 상수시간 비교. 불일치 → 401.
2. **10초 내 2XX 응답** 후 비동기 처리(GitHub은 실패 자동 재전송 안 함, 10초 초과=실패).
3. **멱등** — `github_webhook_events`에 `X-GitHub-Delivery` UNIQUE insert(재전송 중복 차단), `X-GitHub-Event`로 라우팅.
4. **매핑** — `payload.installation.id` + `repository.full_name` → `github_repositories`(service-role + org 필터). 연결 안 된/`analysis_enabled=false`/sparse 경로 밖 변경이면 skip.
5. **디바운스** — `(repo_id, ref)` 짧은 윈도(30–60s) 코얼레스(force-push 폭주/CI 봇 루프 방지) → 최신 `after` SHA만 분석.
6. **트리거** — `code_analysis_runs` insert → `tasks.trigger('analyze-code', …)`.
7. **이벤트 처리** — `installation`/`installation_repositories` 이벤트로 레포 목록·연결 상태 동기화(설치 추가/제거/레포 변경).

**분석 범위:** push의 `before`/`after`로 `git diff --name-only` → **변경 파일 + 인접 의존만 incremental**(에이전트가 `grep_code`로 확장). **full**은 첫 연결·수동 재분석·새 브랜치(`before=0000…`)·diff 과대 시.
**엣지 백스톱:** `>5000 브랜치`/`>3 태그` 동시 push는 이벤트가 안 옴 → 주기적 reconciliation(설치별 레포 `pushed_at` 폴링) 권장. `commits[]`는 최대 2048개(초과분 Commits API).

---

## 9. Phase 6 — 코드 × 라이브 DB 교차 분석 (차별점, v1.5)

supalens는 **레포(GitHub App)와 라이브 DB(`supalens_ro`)를 둘 다** 쥔 거의 유일한 위치. `code_analysis_runs.data_source_id`를 바인딩하면 한 에이전트에 **두 read-only 렌즈**(`read_file`/`grep_code` + `execute_sql`/`get_schema`)를 줘서:
- **스키마/마이그레이션 드리프트** — 코드의 ORM 모델·`migrations/*` vs `get_schema` 실제 스키마.
- **죽은/깨진 쿼리** — 코드에서 grep한 SQL vs 실제 테이블·컬럼(drop된 컬럼 참조, 누락 인덱스, N+1).
- **RLS 기대 vs 실제.**

`repoId`+`dataSourceId` 둘 다 바인딩하되 **`org_id` 동일성 assert**(invariant #1 유지: 여전히 one run = one tenant). 데이터 모델은 v1부터 대비됨(컬럼 존재), 기능은 Phase 6에서.

---

## 10. 보안 불변식 매핑 (SQL 에이전트 → 코드 에이전트)

| 불변식 | SQL 에이전트(기존) | 코드 에이전트(신규) |
|---|---|---|
| **one run = one tenant** | `dataSourceId` payload 바인딩 | `repoId`+`installationId` payload 바인딩, clone dir run별, 교차분석은 `org_id` 동일 assert |
| **비밀은 host에만** | db 비번 `dsn.ts` 풀 클로저, `buildChildEnv()`가 서브프로세스 env 비움 | installation token은 GIT_ASKPASS/부모 클로저, clone은 서브프로세스 spawn 전, env에 GH토큰/App키/KEK/service_role 없음 |
| **엄격 read-only** | SELECT-only, `begin read only`, `supalens_ro`, row cap, timeout | read FS 도구만(list/read/grep/diff), **빌드·설치·실행 없음**, 경로 jail, 바이트 캡, 분석 전 토큰 폐기 |
| **내장 도구 off** | `tools:[]`, `disallowedTools`, `dontAsk` | 동일 + `Bash` 계속 금지(레포 실행 불가) |
| **untrusted 무시** | `settingSources:[]`, `strictMcpConfig` | 동일 → 레포가 심은 `.mcp.json`/`.claude/`/`CLAUDE.md` 무시 |
| **deny-gate** | `canUseTool` allow-list | 4개 코드 도구 allow-list |
| **per-tenant 동시성** | `concurrencyKey: dataSourceId` | `concurrencyKey: repoId` |
| **비용 캡** | `maxTurns`+`maxTotalTokens` | 동일(코드 트랜스크립트 큼 → blobless/sparse로 입력 제한) |
| **감사** | 쿼리→`audit_log`, reveal→`secret_access_log` | clone·토큰 발급→감사, `github_webhook_events`에 delivery 기록 |
| **SSRF** | connect 시 `resolveSafeHost` | github.com 고정(저위험), GHE는 v2에서 동일 가드 |

---

## 11. 신규/수정 파일 전체 목록

**신규**
```
src/lib/github-app/{config,app-jwt,installation-token,client,connect,disconnect,webhook}.ts
src/lib/repo/{clone,askpass,fs-tools}.ts
src/lib/code-agent/{run-code-analysis,tools,system-prompt,run-record}.ts
src/app/api/connect-github/authorize/route.ts
src/app/api/connect-github/callback/route.ts
src/app/api/github/webhook/route.ts
src/app/api/code/analyze/route.ts
src/app/api/code/runs/[id]/...           (필요 시 로컬 SSE, agent/runs 미러)
trigger/analyze-code.ts
supabase/migrations/20260630130000_github_integration.sql
```
**수정**
```
.env.example                              (GitHub App 블록)
src/app/app/settings/integrations/page.tsx + actions.ts   (Connect GitHub UI/액션)
trigger.config.ts                         (analyze-code 머신/큐 — 필요 시)
eslint config                             (github-app/repo/code-agent를 client import 금지)
src/utils/supabase/schema.type.ts         (db:types 자동 재생성)
```

---

## 12. 빌드 순서 체크리스트

- [ ] **P0** App 등록(권한 Metadata/Contents:read, push 구독, 웹훅 secret, 개인키) · `.env` · `jsonwebtoken` 설치 · Trigger 이미지에 `git`/`rg` 확인 · `server-only` 가드 규약
- [ ] **P1** 마이그레이션 작성 → `db:reset`/`db:push` → `db:types`
- [ ] **P2** `github-app/*`(jwt·installation-token·client·connect) → `/api/connect-github/{authorize,callback}` → 설정 UI. **수동으로 연결 → 레포 목록 뜨는지 확인**
- [ ] **P3** `repo/*`(GIT_ASKPASS clone, jail FS 도구) — 단위 테스트(경로 이스케이프 reject, 토큰 미잔존)
- [ ] **P4** `code-agent/*` + `trigger/analyze-code.ts` + `/api/code/analyze` → **수동 "레포 분석" 한 번 end-to-end** (스트림까지)
- [ ] **P5** `/api/github/webhook`(HMAC·멱등·디바운스) → **테스트 push → 자동 run** + reconciliation
- [ ] **P6**(v1.5) 교차분석 — `data_source_id` 바인딩 + 도구 결합 + `org_id` assert

---

## 13. 결정·리스크·오픈 이슈

1. **연결 시작 방식**(§0.1) — `installations/new?state=` vs user-auth 결합. 동작 확인 후 택1(v1은 user token 미사용이라 전자 선호).
2. **레포 write 권한 토글 RLS** — 레포 `analysis_enabled` 토글을 멤버가 하게 할지(owner/admin만 할지). `ds_write`(owner/admin/member) 패턴 따름 권장.
3. **토큰 예산** — 큰 diff가 `maxTotalTokens` 초과 가능 → 청킹/요약→드릴다운, 파일·바이트 캡. 코드 run의 기본 `maxTurns`는 SQL(25)보다 높게.
4. **fresh vs 캐시**(§6.3) — v1 fresh 고정, 전환 임계값은 실측 후 명문화.
5. **웹훅 재전송** — 3일 내 수동 재전송 가능 → 실패 sweeper 둘지 결정. delivery_id 보존 기간.
6. **secrets-in-repo** — `read_file` redact 목록 확정(.env/키/토큰 패턴).
7. **GHE(self-hosted)** — v1 범위 외. 도입 시 clone URL을 `resolveSafeHost`(`ssrf.ts`) 경유.
8. **user 토큰(Phase 7)** — "유저 권한으로 레포 목록 보기" 등 UX 필요해질 때만. 그때 `secret_kind` 확장 + CHECK 제약 + refresh 회전(=`supabase-oauth/tokens.ts` 거의 그대로) 추가.
