---
name: widget-recipes
description: >
  supalens 시각화 위젯/차트 시스템 수정 레시피. 새 차트 타입 추가, 기존 차트 수정, 위젯
  스타일/포맷 변경, VisualizationSpec 스키마 변경 등 "차트 추가해줘", "히트맵/게이지/펀넬
  넣어줘", "위젯이 이상하게 보여", "차트 색/축/툴팁 바꿔줘" 류 요청에 반드시 사용하라.
  하나의 spec이 에이전트→스트림→렌더러→영속화 전 층을 관통하므로, 이 스킬의 동기 수정
  지점 목록을 안 따르면 절반만 동작하는 차트가 된다.
---

# widget-recipes — 시각화 위젯 시스템 레시피

## 아키텍처 한 줄 요약

`src/lib/viz/spec.ts`의 `ChartSpec`(zod discriminatedUnion, 12타입)이 단일 진실이다.
에이전트가 `propose_visualization`으로 spec을 만들고, 그대로 스트림→`WidgetRenderer`→
`dashboard_widgets.spec` 영속화까지 **어댑터 없이** 흐른다. 인코딩은 결과 컬럼을
**이름으로** 참조한다 (에이전트는 `{columns, rows}`만 본다).

## 새 차트 타입 추가 — 동기 수정 지점 (전부 해야 함)

1. **`src/lib/viz/spec.ts`** — `z.object({ ..., type: z.literal('newtype'), ... })` 정의
   → `ChartSpec = z.discriminatedUnion('type', [...])` 배열에 추가 → 인코딩 컬럼이
   있으면 `referencedColumns()`에 해당 필드 수집 로직 추가. React/서버 import 금지
   (이 파일은 에이전트·렌더러·영속화가 모두 import — 순수 zod만).
2. **컴포넌트** — `src/components/dashboard/widgets/charts/NewWidget.tsx`
   (Recharts 3, `WidgetComponentProps` 시그니처). 스타일은 **전역 CSS 변수**
   (`--clay`, `--paper-2`, `theme.ts`)만 사용 — `.dx-*` 클래스 금지 (그건 `/app` 레이아웃
   전용이라 갤러리/공유 페이지에서 깨진다).
3. **`registry.tsx`** — Recharts 기반이면 `chart(() => import(...))` 로 **lazy 등록**
   (ssr:false + ChartSkeleton — KPI/표만 있는 화면에 차트 번들이 실리지 않게 하는 관례),
   순수 CSS/SVG 타일이면 정적 import. `WIDGET_REGISTRY`에 타입 매핑 + 차트형이면
   `CHART_TYPES` Set에도 추가 (본문 높이/패딩 처리용).
4. **`__fixtures__/samples.ts`** — 대표 샘플 + 빈 데이터/절단 엣지케이스 추가, 적절한
   `GROUPS` 그룹에 배치.
5. **눈 검증** — `npm run dev` → `/dev/dashboard/widgets` 갤러리에서 라이트/다크 모두
   확인 (프로덕션에선 notFound라 안전).
6. **에이전트가 쓰게 하려면** — `src/lib/agent/system-prompt.ts`의 차트 선택 가이드에
   새 타입의 "언제 쓰는가"를 한 줄 추가 (스키마에만 있으면 모델이 거의 안 고른다).
   Firestore 에이전트도 같은 `propose_visualization`을 재사용하므로 추가 작업 없음.

버전 마이그레이션: 기존 spec의 **의미가 바뀌는** 변경(필드 rename 등)이면 `SPEC_VERSION`
올리고 `migrateSpec()`에 변환 추가 — DB에 이미 저장된 위젯이 있기 때문. 단순 추가는 불필요.

## 기존 차트 수정 시

- 여러 타입이 한 컴포넌트를 공유한다: bar/stackedBar/groupedBar → `BarWidget`,
  line/multiLine → `LineWidget`, pie/donut → `PieWidget`. 한 타입만 고칠 땐 spec의
  `type` 분기로 처리하고 다른 타입 회귀를 갤러리에서 확인.
- 숫자/날짜 포맷은 `src/lib/viz/format.ts`의 `formatValue` (ko-KR) 한 곳에서.
- `WidgetRenderer`는 full `VisualizationSpec` envelope와 bare `ChartSpec` **둘 다**
  받는다 — 렌더러 수정 시 두 입력 모두 유지.

## 데이터 흐름 주의점

- 위젯의 `sample`은 캐시 스냅샷이다. SQL이 바뀌면 `sample: null`로 밀어야 다음 로드에
  재실행된다 (`updateWidget`이 이미 그렇게 함).
- 대시보드 live 재실행은 `query.sql`(SQL) vs `query.firestore`(구조화 디스크립터)로
  분기한다 — envelope의 query 형태를 바꾸면 `runWidgetData` 분기도 확인.
- 위젯은 `/app/dashboards`, `/dev` 갤러리, `/share/[token]`, `/app/ask` 스트림 4곳에서
  렌더된다 — 전역 변수 기반 스타일 관례를 지키면 4곳 모두 자동으로 맞는다.
