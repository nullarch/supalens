---
name: migration-recipes
description: >
  supalens Supabase 마이그레이션 작성 레시피 + 복붙용 SQL 템플릿. 이 리포에서 테이블/컬럼/
  enum/RLS 정책/트리거/RPC를 추가·수정하는 모든 DB 작업에 사용하라. "테이블 만들어줘",
  "컬럼 추가", "마이그레이션", "RLS", "스키마 변경" 등 DB 스키마를 건드리는 요청이면 코드를
  쓰기 전에 반드시 이 스킬의 템플릿에서 시작하라 — 관례(soft-delete, RLS 정책 이름,
  updated_at 트리거, guard 트리거)를 처음부터 맞추는 것이 재작업보다 싸다.
---

# migration-recipes — supalens DB 스키마 레시피

## 절차 (항상 이 순서)

```bash
npm run db:new <snake_case_name>   # supabase/migrations/<ts>_<name>.sql 생성
# 파일 작성 (아래 템플릿) → 로컬 확인이 필요하면 npm run db:reset
npm run db:push                    # 원격 적용
npm run db:types                   # 필수! src/utils/supabase/schema.type.ts 재생성 → 커밋 포함
```

주의: 이미 유저가 있는 프로젝트에 per-user 행 FK가 걸리는 새 테이블을 추가할 때는 forward
트리거만으론 부족하고 기존 유저 **백필**이 필요하다.

## 템플릿 1 — 표준 org-scoped 테이블 (member read / member+ write)

```sql
create table things (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                       -- soft delete (CASCADE는 발동 안 함을 기억)
);
create index things_org_idx on things (org_id, created_at desc);
create trigger trg_things_upd before update on things
  for each row execute function app.set_updated_at();

alter table things enable row level security;
revoke all on things from anon;

-- 읽기: org 멤버 전원
create policy things_sel on things for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);

-- 쓰기: viewer 제외 (viewer에게 쓰기를 주면 exfil 경로가 된다 — alerts_write 전례)
create policy things_write on things for all to authenticated
  using (org_id in (select app.current_org_ids_min_role('member')))
  with check (org_id in (select app.current_org_ids_min_role('member')));
```

주의: `for all` 쓰기 정책은 `deleted_at` 필터 없이 SELECT도 허용한다 → **앱 조회 쿼리에서
`.is('deleted_at', null)`을 항상 명시** (listAlerts/listDashboards 관례).

## 템플릿 2 — service_role 전용 테이블 (run 기록/웹훅 수신/시크릿류)

```sql
alter table things enable row level security;
revoke all on things from anon;
-- 멤버는 읽기만, 쓰기 정책은 아예 만들지 않음 (service_role은 BYPASSRLS)
create policy things_sel on things for select to authenticated
  using (org_id in (select app.current_org_ids()));
```

성장형 테이블(이벤트/로그/수신 기록)이면 → `src/lib/maintenance/prune.ts`의 `RETENTION`
배열에 등록 (안 하면 무한 성장).

## 템플릿 3 — enum 값 추가 (파일 분리 필수)

`ALTER TYPE ... ADD VALUE`는 새 값을 같은 트랜잭션에서 쓸 수 없다 → **마이그레이션 2개**:

```sql
-- <ts1>_add_engine_value.sql
alter type ds_engine add value if not exists 'newengine';
-- <ts2>_use_engine_value.sql  (CHECK 변경, 데이터 이관 등)
```

## 템플릿 4 — 클라이언트 자기승격 차단 guard 트리거

RLS로 표현 못 하는 "owner/admin이어도 이 컬럼은 못 바꿈"은 BEFORE UPDATE 트리거로.
**열거식이므로 보호 대상 컬럼을 추가할 때마다 목록 갱신** (billing_event_at 누락 전례):

```sql
create or replace function app.guard_things_write()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') and (
        new.protected_col is distinct from old.protected_col
  ) then
    raise exception 'protected columns are managed by the system (service_role only)';
  end if;
  return new;
end $$;
create trigger trg_guard_things before update on things
  for each row execute function app.guard_things_write();
```

기존 guard: `app.guard_org_billing_write` (organizations 빌링 컬럼),
kpi_catalog guard (status/applied 외 잠금). 새 보호 컬럼은 거기에 추가.

## 템플릿 5 — SECURITY DEFINER RPC (권한 로직이 필요한 mutation)

멤버 관리 패턴 (`20260701000000_member_management.sql` 참조): 클라이언트 INSERT가 RLS로
막혀 있고 원자성이 필요하면 RPC. 에러는 `raise exception 'error_code'` — 앱의
`friendlyError`가 코드 문자열 매칭으로 한국어 변환한다.

## 원격 드리프트 / 수동 적용

- worktree엔 `supabase/.temp` 링크 상태가 없다. 링크된 체크아웃에서 `npm run db:push`를 실행하라.
- 마이그레이션 하나만 따로 적용해야 하면 psql `--single-transaction -f <file>` 후
  `supabase_migrations.schema_migrations`에 수동 기록 (안 하면 다음 push가 재적용 시도).
  접속 문자열을 argv에 넣지 말 것 (비밀번호 노출).

## 마지막 확인

- [ ] `npm run db:types` 실행 + 커밋 포함?
- [ ] soft-delete면 삭제 경로에서 의존 리소스 명시 정리? (core-dev-guard §4)
- [ ] 성장 테이블이면 retention 등록?
- [ ] `npm run db:lint`로 안티패턴 확인
