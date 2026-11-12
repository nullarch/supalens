# Firestore 커넥터 (Connect Firebase) — 구현 마스터 플랜

> **목표:** supalens 유저가 **본인의 Firebase Firestore를 데이터소스로 연결**해서, AI 에이전트가 컬렉션/문서를 읽고 분석·차트를 만들게 한다.
>
> **결론 먼저:** Firestore는 `postgres`/`mysql` 옆에 붙는 **새 engine이 아니라 새 데이터소스 *계열(family)*** 이다. SQL 문자열·`information_schema`·관계형 rows가 없기 때문. 그래서 `src/lib/query/*`(SQL 엔진)를 **리팩터링하지 않고**, `code-agent`가 그랬듯 **병렬 모듈**(`src/lib/firestore/*` + `firestore-agent/*` + `trigger/analyze-firestore.ts`)로 붙인다.
>
> **v1 핵심 단순화:** (1) 시각화·위젯·대시보드 렌더 계층은 **손대지 않는다** — Firestore 문서를 `{columns, rows}`로 flatten만 하면 그대로 흐른다. (2) "ask" 라이브 답변은 embedded `sample`로 렌더되므로 viz 스키마 변경 없이 동작. 영속 위젯 live-refresh만 v1.5로 미룬다. (3) MCP의 `execute_sql`은 Firestore 소스를 **거부**(병렬 NoSQL 툴은 v1.5).
>
> **제품 포지셔닝(중요):** "무엇이든 물어보는 BI"가 아니라 **"Firebase 앱 운영 인사이트"**. Firestore는 JOIN 불가·집계 빈약·인덱스 필수·문서당 과금이므로, 에이전트를 **집계 우선 + 하드 읽기 상한**으로 구조적으로 가둔다(§6).
>
> _작성 2026-07-02 · 토폴로지·보안 불변식은 [github.md](./github.md)·[agent-implementation-plan.md](./agent-implementation-plan.md)를 따른다. `code-agent`(inverse tool profile) 패턴을 그대로 미러링한다._

---

## 0. 핵심 인식 — Firestore는 새 engine이 아니라 새 계열

`data_sources.engine`(`postgres|mysql`)은 주석대로 **"wire protocol / driver"** 다. pg와 mysql이 **하나의 툴 프로파일**(`execute_sql`/`get_schema`)을 공유하는 이유는 *둘 다 SQL 문자열을 넣으면 관계형 rows가 나오기 때문*이다. Firestore는 이 전제를 전부 깬다:

| SQL 소스(pg/mysql) | Firestore |
|---|---|
| SQL 문자열 쿼리 | SDK 메서드 체인 (`collection().where().orderBy().limit()`) |
| host/port/user/password (TCP) | `project_id` + 서비스계정 JSON (Google SDK, HTTPS) |
| 관계형 rows | 이질적 JSON 문서(중첩·배열·서브컬렉션) |
| `information_schema` 스키마 | 스키마 없음 → 문서 샘플링으로 필드 추론 |
| JOIN·GROUP BY·window·subquery | JOIN 없음 · 집계는 `count/sum/avg`만(단일 필드·인덱스 필수) |
| `begin read only`·`statement_timeout`·`supalens_ro` role | 읽기 전용은 **구조적**(write 툴 부재) + IAM `datastore.viewer` |

**따라서 "SQL 소스 vs Firestore"는 `code-agent`의 "DB 렌즈 vs 코드 렌즈"와 정확히 같은 관계다** — 락다운·시각화·Trigger 토폴로지는 공유하고, **데이터 접근 계층과 툴 프로파일만 반전**한다.

---

## 1. 재사용하는 기존 자산

| 자산 | 위치 | Firestore에서의 역할 |
|---|---|---|
| **시각화/위젯/그리드/영속 테이블** | `src/lib/viz/*`, `src/components/dashboard/widgets/*`, `dashboard_widgets` | 렌더러는 `{columns, rows}`를 **컬럼명으로만** 소비(provenance-blind). flatten된 문서가 **무변경**으로 흐름 |
| `propose_visualization` 툴 | `src/lib/agent/tools.ts:80-124` | **그대로 재사용** — in-memory `store`만 읽고 `referencedColumns().filter(c=>!columns.includes(c))`로 검증 |
| 에이전트 락다운 런타임 | `src/lib/agent/run-analysis.ts`, `code-agent/run-code-analysis.ts` | `tools:[]`·`disallowedTools`·`settingSources:[]`·`strictMcpConfig`·`dontAsk`·`buildChildEnv()`·토큰예산 **전부 그대로**, 툴이름·프롬프트만 교체 |
| 시크릿 vault | `src/lib/secrets/service.ts` (`putSecret`/`getCurrentSecret`/`revealSecret`) | 서비스계정 JSON을 `gcp_service_account` kind로 봉투 암호화 저장. `plaintext: string` 그대로 사용 |
| 봉투 암호화 | `src/lib/crypto/{kek,envelope}.ts` | AAD가 `(id‖org_id‖kind‖dek_id)` → **새 kind가 AAD에 자동 반영**, 코드 변경 0 |
| Trigger 에이전트 토폴로지 | `trigger/analyze.ts`, `trigger/analyze-code.ts`, `trigger.config.ts` | `trigger/analyze-firestore.ts`가 미러링 (per-source concurrencyKey) |
| BFF → Trigger 핸드오프 + run-scoped 토큰 | `src/app/api/agent/analyze/route.ts` | engine으로 분기: `firestore` → `analyze-firestore` 트리거 |
| 실시간 스트림 UI | `src/components/agent/{AgentStream,AgentView}` | Firestore run도 그대로(청크 포맷 동일) |
| run 기록 모델 | `agent_runs` (`20260629110000_agent_runs.sql`) | Firestore run도 동일 테이블 재사용 |
| 연결 UI 컨테이너 | `src/app/app/settings/integrations/*`, `DirectDataSourceForm.tsx` | Firestore 폼 추가(카드/토큰 스타일 재사용) |
| 폴리모픽 데이터 모델 | `data_sources`(engine+provider+JSONB config) | `config:{project_id}` 흡수 — **구조 마이그레이션 불필요**(db-schema.md §7 그대로) |

**신규로 만드는 것:** Firestore 데이터 접근 계층(`src/lib/firestore/*`), Firestore 에이전트 3종(`firestore-agent/*`), Trigger 태스크, 등록/연결 로직 + UI 폼, 마이그레이션(enum·secret kind·CHECK).

**v1에서 손대지 않는 것 (중요):** `src/lib/query/*`(SQL 엔진 — 리팩터링 없음), 시각화 렌더 계층 전체, `propose_visualization`, 봉투 암호화 코드. ← 병렬-모듈 결정 덕분.

---

## 2. Firestore 제약 & 가드레일 (제품 진실 — 반드시 코드에 박을 것)

Firestore는 OLTP 문서 스토어지 분석 엔진이 아니다. 아래를 **툴·프롬프트 레벨에서 구조적으로** 강제한다:

1. **JOIN 없음** — 다중 컬렉션 조인 질문은 애초에 표현 불가. 프롬프트가 단일 컬렉션(+ collectionGroup) 범위로 유도.
2. **집계 우선** — 전용 `aggregate` 툴(`count`/`sum`/`average`, 서버측·저비용)을 노출하고, 프롬프트가 "전체 스캔 후 클라 집계 금지, 가능하면 aggregate 사용"을 명령. **`query_documents`에 full-collection 스캔 경로를 열지 않는다**(항상 `limit` 강제, 기본 100/최대 1000).
3. **인덱스 필수** — 복합 `where`+`orderBy`는 복합 인덱스가 없으면 실패. 툴이 인덱스 부재 에러를 **잡아 "이 조합은 인덱스가 필요하다"** 는 안내 메시지로 반환(모델이 더 단순한 쿼리로 self-repair — `execute_sql`이 컬럼 목록을 돌려주는 것과 동형).
4. **스키마 없음** — `get_collection_schema`는 N개 문서를 샘플링해 필드 추론. 결과에 `sampled: N`을 명시하고 "권위 스키마 아님, 일부 문서에만 있는 필드는 누락 가능"을 프롬프트에 고지.
5. **비용** — 읽기당 과금. 하드 `limit` + `aggregate` 우선 + run당 총 읽기 문서 수 상한(예: 10k)으로 비용 폭탄 차단.
6. **읽기 전용 2중** — (a) 구조적: write/update/delete 툴이 **존재하지 않음**(`code-agent`의 no-execute와 동일 원리). (b) IAM: 연결 시 서비스계정이 `roles/datastore.viewer`만 갖도록 문서/검증 권장.

---

## 3. 한눈에 (SQL 에이전트와 동일 토폴로지)

```
① 연결 (Firebase 데이터소스 등록)
  Browser → POST /api/data-sources  (type=firestore)
       · project_id + 서비스계정 JSON 입력
       · SDK 프로브: firestore.listCollections() 1건 (인증+연결 확인, select 1 대체)
       · data_sources insert (engine='firestore', provider='firebase',
                              config:{project_id, client_email, database_id})
       · 서비스계정 JSON → vault (kind='gcp_service_account', parent=dataSourceId)
       · (SSRF 해당 없음 — 사용자 host 아님, Google API 고정)

② 분석 run (DB 에이전트와 동일 토폴로지)
  Browser → POST /api/agent/analyze  (BFF: TRIGGER_SECRET_KEY만)
       · 멤버십 확인 → agent_runs insert(queued)
       · engine으로 분기:  postgres|mysql → tasks.trigger("analyze")
                          firestore      → tasks.trigger("analyze-firestore", {dataSourceId, runId})
       · auth.createPublicToken({read:{runs:[triggerRunId]}}) → Browser
                                  │
                                  ▼
  Trigger.dev  trigger/analyze-firestore.ts        [HOST = 부모 프로세스]
   env(부모에만): SERVICE_ROLE · KEK_* · ANTHROPIC_API_KEY
   1. resolveFirestoreDataSource(dataSourceId)  → project_id + 서비스계정 JSON 복호(vault)
   2. Firestore SDK 클라이언트 = 부모 클로저 (자격증명은 여기만, 서브프로세스 env엔 없음)
   3. runFirestoreAnalysis()  → Claude Agent SDK query()  [서브프로세스, env 비움]
        도구: in-process list_collections / get_collection_schema / query_documents /
             aggregate / propose_visualization  (전부 read-only)
        문서 → flatten → {queryId, columns, rows} (execute_sql와 동일 계약)
   4. agent_runs.result 영속화 (visualizations 포함)
   5. metadata.stream("agent", …) ──→ Browser가 Trigger Realtime 직접 구독 (AgentStream 무변경)

③ 시각화
  · 라이브 "ask": VisualizationSpec.sample(=flatten된 {columns,rows})로 즉시 렌더 — viz 변경 0
  · 영속 위젯(v1): cached sample 저장, live-refresh 안 함 (fetch.ts:94가 sample 있으면 skip)
  · 영속 위젯 live-refresh(v1.5): VisualizationSpec.query를 union화 + runWidgetData에 firestore 분기
```

### 핵심 결정 (확정)

- **병렬 모듈, `src/lib/query` 리팩터링 없음** — `code-agent`가 `src/lib/repo/*`를 SQL 엔진과 나란히 만든 선례 그대로. Firestore 데이터소스는 `executeReadOnly`/`getSchema`/`resolveDataSource`(전부 `db_password`/pg·mysql 전제)로 **라우팅되지 않는다**.
- **분석 = Trigger.dev** — SQL/코드 에이전트와 동일. Vercel BFF는 engine으로 태스크만 분기.
- **읽기 전용 = 구조적** — write 툴 부재 + IAM viewer. `begin read only` 같은 SQL 장치는 해당 없음.
- **flatten이 유일한 어댑터** — 문서를 `{columns, rows}`로 정규화하면 시각화 계층 전체가 무변경 재사용.
- **v1은 enum 확장(catalog 승격 아님)** — db-schema.md §7의 "promotion trigger"에 해당하지만, 2번째 비-SQL 커넥터가 오기 전까지 enum이 마찰 적음. Firestore가 그 트리거임을 문서에 남김.

---

## 4. Phase 0 — 토대 & 결정 (먼저)

### 4.1 의존성
```bash
npm i @google-cloud/firestore      # firebase-admin보다 가벼움(Firestore만). Admin 권한 SDK.
```
- `listCollections()`/`collectionGroup()`은 Admin SDK 기능 — 클라이언트 SDK 아님. 서비스계정으로 init.
- Claude Agent SDK는 기존 에이전트가 핀한 버전 재사용.

### 4.2 환경변수
- **테넌트별 서비스계정은 env 아님 → vault.** 호스트 env 추가 없음(기존 `ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`KEK_*`로 충분).
- `.env.example`에 주석만: "Firestore 서비스계정은 유저가 연결 시 업로드 → vault(`gcp_service_account`)".

### 4.3 서비스계정 & IAM (연결 문서에 안내)
- 유저가 GCP 콘솔에서 서비스계정 생성 → **`roles/datastore.viewer`(읽기 전용) 부여** → JSON 키 발급 → supalens에 업로드.
- viewer role 권장은 defense-in-depth(구조적 read-only가 1차 방어). 문서에 "Owner/Editor 키 넣지 말 것" 명시.

### 4.4 `server-only` 가드 (⚠️ 기존 함정 동일)
`src/lib/firestore/*`, `src/lib/firestore-agent/*`는 Trigger 태스크에서 import → **`import 'server-only'` 넣지 말 것**(Node 번들에서 throw). `admin.ts`/`secrets/service.ts`와 동일 규약 — ESLint `no-restricted-imports`로 클라이언트 import만 차단.

---

## 5. Phase 1 — 데이터 모델

`ALTER TYPE ... ADD VALUE`는 **트랜잭션 밖 + 같은 트랜잭션 내 사용 불가**(db-schema.md §8). 그래서 **두 마이그레이션 파일로 분리**한다.

**`supabase/migrations/2026070310xxxx_firestore_enums.sql`** (값 추가만 — 커밋 후 사용 가능)
```sql
-- Firestore = 최초의 *document*(비-SQL) 커넥터. db-schema.md §7의 promotion trigger.
-- v1은 enum 유지; 2번째 비-SQL 커넥터 도입 시 connectors 카탈로그로 승격.
-- 'engine'은 드라이버-디스패치 키로 쓰인다: firestore의 읽기 경로는 문서 드라이버
-- (src/lib/firestore/*)이며 pg/mysql SQL 경로가 아니다.
ALTER TYPE ds_engine   ADD VALUE IF NOT EXISTS 'firestore';
ALTER TYPE ds_provider ADD VALUE IF NOT EXISTS 'firebase';
ALTER TYPE secret_kind ADD VALUE IF NOT EXISTS 'gcp_service_account';
```

**`supabase/migrations/2026070310yyyy_firestore_secret_check.sql`** (다음 파일 = 값 커밋 후)
```sql
-- secrets kind<->parent CHECK에 gcp_service_account 추가(= data_source_id에 귀속).
-- 인라인 CHECK라 자동 명명됨 + secrets엔 unnamed CHECK가 2개 → 이름 추측 금지.
-- 정의에 'oauth_refresh_token'이 든 CHECK(=kind<->parent)를 찾아 드롭 후 재생성(재실행 안전).
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'secrets'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%oauth_refresh_token%';
  if cname is not null then execute format('alter table secrets drop constraint %I', cname); end if;
end $$;
alter table secrets add constraint secrets_kind_parent_check check (
  (kind in ('db_password','ssl_client_key','provisioning_service_role','gcp_service_account')
     and data_source_id is not null and connection_id is null)
  or
  (kind = 'oauth_refresh_token'
     and connection_id is not null and data_source_id is null)
);
```
작성 후 `npm run db:reset`(로컬) / `db:push`(원격) → **`npm run db:types`**.

**config / secret 형상 (Firestore 데이터소스 1행):**
```
data_sources: { engine:'firestore', provider:'firebase', connection_id:null,
                config:{ project_id:'my-proj', client_email:'sa@my-proj.iam...', database_id:'(default)' } }
secrets:      { data_source_id:<ds>, kind:'gcp_service_account', is_current:true,
                ciphertext:AEAD(<서비스계정 JSON 전체>, AAD...) }
```
- `config`는 **비밀 아님**만: `project_id`/`client_email`/`database_id`. `reject_secret_keys` 트리거 정규식(`password|secret|token|private_key|credential|...`)에 걸리지 않음(확인 완료: 세 키 모두 미매치).
- **서비스계정 JSON 전체를 vault에** 저장(내부에 `private_key`·`token_uri` 포함 → 절대 config 금지). 런타임에 파싱해 SDK init.

---

## 6. Phase 2 — 연결/등록 플로우

`src/lib/data-sources/`에 Firestore 분기 추가 (SQL 직접연결 `register.ts` 미러).

| 파일 | 미러 | 책임 |
|---|---|---|
| `data-sources/validate.ts` | 기존 `directDataSourceSchema` | **discriminated union**: `{type:'sql', engine, host, port, ...}` \| `{type:'firestore', name, projectId, serviceAccountJson}` |
| `data-sources/register-firestore.ts` | `register.ts` | JSON 파싱·검증 → **프로브(`listCollections()`)** → `data_sources` insert(engine='firestore') → `putSecret(kind:'gcp_service_account', parent:{dataSourceId})`. **SSRF 없음**(사용자 host 아님) |
| `data-sources/test-connection.ts` | `select 1` | Firestore는 `listCollections()`(1건)로 인증+연결 확인 |

**API `src/app/api/data-sources/route.ts`** — 현재 SQL 직접연결만. 요청 body `type`로 분기(`firestore` → `registerFirestoreDataSource`). 반환/에러 규약 동일(`connection_failed`/`duplicate_name`).

**UI** — `DirectDataSourceForm.tsx`에 소스 타입 선택기 추가하거나 **`FirestoreDataSourceForm.tsx` 신설**(권장 — 필드셋이 완전히 다름): 이름 + project_id + 서비스계정 JSON(textarea 또는 파일 업로드) + "연결 테스트 후 추가". `settings/integrations/page.tsx`의 `directSources` 목록이 engine='firestore' 행도 함께 렌더(글리프만 추가).

---

## 7. Phase 3 — Firestore 데이터 접근 계층 (`src/lib/firestore/*`, 신규)

`src/lib/query/*`의 **문서-DB 평행 버전**. 호스트=부모 프로세스 전용(Trigger import).

| 파일 | SQL 대응 | 책임 |
|---|---|---|
| `firestore/resolve.ts` | `query/dsn.ts` | `resolveFirestoreDataSource(id)` → 행 읽기(config.project_id) + `revealSecret(gcp_service_account)` → `{projectId, credentials, orgId}`. **동일 TTL 캐시 패턴**(복호 자격증명 5분 캐시). SSRF 없음 |
| `firestore/client.ts` | `query/pool.ts` | 서비스계정으로 `new Firestore({projectId, credentials})`. dataSourceId별 캐시(풀 대응) |
| `firestore/query.ts` | `query/execute.ts` + `run.ts` | `queryDocuments({collection, where[], orderBy?, limit})` → **하드 limit** → 문서 fetch → **flatten** → `QueryResult{columns, rows, rowCount, truncated, durationMs}` + `recordQueryAudit`(재사용) |
| `firestore/aggregate.ts` | (신규) | `count`/`sum`/`average` 집계 쿼리(서버측·저비용). `QueryResult`로 반환 |
| `firestore/introspect.ts` | `query/introspect.ts` | `listCollections()` + 컬렉션당 N개 문서 샘플링 → 필드/타입 추론 → `{collection, sampled, fields:[{name,types,frequency}]}` |
| `firestore/flatten.ts` | (신규) | 중첩 객체 → dot 표기(`address.city`), 배열 → JSON 문자열/요약, Timestamp → ISO, GeoPoint/Ref → 문자열. **columns = 문서들의 필드키 합집합** |

**flatten 규칙(의미 손실 명시):** 중첩은 `a.b.c`, 배열은 요약(길이+미리보기) 또는 JSON, 문서 누락 필드는 `null`. 위젯 계층의 `coerceNum`이 문자열/숫자 혼재를 이미 흡수(agent C 확인). 이 규칙은 문서화하고 프롬프트가 인지하게 함.

---

## 8. Phase 4 — Firestore 에이전트 (`src/lib/firestore-agent/*`, 신규)

`src/lib/code-agent/*`를 **글자 그대로** 미러. 락다운 블록은 복붙, 3개 스왑 포인트만 교체.

### 8.1 툴 — `firestore-agent/tools.ts` (`agent/tools.ts` 미러)
`createSdkMcpServer({ name:'supalens_firestore', tools:[...] })`:
- `list_collections()` → 최상위 컬렉션(+ 선택 서브컬렉션 경로) 목록.
- `get_collection_schema({collection})` → 샘플링 추론(§7). 결과에 `sampled:N` 명시.
- `query_documents({collection, where?[], orderBy?, limit?})` → `src/lib/firestore/query.ts` 호출. **limit 강제**. 인덱스 부재 에러는 안내 메시지로 변환(self-repair). `store.set(queryId, {sql:<pseudo>, columns, rows})` + `sink.onQueryResult` (buildSqlTools와 동일).
- `aggregate({collection, op, field?, where?[]})` → 저비용 집계.
- **`propose_visualization` — `agent/tools.ts`에서 그대로 import/복제.** 변경 0(컬럼명 검증만).

> `store`의 `sql` 필드에는 **사람이 읽는 Firestore 쿼리 서술자**(예: `firestore: users where age>18 orderBy createdAt desc limit 100`)를 넣어 `VisualizationSpec.query.sql`의 `z.string().min(1)`을 만족(§9).

### 8.2 락다운 — `firestore-agent/run-firestore-analysis.ts` (`run-code-analysis.ts` 미러)
```
ALLOWED_TOOLS = ['mcp__supalens_firestore__list_collections','…get_collection_schema',
                 '…query_documents','…aggregate','…propose_visualization']
tools: []                                   // 내장 도구 전부 제거
disallowedTools: ['Bash','Read','Write','Edit','WebFetch','WebSearch','Glob','Grep']
settingSources: [], strictMcpConfig: true   // 무시
permissionMode: 'dontAsk', canUseTool: allow-list deny-gate
env: buildChildEnv()                        // 서브프로세스 env 비움 — 서비스계정/KEK/service_role 없음
maxTurns + maxTotalTokens abort
```
자격증명(Firestore 클라이언트)은 **부모 프로세스 툴 핸들러 클로저**에만 — `executeReadOnly`가 pg 풀을 클로저에 가두는 것과 동형. **no-write는 구조** — set/update/delete/add 툴이 아예 없음.

### 8.3 프롬프트 — `firestore-agent/system-prompt.ts` (신규)
`agent/system-prompt.ts`의 "Rules"를 문서-DB용으로 재작성: 컬렉션/문서/서브컬렉션, `where/orderBy/limit`, **JOIN 없음**, **집계는 `aggregate` 우선**, 인덱스 필요 시 단순화, 스키마는 **샘플**(권위 아님)·flatten된 dot 필드명 사용. "Visualizations" 블록은 backend-무관하므로 **거의 그대로**.

### 8.4 태스크 — `trigger/analyze-firestore.ts` (`analyze-code.ts` 미러)
`markRunning` → `resolveFirestoreDataSource`(호스트) → `runFirestoreAnalysis` → `persistRun`(throw에도 terminal 기록). `concurrencyKey: dataSourceId`. `emit()` → `metadata.stream('agent',…)` 그대로 → 브라우저 무변경.

### 8.5 태스크 분기 — **두 곳** (⚠️ 둘 다 고칠 것)
Firestore run을 트리거하는 지점이 **둘**이다. 하나만 고치면 다른 경로에서 SQL 에이전트가 돌아 매 쿼리 실패한다:
1. **BFF** `src/app/api/agent/analyze/route.ts` — 웹 UI "ask" 경로. engine 조회 → `firestore`면 `tasks.trigger('analyze-firestore', …)`, 아니면 기존 `analyze`.
2. **MCP `ask` 툴** `src/lib/mcp/tools.ts:482` — `tasks.trigger('analyze', …)`가 **하드코딩**돼 있음. 여기도 동일하게 engine 분기.

두 곳 모두 나머지(멤버십·`agent_runs` insert·public token/폴링)는 동일. 이 분기 덕분에 **MCP `ask` + `get_analysis`가 Firestore에서 SQL 소스와 완전히 동일하게 동작**한다(§10).

---

## 9. Phase 5 — 시각화 연동

- **v1 (스키마 변경 0):** 라이브 "ask" 답변은 `VisualizationSpec.sample`(flatten된 `{columns,rows}`)로 즉시 렌더. `query.sql`엔 서술자 문자열을 넣어 zod 통과. 영속 위젯은 **cached sample 저장 후 live-refresh 안 함** — `dashboards/fetch.ts:94`가 `sample`이 있으면 재실행을 건너뜀(agent C 확인).
- **v1.5 (live-refresh 필요 시):** `VisualizationSpec.query`(`viz/spec.ts:194`)를 discriminated union으로 확장 — `{kind:'sql', sql}` | `{kind:'firestore', collection, where, orderBy, limit}`. `dashboards/live.ts`의 `runWidgetData`에 firestore 분기 추가(`src/lib/firestore/query.ts` 호출). `buildDefaultTableSpec`/`sqlOf`도 union 대응.

---

## 10. MCP — Firestore 유저의 외부 MCP 클라이언트 경험

MCP는 외부 AI 클라이언트(Claude Desktop 등)가 `sl_`/MCP 토큰으로 supalens 워크스페이스에 붙어 쓰는 표면이다. Firestore 워크스페이스에서 툴별로 동작이 갈린다(전부 검증 완료):

| 분류 | 툴 | Firestore | 필요 작업 |
|---|---|---|---|
| **A. backend 무관** | `get_setup_status`·`list_data_sources`·`list_dashboards`·`list_widgets` | ✅ 이미 동작 | `get_setup_status`의 SQL 편향 `hints` 문구만 engine별로 |
| **B. NL 에이전트 경로** | `ask` + `get_analysis` | 🟡 **v1 parity 가능** | `ask`의 `tasks.trigger('analyze')` engine 분기(§8.5 #2) 하나면 끝. `get_analysis`는 무변경(`agent_runs.result`만 읽음) |
| **C. raw 쿼리 툴** | `get_schema`·`execute_sql` | ❌→v1.5 | Firestore 소스면 `resolveDataSource`가 `db_password` 못 찾아 **내부 에러 leak**. **v1: clean guard**(engine='firestore' 감지 → "Firestore 소스입니다 — `ask`를 쓰세요" 반환). **v1.5:** 병렬 `list_collections`/`query_documents`/`aggregate` 툴 추가(`buildFirestoreTools`와 로직 공유) |
| **D. SQL 영속화 툴** | `register_query`·`create_dashboard`·`add_widget` | ❌→v1.5 | `sql`을 받아 `buildWidgetSpec`→`executeReadOnly` → 같은 실패. parity는 Firestore 서술자 + `VisualizationSpec.query` union(§9 v1.5) + Firestore용 `buildWidgetSpec`. **v1: clean guard** |

**핵심:** v1에서 **A는 이미, B는 브랜치 하나로 parity** — 즉 "NL로 물어보고 결과·차트 받기"는 Firestore 유저도 MCP로 SQL 유저와 동일하게 된다. **C·D(raw SQL/영속화)는 v1.5** 이며, v1에서는 최소한 **clean guard**로 혼란스러운 내부 에러(`no db_password secret …`) 대신 명확한 안내를 반환해야 한다.

> **정적 툴 목록 한계(v1.5 개선):** `registerSupalensTools(server)`는 ctx 없이 **모든 툴을 정적 등록**하므로, Firestore 전용 워크스페이스에도 `execute_sql`/`get_schema`가 계속 광고된다(외부 모델이 시도 → 실패). 워크스페이스 engine에 따라 광고 툴셋을 바꾸려면 등록 시점에 ctx를 주입하도록 재구성 필요 — v1.5. v1은 "광고되지만 clean guard로 거부"로 충분.

---

## 11. 보안 불변식 매핑 (SQL 에이전트 → Firestore 에이전트)

| 불변식 | SQL 에이전트 | Firestore 에이전트 |
|---|---|---|
| **one run = one tenant** | `dataSourceId` payload 바인딩 | 동일 — `dataSourceId` payload 바인딩, 모델이 소스 선택 불가 |
| **비밀은 host에만** | db 비번 `dsn.ts` 풀 클로저, `buildChildEnv()`가 서브프로세스 env 비움 | 서비스계정 JSON `resolve.ts`→클라이언트 클로저, `buildChildEnv()` 동일. 서브프로세스에 자격증명 0 |
| **엄격 read-only** | SELECT-only, `begin read only`, `supalens_ro`, timeout | **write 툴 부재(구조적)** + IAM `datastore.viewer` + 하드 limit + run 읽기 상한 |
| **내장 도구 off** | `tools:[]`, `disallowedTools`, `dontAsk` | 동일 |
| **untrusted 무시** | `settingSources:[]`, `strictMcpConfig` | 동일. 추가로 **문서 내용을 UNTRUSTED로 취급**(프롬프트 인젝션 방지) |
| **deny-gate** | `canUseTool` allow-list | 5개 Firestore 툴 allow-list |
| **per-tenant 동시성** | `concurrencyKey: dataSourceId` | 동일 |
| **비용 캡** | `maxTurns`+`maxTotalTokens` | 동일 + **문서 읽기 상한**(Firestore 과금 특유) |
| **감사** | 쿼리→`audit_log`, reveal→`secret_access_log` | 동일(`recordQueryAudit` 재사용, reveal 감사 자동) |
| **SSRF** | connect+매 쿼리 `resolveSafeHost` | **해당 없음** — 사용자 host 아님(Google API 고정) |

---

## 12. 신규/수정 파일 전체 목록

**신규**
```
src/lib/firestore/{resolve,client,query,aggregate,introspect,flatten}.ts
src/lib/firestore-agent/{run-firestore-analysis,tools,system-prompt}.ts
src/lib/data-sources/register-firestore.ts
src/components/data-sources/FirestoreDataSourceForm.tsx
trigger/analyze-firestore.ts
supabase/migrations/2026070310xxxx_firestore_enums.sql
supabase/migrations/2026070310yyyy_firestore_secret_check.sql
```
**수정**
```
src/lib/data-sources/{validate.ts,test-connection.ts,index.ts}   (firestore 분기)
src/app/api/data-sources/route.ts                                (type=firestore 분기)
src/app/api/agent/analyze/route.ts                               (v1: engine으로 태스크 분기 — 지점 1/2)
src/lib/mcp/tools.ts                                             (v1: `ask` engine 분기[지점 2/2] + C·D 툴 clean guard / v1.5: 병렬 Firestore 툴)
src/app/app/settings/integrations/page.tsx                       (Firestore 폼/카드)
src/lib/secrets/service.ts                                       (SecretKind 유니온에 gcp_service_account)
src/lib/viz/spec.ts                                              (v1.5: query union) — v1 불필요
src/lib/dashboards/live.ts                                       (v1.5: firestore refresh 분기)
trigger.config.ts                                                (analyze-firestore 등록 — 필요 시)
package.json                                                     (@google-cloud/firestore)
src/utils/supabase/schema.type.ts                                (db:types 자동 재생성)
eslint config                                                    (firestore/* client import 금지)
```

---

## 13. 빌드 순서 체크리스트

- [x] **P0** `@google-cloud/firestore@^8.6.0` 설치 ✅ · 서비스계정+`datastore.viewer` 안내(연결 UI에서) · `server-only` 가드 규약(각 파일 헤더 주석)
- [x] **P1** 마이그레이션 2파일(enum → CHECK) 작성 + **로컬 reset 검증** ✅ + **원격 `db:push` 적용** ✅ + **`db:types` 재생성**(firestore/gcp_service_account 반영) ✅ · `SecretKind` 유니온 갱신 ✅
- [x] **P2** `firestore/{resolve,client,query,aggregate,introspect,flatten,index}.ts` 작성 ✅ · flatten 단위테스트 7/7 통과 ✅ · 타입 에러 0 ✅ · _(limit 강제·자격증명 미잔존은 각각 live-Firestore 통합테스트·P4 agent 계층에서 검증)_
- [x] **P3** 등록 ✅ — `register-firestore.ts`(프로브→insert→vault) · `validate.ts` firestore 스키마/파서(추가형: 별도 스키마 + 라우트 `type` 분기 → **SQL 경로 무변경**, union보다 안전) · `firestore/probe.ts`(listCollections) · API 분기 · `FirestoreDataSourceForm.tsx` · integrations 페이지 Firestore 카드 · `remove.ts` firestore 캐시 무효화. tsc 0 회귀 · 35 테스트 통과. _(실제 프로브/등록 end-to-end는 진짜 서비스계정 필요)_
- [x] **P4** ✅ — `firestore-agent/{system-prompt,tools,run-firestore-analysis}.ts`(code-agent 미러, 락다운 동일) + `trigger/analyze-firestore.ts`(auto-discover, config 변경 불필요) + **태스크 분기 3곳**: BFF `/api/agent/analyze` · MCP `ask`(tools.ts:482) · 로컬 SSE 라우트(보너스, 로컬-dev firestore 지원). `AnalysisChunk`/`AnalysisResult`/`persistRun`/`AgentStream` 재사용. tsc 0 회귀. **`npx trigger.dev deploy` 완료 ✅ (Version 20260702.1, 3 tasks — analyze-firestore 프로덕션 배포됨; `trigger.config.ts`에 `build.external:['@google-cloud/firestore']` 추가로 grpc/protobuf 번들 이슈 회피).** _(남은 라이브 검증: 실제 Firebase 서비스계정만)_
- [x] **P4.5** ✅ MCP clean guard — `resolveSqlDataSourceId` 헬퍼로 `execute_sql`/`get_schema`/`register_query`/`create_dashboard`/`add_widget`가 Firestore 소스면 "이 소스는 Firestore입니다 — `ask`를 쓰세요" 명확히 반환(내부 에러 leak 방지). `get_setup_status` 힌트도 engine별로. tsc 0 회귀.
- [x] **P5** ✅ 영속 위젯 live-refresh — `VisualizationSpec.query`에 optional `firestore` 구조화 디스크립터(backward-compatible) · firestore-agent가 query_documents 결과에 디스크립터 stash + propose_viz 주입 · `runWidgetData`가 `query.firestore` 존재 시 `queryDocuments`로 분기(없으면 기존 `executeReadOnly`) · `fetch.ts` `queryOf`. tsc 0 회귀 · 35 테스트. _(aggregate 결과는 cached-sample, 집계 위젯 live-refresh는 향후)_
- [x] **P6** ✅ MCP 병렬 Firestore 툴 — `list_collections`/`get_collection_schema`/`query_documents`/`aggregate`를 `mcp/tools.ts`에 추가(데이터 계층 lazy import) + `resolveFirestoreDataSourceId` 가드(SQL 소스면 거부). tsc 0 회귀. _(engine별 동적 툴 목록 = 등록시 ctx 주입 리팩터는 향후; 현재는 광고 후 가드)_

---

## 14. 결정·리스크·오픈 이슈

1. **engine 값 vs 신규 `kind` 컬럼**(§5) — v1은 `ds_engine += firestore`(최소 마찰, 드라이버 디스패치 키로 사용). 2번째 비-SQL 커넥터 도입 시 db-schema.md §7의 `connectors` 카탈로그(dialect/transport/auth/capabilities)로 승격 권장. `kind='sql|document'` 컬럼은 UI 그룹핑용 선택.
2. **서브컬렉션/컬렉션 그룹** — Firestore 계층(collection→doc→subcollection)은 평면 테이블에 안 맞음. v1: 최상위 컬렉션 + 명시적 서브컬렉션 경로. `collectionGroup()`은 툴 옵션으로.
3. **스키마 추론 신뢰도** — 샘플링은 일부 문서 전용 필드를 놓침. 샘플 크기(기본 50?)·`sampled:N` 노출·프롬프트 고지로 완화. 향후 `data_source_objects` 캐시에 추론 스키마 저장 검토.
4. **인덱스 마찰** — 복합 쿼리 실패는 UX 벽. 툴이 인덱스 부재를 감지해 안내 + 단순 쿼리 유도. "필요 인덱스 링크 제시"는 향후.
5. **비용 상한 값** — run당 읽기 문서 상한/쿼리당 limit 기본값 실측 후 확정. 대시보드에 "이 분석은 N개 문서를 읽었습니다" 노출 검토.
6. **live-refresh 시점** — v1은 cached sample(정적). 유저가 "새로고침되는 Firestore 위젯"을 원하면 v1.5(query union) 승격.
7. **Firestore in Datastore mode / Enterprise(MongoDB 호환)** — v1은 Native mode 한정. 모드 감지 후 안내.
8. **포지셔닝 규율** — 마케팅/온보딩에서 "운영 인사이트"로 기대치 관리. "무엇이든 BI"가 필요한 유저는 **Firestore→BigQuery + BigQuery 커넥터**(db-schema.md §7, 별도 트랙)로 안내.
