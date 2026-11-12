---
name: core-dev-guard
description: >
  supalens 리포의 구조적 invariant 체크리스트. 이 리포에서 새 기능을 만들거나, 기존 코드를
  수정하거나, 새 라우트/테이블/Trigger 태스크/LLM 진입점/데이터소스 타입을 추가하는 모든
  작업을 시작하기 전에 이 스킬을 사용하라. "기능 추가해줘", "~를 수정해줘", "새 API 만들어줘",
  "마이그레이션 추가", "에이전트에 도구 추가", "알림/대시보드/빌링 관련 작업" 등 코드를 바꾸는
  요청이면 — 작다고 생각되더라도 — 먼저 이 체크리스트를 통과시켜라. 작업 완료 후에도 Ship
  체크리스트로 배포 단계 누락(마이그레이션/db:types/trigger deploy)을 검증한다.
---

# core-dev-guard — supalens 구조 invariant 가드

이 리포는 "한 곳만 고치면 되는" 코드베이스가 아니다. 여러 런타임(Vercel/Trigger.dev/브라우저),
여러 진입점(BFF/MCP/SSE/webhook), soft-delete 데이터 모델, 그리고 보안 샌드박스가 서로
계약으로 묶여 있다. 아래 체크리스트는 그 계약들이 실제로 회귀했던 지점에서 추출한 것이다.
작업 시작 전에 해당하는 섹션을 훑고, PR 직전에 [Ship 체크리스트](#ship-체크리스트)를 돌려라.

## 0. 작업 분류 (어떤 섹션을 봐야 하는가)

| 하려는 일 | 필수 섹션 |
|---|---|
| 새 LLM 호출 경로 (에이전트/분석/생성) | §1, §2, §5 |
| 새 API 라우트 / 서버 액션 | §1, §4, §6 |
| DB 테이블/컬럼/enum 추가 | §3, §7 |
| 데이터 삭제/해제/탈퇴 류 | §4 |
| 에이전트 도구 추가/변경 | §5 |
| Trigger 태스크 추가/수정 | §2, §8 |
| 새 데이터소스 엔진/타입 | §6 |
| 이메일/알림 발송 | §9 |
| UI만 수정 | §10 |

## 1. LLM 진입점 = 쿼터 게이트 (돈이 새는 지점)

**모든 새 LLM 진입점은 실행 전 `checkUsageQuota(orgId)` → 402, 실행 후 `incrementUsage`를
호출해야 한다.** 이것은 과금 invariant이자 비용 남용 가드다 (Paddle 미설정 시에도 일일
캡 `MAX_RUNS_PER_ORG_PER_DAY`가 이 함수 안에서 작동한다).

- 게이트 위치: 요청을 받는 쪽 (BFF 라우트, MCP tool, webhook 핸들러)
- increment 위치: 실행이 끝나 토큰 수를 아는 쪽 (`persistRun`/`persistCodeRun` 패턴)
- 예외: GitHub push webhook은 402 대신 SKIP (GitHub은 200을 받아야 함)
- 이중 제출: 분석류는 20초 내 동일 (org, source, question) 중복이면 409
  (`/api/agent/analyze`의 double-submit 가드 참조 — 중복 실행 = 이중 과금)

기존 진입점 목록(참고용): `/api/agent/analyze`, `/api/code/analyze`, MCP `ask`,
`/api/data-sources/[id]/context` tier-2, `/api/data-sources/[id]/kpis/extract`, push webhook.

## 2. 두 런타임 규칙 (Vercel ≠ Trigger.dev)

`trigger/*.ts`가 (직·간접으로) import하는 `src/lib/**` 파일은:

- **`import 'server-only'` 금지** — Trigger의 esbuild 번들에서 import 시점에 throw한다.
  대신 파일 최상단에 관례 주석을 남겨라:
  `// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev ...`
- Sentry는 `@sentry/node` (NOT `@sentry/nextjs`)
- 새 lib 파일에 `server-only`를 붙이기 전에 `grep -rn "해당모듈" trigger/ src/lib/`로
  Trigger 도달 여부를 먼저 확인하라. disconnect/revocations 작업 때 oauth 모듈 5개가
  이 규칙 위반으로 발견된 전례가 있다.
- 양쪽 런타임이 모두 쓰는 env (`SUPABASE_SERVICE_ROLE_KEY`, `KEK_*`, `ANTHROPIC_API_KEY`,
  `DEMO_DATABASE_URL`, `RESEND_*`)는 **Vercel과 Trigger 호스트 양쪽에** 설정해야 한다.

## 3. 마이그레이션 규율

- `npm run db:new <name>` → 파일 작성 → `npm run db:push` → **반드시 `npm run db:types`**
  (untyped admin 클라이언트 때문에 컴파일은 통과해도 타입이 낡는다)
- `ALTER TYPE ... ADD VALUE`와 그 값을 쓰는 CHECK/DML은 **파일을 분리**하라 (같은 tx 불가)
- `organizations`의 빌링 컬럼을 추가하면 `app.guard_org_billing_write` 트리거의
  **컬럼 열거 목록에도 추가**하라 — 열거식이라 새 컬럼은 자동 보호되지 않는다
  (`billing_event_at`이 빠져 있던 전례). 다른 guard 트리거(kpi_catalog)도 동일 패턴.
- 성장형 테이블(이벤트/로그/수신 기록)을 만들면 `src/lib/maintenance/prune.ts`의
  `RETENTION` 목록에 등록하라 — 아니면 무한 성장한다.
- RLS 관례: member read / member+ write (viewer 제외 — viewer가 쓰기 갖는 순간 exfil 경로),
  run·secret류는 service_role write only. `for all` write 정책은 `deleted_at` 필터 없이
  SELECT도 허용하므로 조회 쿼리에서 `.is('deleted_at', null)`을 명시하라.
- Supabase 쿼리는 `.single()` 대신 `.limit(1)` + `data?.[0]`.

## 4. Soft-delete는 CASCADE를 무효화한다

이 리포의 삭제는 거의 전부 soft-delete (`deleted_at`/`status`)다. 즉 **마이그레이션에
적힌 `ON DELETE CASCADE / SET NULL`은 절대 발동하지 않는다.** 무언가를 "삭제"하는 코드를
쓸 때는 의존 리소스를 직접 정리해야 한다:

- 데이터소스 삭제 → `cleanupDataSourceDependents()` (알림 비활성, 위젯/saved_query detach).
  `removeDirectDataSource` / `disconnectSupabase` / `deleteOrg`가 이미 호출한다 — 새 삭제
  경로를 만들면 똑같이 호출하라.
- 백그라운드 소비자(알림 러너 등)는 참조 대상의 생존을 **조인으로 재확인**하라
  (`data_sources!inner` + `deleted_at`/`status` 필터 패턴) — 정리 실패에 대한 이중 방어.
- 자격증명이 걸린 해제는 실패 시 `credential_revocations` outbox에 durable 기록
  (재시도에 필요한 시크릿은 outbox가 빌 때까지 revoke 보류 — `disconnect.ts` 패턴).
- 조직/계정 삭제는 `src/lib/org/delete.ts`의 `teardownOrg`를 경유하라. 새 자원 유형이
  생기면 teardown에도 추가.

## 5. 에이전트 샌드박스 — 절대 회귀 금지 목록

세 러너(SQL/code/firestore)의 잠금은 `src/lib/agent/lockdown.ts` **한 곳**에 있고
`lockdown.test.ts`가 핀으로 고정한다. 규칙:

- 서브프로세스 env는 `buildChildEnv()`로만 구성 (교체, 병합 아님). **PASSTHROUGH_ENV에
  시크릿형 변수를 추가하지 마라** — 테스트가 이름 패턴으로 잡아낸다.
- 도구 allow-list를 넓히는 것은 리팩터가 아니라 **보안 리뷰**다. 새 도구는:
  in-process(클로저의 결과 Map/jail된 FS)만 읽고, DB/vault/네트워크에 직접 닿지 않아야 하며,
  `ALLOWED_TOOLS` + `canUseTool`(=`makeToolGate`) 양쪽에 추가하고, lockdown.test.ts의
  핀 배열을 의도적으로 갱신하라.
- 원칙 3개: ① one run = one tenant (`dataSourceId`/`repoId`는 payload에 바인딩, 모델이
  선택 불가) ② 시크릿은 에이전트 호스트의 클로저에만 (모델 컨텍스트/서브프로세스 금지)
  ③ 읽기 전용은 구조적으로 (쓰기 도구 자체가 없음). 서브프로세스에 Sentry 붙이지 마라.
- 엔진 분기는 **세 곳을 함께** 수정: `/api/agent/analyze`, MCP `ask`(`lib/mcp/tools.ts`),
  로컬 SSE `/api/agent/runs/[id]/stream`.

## 6. 새 표면(라우트/도구)의 기본기

- 무인증/저인증 공개 엔드포인트에는 `src/lib/rate-limit.ts`의 `rateLimit()`를 붙여라
  (OAuth token 30/분·IP, DCR 10/분·IP, MCP 120/분·토큰이 기준선).
- webhook은 ① **raw body**로 서명 검증(HMAC) ② delivery-id 멱등 테이블 ③ 검증 불가면
  503 (처리하지 않음) — Paddle/GitHub 핸들러가 표준 구현.
- 사용자 입력 SQL은 반드시 `assertReadOnly()` (알림/위젯/saved query 모두 동일).
- 리소스 생성 지점에는 `enforceResourceLimit`(플랜 캡), 시트는 `enforceSeatLimit`.
- 새 데이터소스 엔진은 SQL 엔진을 리팩터하지 말고 **병렬 모듈**로 (firestore 패턴):
  유일한 이음새는 `{columns, rows}` QueryResult 계약.

## 7. 타입/코드 스타일 (반복 지적 사항)

- Next.js 15: `params`/`searchParams`는 Promise — `await` 필수.
- 언어: 코드/주석/문서는 영어, 사용자 노출 문자열(UI/이메일)은 한국어.
- 일괄 rename 후 타입 어노테이션 2차 패스 확인. re-export 파일 삭제 시 절대/상대 경로
  양쪽 grep.

## 8. Ship 체크리스트

코드가 끝났다고 배포가 끝난 게 아니다. **두 배포 라이프사이클은 독립**이다:

1. 마이그레이션 있나? → `npm run db:push` → `npm run db:types` (커밋에 포함)
2. `trigger/` 또는 그것이 import하는 lib을 건드렸나? → `npm run trigger:deploy`
   (package.json 스크립트가 CLI 버전을 설치된 `@trigger.dev/sdk`에 **자동 핀** — 맨
   `npx trigger.dev deploy`는 최신 CLI를 당겨 CI 모드에서 version-mismatch abort를 낸다. 쓰지 마라)
   Vercel 배포는 Trigger 호스트를 절대 갱신하지 않는다 — 크론/태스크가 조용히 낡는다.
3. main 푸시 → Vercel 자동 배포 (별도 조작 불필요)
4. 새 env var? → Vercel **과** Trigger 호스트 양쪽 확인 (§2)
5. 검증: `npm test` && `npx tsc --noEmit` && `npm run build`
   (tsc의 `.next/types/**/dev/chrome-live` 에러는 기존 잔재 — 무시)
6. 새로 만든 invariant(보안/과금/정리)에는 **핀 테스트**를 남겨라 — 이 리포의 관례는
   "구현과 같은 커밋에 회귀 테스트" (lockdown/dsn/kek-rotation/rate-limit 테스트 참조).

## 9. 이메일/알림 계약

- 이메일 모듈은 **절대 throw하지 않는다** (`{sent, reason}` 반환) — 발송 실패가 이미
  커밋된 비즈니스 상태를 되돌리면 안 되기 때문. Resend는 lazy, 미설정 시 warn+skip.
- 수신자는 항상 서버에서 해석 (org owner/admin verified emails — free-text 금지, exfil 방지).
- 알림성 발송은 엣지 트리거 + 쿨다운/1회 마커로 스팸 방지 (alerts 히스테리시스,
  `usage_warned_at` 주기당 1회 패턴).
- Sentry는 시스템 결함에만 — 사용자 실수(잘못된 DB 비번 등)는 보내지 않는다 (알림 피로).

## 10. UI 관례

- 위젯은 전역 CSS 변수(`--clay`, `--paper-2`)만 사용, `.dx-*`는 `/app` 레이아웃 전용.
- 랜딩은 스코프드 `.cx` 시스템 — `:root` 변형 금지.
- 파괴적 액션은 타이핑 확인(조직 이름/"탈퇴") 또는 최소 confirm — 원클릭 발동 금지.
- `/dev/*`, `/test/*` 표면은 `NODE_ENV === 'production'`에서 `notFound()` 가드 필수.
