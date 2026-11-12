---
name: test-recipes
description: >
  supalens 테스트 작성 레시피 — 이 리포에서 검증된 모킹/구조 패턴의 복붙 출발점. 테스트를
  쓰거나 고치는 모든 작업("테스트 추가해줘", "이거 테스트 돼있어?", 새 invariant 구현 직후,
  버그 수정 후 회귀 테스트)에서 사용하라. 특히 Supabase admin 클라이언트 모킹, env 의존
  코드, 모듈 캐시가 있는 코드를 테스트할 때 이 스킬의 패턴을 그대로 따라라 — 즉흥 모킹은
  이 리포의 체이닝 쿼리 API에서 거의 항상 깨진다.
---

# test-recipes — supalens 테스트 패턴

## 기본 규칙

- 위치: 모듈 옆 `*.test.ts` (유닛), `*.integration.test.ts` (라이브 DB — env 게이트).
- 실행: `npm test` (전체) / `npx vitest run src/lib/foo/bar.test.ts` (단일).
- 관례: **보안/과금/정리 invariant는 구현과 같은 커밋에 핀 테스트**를 남긴다.
- 목표는 커버리지 %가 아니라 invariant 고정이다. "이게 회귀하면 보안/돈/데이터 사고인가?"
  → 그렇다면 테스트 대상. happy-path 나열은 가치가 낮다.
- 이 리포의 모범 예시: `alerts/evaluate.test.ts` (엣지 전이), `agent/lockdown.test.ts`
  (핀 배열), `query/dsn.test.ts` (모킹), `data-sources/ssrf.test.ts` (우회 벡터).

## 패턴 1 — Supabase admin 클라이언트 모킹 (dsn.test.ts 방식)

supabase-js는 체이닝이라 어설픈 모킹은 깨진다. **테스트가 실제로 타는 체인만** 정확히 흉내:

```ts
const rows = new Map<string, Record<string, unknown>>()

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          limit: async () => ({ data: rows.has(id) ? [rows.get(id)] : [], error: null }),
        }),
      }),
    }),
  }),
}))
// vi.mock은 호이스팅됨 — mock 선언 뒤에 대상 모듈을 import해도 안전
import { resolveDataSource } from './dsn'
```

- 협력 모듈(vault/SSRF 등)은 `vi.fn()`으로 개별 mock → `beforeEach`에서
  `mockReset().mockResolvedValue(...)` 로 기본값 재설정.
- 여러 테이블/체인이 필요하면 `from(table)`에서 분기하는 객체를 만들되, 필요한 만큼만.

## 패턴 2 — env 의존 코드 (fail-open, provider 선택 등)

```ts
beforeEach(() => {
  vi.resetModules()                       // 모듈 레벨 캐시(cached provider 등) 무효화
  delete process.env.PADDLE_API_KEY       // 대상 env를 명시적으로 정리
})
it('...', async () => {
  process.env.PADDLE_API_KEY = 'x'
  const { checkUsageQuota } = await import('./usage')  // 정적 import 대신 동적 import
  ...
})
afterEach(() => { delete process.env.PADDLE_API_KEY }) // 다른 테스트 오염 방지
```

모듈 레벨 `let cached`가 있는 코드는 반드시 이 방식 (kek-rotation.test.ts 참조).
모듈 캐시가 없다면 함수 인자로 env를 주입받게 리팩터하는 게 더 낫다
(`buildChildEnv(source = process.env)` 패턴 — 테스트가 순수해진다).

## 패턴 3 — 핀 테스트 (허용 목록/설정을 배열로 고정)

보안 allow-list나 설정이 "조용히" 바뀌는 걸 막는다. 바꾸려면 테스트도 의도적으로 바꿔야
하므로 diff에 드러난다:

```ts
it('pins the exact allow-lists (drift = security review, not refactor)', () => {
  expect(ALLOWED_TOOLS).toEqual(['mcp__supalens__execute_sql', ...])
})
```

이름 패턴 검사도 유효: PASSTHROUGH_ENV에 `/_KEY|_SECRET|_TOKEN/i` 매칭 이름이 들어오면
실패 — 미래의 실수를 잡는 테스트.

## 패턴 4 — 순수 로직은 io에서 분리해서 테스트

이 리포의 설계 관례: 결정 로직은 순수 함수(`alerts/evaluate.ts`), io는 셸(`runner.ts`).
새 기능도 이 분리를 유지하면 러너 모킹 없이 결정 로직만 촘촘히 테스트할 수 있다.
시간 의존 로직은 `now`를 인자로 주입 (`rateLimit(key, limit, windowMs, now)` 패턴).

## 패턴 5 — 통합 테스트 (라이브 DB 필요)

```ts
const url = process.env.TEST_PG_URL
const d = url ? describe : describe.skip   // env 없으면 스킵 (CI 기본 스킵)
```

주의: **권위 있는 보안 층(READ ONLY tx 등)이 통합 테스트에만 있으면 평소 CI에선 안 돈다.**
가능하면 순수 층(정규식 가드 등)에도 같은 invariant의 유닛 테스트를 병행하라.

## 안티패턴

- `.single()` 흉내 — 앱 관례가 `.limit(1)`이므로 mock도 limit 체인으로.
- 테스트 간 공유 상태 방치 — 모듈 캐시·Map·env는 beforeEach에서 리셋 or 유니크 키 사용.
- 구현 내부(호출 순서 등)에 대한 과잉 단언 — 관찰 가능한 결과와 invariant만 단언.
