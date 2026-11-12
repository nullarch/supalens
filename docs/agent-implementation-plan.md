# supalens LLM 추론 에이전트 — 구현 계획 (Claude Agent SDK + Trigger.dev)

> 목표: 유저 질문을 받아 **그 유저의 연결된 DB를 LLM이 추론·분석**하고, 결과를 **실시간 스트리밍**한다.
> 배치 결정 근거·토폴로지: [agent-architecture.html](./agent-architecture.html). 연동/스키마: [supabase.md](./supabase.md) · [db-schema.md](./db-schema.md).

---

## 0. 한눈에

```
Browser (React)
  │  ① 질문 (POST /api/agent/analyze)
  ▼
Next.js (Vercel) = BFF        ── 인증 + org/data_source 바인딩 + tasks.trigger() + run의 publicAccessToken 발급
  │  ② tasks.trigger("analyze", {orgId, dataSourceId, userId, runId, question})
  ▼
Trigger.dev = Agent Runtime   ── Claude Agent SDK query() (subprocess) + in-process SQL 툴 + 볼트 언랩
  │  ⑥ execute_sql (read-only, supalens_ro)        ↑⑤ 모델 루프 (Anthropic API)
  ▼
Tenant DB (Supabase / Supavisor 6543)
  ⑦ 토큰·툴이벤트 → Trigger Realtime stream  ──(browser가 publicAccessToken으로 직접 구독)──▶ Browser
```

핵심 결정 (확정):
- **에이전트 본체 = Trigger.dev** (Cloud Run/Fly 자리, 하나만). Vercel은 **BFF/트리거/토큰 발급만**.
- **스트리밍은 Trigger.dev Realtime 직결** — BFF가 run별 **publicAccessToken**을 발급, 브라우저가 그 토큰으로 run 스트림을 직접 구독. → Vercel을 스트림 경로에서 빼서 800초 캡과 무관.
- **단일 레포** — Trigger 태스크(`trigger/`)가 같은 레포의 `src/lib/*`(query/secrets/crypto/management)를 **직접 import**. 모노레포 불필요.
- **에이전트는 엄격히 read-only** — SQL 2개 툴만(`execute_sql`,`get_schema`), bash/fs/web 전부 off, `canUseTool` deny-gate.

---

## 1. 재사용하는 기존 자산

| 자산 | 위치 | 에이전트에서의 역할 |
|---|---|---|
| OAuth Connect + 토큰 회전 | `src/lib/supabase-oauth/*` | BFF 인증 후 연결된 data_source 확인 |
| 시크릿 볼트 (KEK/DEK, AES-GCM) | `src/lib/crypto/*`, `src/lib/secrets/service.ts` | 에이전트 호스트가 supalens_ro 비번 복호화 |
| supalens_ro 민팅 / pooler 정보 | `src/lib/supabase-management/*` | data_source.config에 pooler host/port |
| DB 스키마 (data_sources/secrets/audit) | `supabase/migrations/*` | 런 기록·감사 |

신규로 만드는 것: **쿼리 엔진**, **Trigger 에이전트 태스크**, **BFF 라우트**, **agent_runs 모델**, **클라이언트 훅/UI**.

---

## 2. Phase 0 — 토대 & 결정 (먼저)

**0.1 SDK 핀 & API 검증**
- `npm i @anthropic-ai/claude-agent-sdk@<고정버전>` — **pre-1.0이라 옵션명이 이동함**. 설치 후 `node_modules`의 `.d.ts`로 실제 시그니처 확인(`query`, `tool`, `createSdkMcpServer`, `canUseTool`, `permissionMode`, `settingSources`, `strictMcpConfig`, `includePartialMessages`). 본 문서의 옵션명은 그 기준으로 한 번 대조.
- `claude` CLI가 SDK에 번들되는지/별도 설치인지 확인(런타임 이미지에 필요).

**0.2 `server-only` 가드 제거 (⚠️ 중요 함정)**
- `src/lib/crypto/*`, `src/lib/secrets/*`, (신규)`src/lib/query/*`, `src/lib/supabase-management/*`는 Trigger 태스크에서도 import됨. 그런데 `import 'server-only'`는 `react-server` export 조건이 없는 일반 Node 번들(=Trigger 빌드)에서 **throw**한다.
- 조치: 이 공유 코어 모듈에서 `import 'server-only'` **제거**(어차피 Node crypto + service_role 필요라 클라이언트에서 못 씀). 대신 ESLint `no-restricted-imports`로 클라이언트 컴포넌트의 import만 차단. (대안: `trigger.config.ts` esbuild에 `react-server` 조건 추가 — 더 magic하므로 비권장.)

**0.3 Trigger.dev 프로젝트 init**
- `npx trigger.dev@latest init` → `trigger.config.ts` + `trigger/` 디렉터리 생성. 같은 레포 안.
- 머신 프리셋: 에이전트 1세션 ~1GiB floor → `small-1x`(0.5GiB) 부족 가능 → **`small-2x`(1GiB) 또는 `medium`**. `maxDuration`은 `timeout.None`(또는 크게).
- env: Trigger 대시보드에 `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, KEK(`KEK_PROVIDER`+`KEK_GCP_KEY`/`KEK_LOCAL_MASTER_KEY`). GCP KMS면 서비스계정 키 또는 Workload Identity Federation.
- **고정 egress IP**(유료 플랜) → 테넌트 DB allowlist 대비.

---

## 3. Phase 1 — 쿼리 엔진 (`src/lib/query/`)

대시보드/위젯/MCP/에이전트가 **공유**하는 read-only 실행 레이어. (에이전트 없이도 단독 동작·테스트 가능)

```
src/lib/query/
  pool.ts        # data_source별 pg/mysql 풀 캐시 (모듈 global). Supavisor transaction(6543) → prepare:false
  dsn.ts         # data_source.config + 볼트 db_password → 접속정보 조립 (supalens_ro.<ref>@pooler)
  execute.ts     # executeReadOnly(dataSourceId, sql, {maxRows,timeoutMs}) → {columns,rows,rowCount,truncated,durationMs}
  introspect.ts  # getSchema(dataSourceId) → 테이블/컬럼/PK (information_schema), data_source_schemas 캐시 갱신
  guard.ts       # SELECT-only 검증 (단일 statement, DDL/DML/다중 세미콜론 거부) — 1차 방어
  audit.ts       # 모든 실행을 audit_log에 동기 기록 (sql, data_source_id, rowCount, duration, truncated)
```

핵심 규약:
- `executeReadOnly`는 **항상** ① `guard` 통과 → ② `supalens_ro`로 접속(GRANT SELECT only + statement_timeout) → ③ row/byte 캡 적용 → ④ audit. 검증기 우회해도 DB role이 막음(심층 방어).
- 풀 키 = `dataSourceId`. 비번은 `revealSecret`로 매 풀 생성 시 1회 복호 → 메모리(풀 클로저)에만.
- 수락 기준: 로컬에서 임의 data_source에 SELECT 실행 + DDL/UPDATE 거부 + 캡 동작 + audit 한 줄.

---

## 4. Phase 2 — Trigger.dev `analyze` 에이전트 태스크 (`trigger/analyze.ts`)

```ts
// trigger/analyze.ts (스켈레톤 — 옵션명은 Phase 0에서 대조)
import { task } from "@trigger.dev/sdk/v3";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { executeReadOnly, getSchema } from "@/lib/query";

export const analyze = task({
  id: "analyze",
  machine: "medium",
  maxDuration: undefined, // timeout.None
  run: async (payload: { orgId: string; dataSourceId: string; userId: string; runId: string; question: string }, { ctx }) => {
    const { orgId, dataSourceId } = payload;

    // (1) in-process SQL 툴 — 핸들러는 부모 프로세스에서 실행. dataSourceId는 payload에 '바인딩'(모델이 못 고름)
    const sqlServer = createSdkMcpServer({
      name: "supalens",
      tools: [
        tool("execute_sql", "Run a READ-ONLY SQL query against the connected database.",
          { sql: z.string() },
          async ({ sql }) => {
            const r = await executeReadOnly(dataSourceId, sql, { maxRows: 1000, timeoutMs: 30000, actor: { kind: "system", id: payload.runId } });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
          }),
        tool("get_schema", "Get tables/columns of the connected database.",
          { schema: z.string().optional() },
          async ({ schema }) => {
            const s = await getSchema(dataSourceId, schema);
            return { content: [{ type: "text", text: JSON.stringify(s) }] };
          }),
      ],
    });

    // (2) query() — 최소권한 락다운
    const it = query({
      prompt: payload.question,
      options: {
        model: "claude-opus-4-8",                 // 또는 sonnet — 비용/품질 트레이드오프
        systemPrompt: SYSTEM_PROMPT,               // 커스텀 minimal. preset 'claude_code' 쓰지 말 것
        mcpServers: { supalens: sqlServer },
        allowedTools: ["mcp__supalens__execute_sql", "mcp__supalens__get_schema"],
        tools: [],                                 // 빌트인 Bash/Read/Write/WebFetch 전부 제거
        settingSources: [],                        // .mcp.json/유저·프로젝트 설정 무시
        strictMcpConfig: true,
        permissionMode: "dontAsk",                 // 헤드리스: 미승인=deny
        maxTurns: 25,
        includePartialMessages: true,              // 스트리밍
        canUseTool: async (name, input) => {       // 결정론적 deny-gate (모델 의도 무관)
          if (name !== "mcp__supalens__execute_sql" && name !== "mcp__supalens__get_schema")
            return { behavior: "deny", message: "tool not allowed" };
          // data_source는 payload에서만, 모델 input의 dataSourceId는 무시/거부
          return { behavior: "allow", updatedInput: input };
        },
        env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }, // KMS/DB 시크릿 subprocess에서 배제
        cwd: `/tmp/run-${payload.runId}`,          // per-run 격리
      },
    });

    // (3) 스트리밍 + 예산 캡
    let usage = { in: 0, out: 0 };
    for await (const msg of it) {
      // metadata.stream / Trigger Realtime으로 브라우저에 forward (Phase 4)
      // usage 누적 → 예산 초과 시 it.interrupt()/AbortSignal
    }
    // 최종 분석 + usage를 agent_runs에 저장
  },
});
```

수락 기준: 로컬 `npx trigger dev`에서 한 data_source에 대해 "테이블 목록 보여줘" → get_schema 호출 → 응답. SQL injection/DDL 시도 → guard+role+canUseTool로 차단.

---

## 5. Phase 3 — Next.js BFF (`src/app/api/agent/`)

```
src/app/api/agent/analyze/route.ts   # POST: 인증 → membership(org) → data_source 소유 확인
                                      #       → tasks.trigger("analyze", payload)
                                      #       → run.id + publicAccessToken(해당 run scope) 반환
```
```ts
// 핵심
const { id } = await tasks.trigger("analyze", { orgId, dataSourceId, userId, runId, question });
const publicToken = await auth.createPublicToken({ scopes: { read: { runs: [id] } }, expirationTime: "1h" });
return Response.json({ runId: id, publicToken });
```
- **DB 시크릿/KMS는 BFF에 없음.** BFF는 트리거 + 토큰 발급만. `TRIGGER_SECRET_KEY`만 보유.
- data_source 소유 확인은 RLS(유저 JWT) 또는 service_role + 명시적 org 필터.

**마이그레이션 추가** `supabase/migrations/2026062911*_agent_runs.sql`:
```sql
create type agent_run_status as enum ('queued','running','succeeded','failed','cancelled');
create table agent_runs (
  id uuid primary key,                         -- = Trigger run의 우리쪽 id
  org_id uuid not null references organizations(id) on delete cascade,
  data_source_id uuid references data_sources(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  question text not null,
  status agent_run_status not null default 'queued',
  trigger_run_id text,                          -- Trigger.dev run id
  turns int default 0,
  tokens_in bigint default 0, tokens_out bigint default 0, cost_usd numeric(10,4) default 0,
  result jsonb, error text,
  created_at timestamptz not null default now(), ended_at timestamptz
);
-- RLS: org 멤버 select; insert/update는 service_role(태스크/BFF)만
```
(선택) `agent_messages` — 트랜스크립트 영속(재개/감사용). MVP는 생략 가능.

---

## 6. Phase 4 — 브라우저 스트리밍 (`@trigger.dev/react-hooks`)

```tsx
// 클라이언트: BFF 응답의 {runId, publicToken}으로 run 스트림 직접 구독 (Vercel 안 거침)
const { run, streams } = useRealtimeRun(runId, { accessToken: publicToken });
// streams.<name> 으로 토큰/툴이벤트 렌더, run.status로 진행 표시
```
- 태스크 쪽: `metadata.stream("text", chunk)` 등으로 부분 메시지 emit.
- 끊기면 동일 runId+token으로 재구독 → **살아있는 호스트 스트림에 재부착**.
- 최소 UI: 질문 입력 + 스트리밍 답변 + 실행된 SQL 표시(투명성).

**대안(필요 시):** Realtime 대신 BFF가 `runs.subscribeToRun()`을 SSE로 릴레이 — 단 Vercel 함수 시간 캡에 묶이므로 **Realtime 직결을 1순위**로.

---

## 7. Phase 5 — 보안 하드닝 (필수)

체크리스트 (대부분 Phase 2·3에 내장, 여기서 마감):
- [ ] **한 run = 한 테넌트** — dataSourceId는 BFF 세션에서 바인딩, 툴 클로저가 그 1개 풀만, `canUseTool`이 모델 제시 id 거부.
- [ ] **시크릿은 호스트에만** — 복호화 크레덴셜은 부모 프로세스 클로저. subprocess `env`/systemPrompt/툴 input·output에 절대 노출 X.
- [ ] **read-only 심층 방어** — ① supalens_ro = GRANT SELECT only + `statement_timeout`/`default_transaction_read_only` ② guard(SELECT-only) ③ row/byte 캡 ④ 시스템프롬프트가 툴 결과를 **UNTRUSTED 데이터**로 프레이밍.
- [ ] **write 툴 제거** — 대시보드/알림 생성은 에이전트가 아니라 별도 인가 경로.
- [ ] **per-tenant 동시성** — Trigger `queue: { concurrencyLimit }` + `concurrencyKey: orgId`로 테넌트당 동시 런 캡(테넌트 DB·풀 보호).
- [ ] **비용 캡** — `maxTurns` + usage 워처가 예산 초과 시 abort (SDK 네이티브 달러 캡 없음). agent_runs에 cost 기록.
- [ ] **컨테이너 격리** — per-run `cwd`+`CLAUDE_CONFIG_DIR`, `settingSources:[]`, auto-memory off → 공유 컨테이너 교차 누출 차단.
- [ ] **subprocess egress 제한** — 가능하면 `ANTHROPIC_BASE_URL` 프록시로 api.anthropic.com만.
- [ ] **감사 완전성** — 에이전트가 돌린 모든 SQL이 audit_log에, 크레덴셜 복호는 secret_access_log에.

---

## 8. Phase 6 — 백그라운드 잡 (나중, 선택)

같은 Trigger.dev에서 **scheduled task**로:
- `schema-refresh` — data_source별 `getSchema` 주기 갱신(`data_source_schemas`).
- `evaluate-alerts` — 등록 쿼리 fan-out 평가(테넌트당 concurrencyKey). 알럿 많아지면 여기서 Trigger schedules + concurrency로 처리(별도 Inngest 불필요할 수도).
- `process-revocations` — `credential_revocations` outbox 재시도.

---

## 9. Phase 7 — 테스트 · 배포 · 관측

- 단위: query 엔진(guard/캡/audit), canUseTool 게이트, dsn 조립.
- 통합: 로컬 `npx trigger dev` + 테스트 Supabase 프로젝트로 end-to-end 1건.
- 배포: `npx trigger.dev deploy` (에이전트), Vercel(BFF/UI). env 분리.
- 관측: Trigger 대시보드(런/에러/usage) + agent_runs 테이블 + audit_log.

---

## 10. 마일스톤 순서 (권장)

1. **Phase 0** 토대 (SDK 핀, server-only 제거, Trigger init) — 0.5d
2. **Phase 1** 쿼리 엔진 (단독 테스트) — 1d  ← 대시보드/MCP도 이걸 씀, 가치 높음
3. **Phase 2** analyze 태스크 (로컬 trigger dev) — 1d
4. **Phase 3** BFF + agent_runs 마이그레이션 — 0.5d
5. **Phase 4** 클라이언트 스트리밍 + 최소 UI — 0.5d
6. **Phase 5** 보안 하드닝 마감 — 0.5d
7. (Phase 6/7 이후)

> 가장 먼저 **Phase 1(쿼리 엔진)**부터 — 에이전트의 손발이고, 대시보드/MCP도 공유하며, 에이전트 없이 단독 검증 가능.

---

## 11. 미해결/검증 필요

- **SDK 옵션명** — pre-1.0. Phase 0에서 실제 types로 대조 (`canUseTool` 반환형, `tools:[]`로 빌트인 끄는 정확한 방법, 스트리밍 메시지 형태).
- **`claude` CLI 번들 여부** — Trigger 런타임 이미지에 바이너리/Node 버전 충족 확인.
- **머신 메모리** — 에이전트 세션 실측 후 small-2x/medium 확정.
- **모델 선택** — opus(품질) vs sonnet(비용). 초기 sonnet, 무거운 분석만 opus 라우팅 고려.
- **transaction pooler + 긴 분석** — 6543은 prepared statement off. 장수 분석 워커면 session(5432) 검토.
