---
name: agent-tool-recipes
description: >
  supalens AI 에이전트(SQL/code/firestore 러너)에 도구를 추가·수정하는 전체 워크스루.
  "에이전트에 ~기능/도구 추가해줘", "에이전트가 ~도 할 수 있게", "propose_* 도구",
  "에이전트가 파일/차트/알림을 만들게", MCP in-process 도구 작업이면 반드시 이 스킬을
  따라라. 도구 추가는 샌드박스 보안 경계를 넓히는 일이라 순서와 체크가 정해져 있다 —
  즉흥 추가는 시크릿 노출/테넌트 경계 붕괴로 직결된다.
---

# agent-tool-recipes — 에이전트 도구 추가 워크스루

## 설계 원칙 (도구를 만들기 전에 답하라)

1. **이 도구가 읽는 것은 무엇인가?** 허용되는 소스는 둘뿐:
   - 부모 프로세스 클로저의 in-memory 상태 (예: `execute_sql`이 쌓은 결과 Map —
     `propose_visualization`/`propose_kpi` 패턴)
   - 이미 잠금 검증된 데이터 경로 (guarded query engine, jail된 클론 FS)
   DB/vault/네트워크에 **직접** 닿는 도구는 만들지 마라 — 자격증명은 도구 핸들러의
   클로저에만 살고, 모델 컨텍스트와 서브프로세스엔 절대 없다.
2. **쓰기인가?** 에이전트는 구조적으로 읽기 전용이다. "생성"이 필요하면 도구는 **제안만
   수집**하고(콜백 sink 패턴), 실제 쓰기는 런 종료 후 부모/별도 인가 경로가 수행한다
   (`kpiSink` → `apply` 승인 플로우가 표준).
3. **테넌트 바인딩** — 도구가 대상으로 삼는 자원(dataSourceId/repoId)은 **런 payload에
   바인딩**되어 클로저로 들어간다. 모델 입력으로 자원 id를 받는 도구는 금지 (one run =
   one tenant invariant).

## 추가 절차 (SQL 에이전트 기준; code/firestore도 동일 골격)

1. **핸들러** — `src/lib/agent/tools.ts`의 `buildSqlTools()` 안에 SDK `tool(name,
   description, zodInputSchema, handler)`로 추가. 입력 검증은 zod가, 컬럼 존재 검증
   실패 시엔 **유효 값 목록을 에러로 반환**해 모델이 자가 수정하게 (self-repair 관례).
   결과는 `content: [{type:'text', text: JSON.stringify(...)}]`.
2. **allow-list 2곳 + 핀 테스트** — 도구의 풀네임은 `mcp__supalens__<name>`.
   - `src/lib/agent/run-analysis.ts`의 `ALLOWED_TOOLS`에 추가 (조건부 도구면 kpiSink처럼
     런 타입에 따라 확장하는 패턴)
   - `canUseTool`은 `makeToolGate(allowedTools)`가 자동 반영 — 건드릴 것 없음
   - **`src/lib/agent/lockdown.test.ts`의 핀 배열을 의도적으로 갱신** — 이 diff가
     "보안 리뷰 했음"의 증거다. 테스트 안 고치면 CI가 막는다 (설계된 동작).
3. **시스템 프롬프트** — `src/lib/agent/system-prompt.ts`에 언제/어떻게 쓰는지 한 단락.
   스키마에만 있는 도구는 모델이 거의 안 쓴다.
4. **스트림/영속화(선택)** — 도구 결과가 UI에 보여야 하면 `AnalysisChunk`에 variant 추가
   → 두 전송로(로컬 SSE `/api/agent/runs/[id]/stream`, Trigger Realtime `AgentStream`)는
   chunk를 그대로 포워딩하므로 보통 무변경 → `AgentView` 렌더링 추가 →
   `AnalysisResult`에 수집 필드 + `persistRun`이 `agent_runs.result`에 저장.
5. **미러 확인** — firestore 에이전트(`firestore-agent/tools.ts` + `run-firestore-analysis.ts`
   의 `ALLOWED_TOOLS`)와 code 에이전트(`code-agent/`)에도 필요한 도구인지 판단.
   `propose_visualization`은 firestore가 재사용하는 선례.
6. **검증** — `npm test`(lockdown 핀), 로컬에서 `/app/ask`로 실제 런 1회
   (`TRIGGER_SECRET_KEY` 없으면 로컬 SSE 경로로 돎). 배포 시 `npm run trigger:deploy`
   필수 — 에이전트는 Trigger 호스트에서 실행되므로 Vercel 배포만으론 반영 안 됨.

## 하지 말 것

- `PASSTHROUGH_ENV`에 도구가 필요로 하는 시크릿 추가 → 그 시크릿은 클로저로 전달하라.
  서브프로세스 env는 `buildChildEnv()` 교체 방식이 유일한 경로다.
- 도구 핸들러에서 `import 'server-only'` 모듈 import (Trigger 번들에서 터짐 — §2 규칙).
- 서브프로세스/도구 내부에 Sentry — 감싸는 Trigger 태스크가 이미 보고한다.
- 도구 결과에 시크릿/자격증명 echo — 도구 결과는 모델 컨텍스트에 들어간다.

## 참고 구현 (읽고 시작하면 빠르다)

- 결과-Map 소비 도구: `propose_visualization` (`agent/tools.ts`)
- 제안 수집 sink + 사후 승인: `propose_kpi` + `kpi/apply.ts`
- jail된 FS 도구 세트: `code-agent/tools.ts` (path-jail, secret-redact, ripgrep)
- 조건부 allow-list 확장: `run-analysis.ts`의 `kpiSink ? [...ALLOWED_TOOLS, ...] : ...`
