import Link from 'next/link'
import { notFound } from 'next/navigation'

import LogoMark from '@/components/brand/LogoMark'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { KoIntl } from './KoIntl'
import s from './v2.module.css'

// Dev-only design variation V2 — "Split product hero" (conversion-optimized SaaS direction).
// Two-column hero: LEFT = pitch + suggested chips + ask composer, RIGHT = a live-feeling
// auto-KPI dashboard preview built from the REAL widget renderer + the canned demo catalog
// specs (persisted samples → zero queries). Korean copy hardcoded (the real /demo uses i18n).
// NO auth. notFound() in production, same as the widgets gallery.
//   npm run dev → http://localhost:3000/dev/demo/v2

const CONNECT_HREF = '/login?next=/app/ask'

// demo/seed.sql tables — schema identifiers stay English (i18n rule: SQL untranslated)
const SCHEMA_TABLES = ['customers', 'products', 'orders', 'order_items']

// same 6 suggested questions as messages/ko.json `demo.questions` (kept for comparability)
const QUESTIONS = [
  '최근 30일 총 매출은 얼마야?',
  '최근 14일 일별 매출을 차트로 보여줘',
  '어떤 상품 카테고리가 매출이 가장 높아?',
  '누적 구매액 기준 상위 고객 5명은?',
  '월별 환불률은 어떻게 돼?',
  '고객들은 주로 어느 나라에서 왔어?',
]

// hero payoff dashboard — 5 canned Auto-KPI specs (2 stats + bar + donut + line)
const PANEL_KEYS = ['total_revenue', 'refund_rate', 'daily_revenue', 'revenue_by_category', 'order_count'] as const

// sample answered turn (kept out of JSX literals: quotes trip react/no-unescaped-entities)
const SAMPLE_QUESTION = '어떤 상품이 매출을 이끌고 있어? 평균 주문 금액도 알려줘'
const SAMPLE_ANSWER = [
  '결제 완료 주문 기준 평균 주문 금액(AOV)은 ₩412,000입니다.',
  '매출 상위 상품은 “데님 팬츠 12”(₩4,230만 · 214개)이고, 상위 5개 상품이 전체 매출의 약 20%를 차지합니다.',
  '상위권을 의류 카테고리가 주도하고 있어, 재고와 프로모션 우선순위를 이 라인에 두는 것을 추천합니다.',
].join(' ')

function specOf(key: string) {
  const p = DEMO_KPI_PROPOSALS.find((x) => x.key === key)
  if (!p) throw new Error(`demo KPI not found: ${key}`)
  return p.vizSpec
}

export default function DemoV2Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <KoIntl>
    <div className={s.page}>
      <header className={s.header}>
        <Link href="/" className={s.brand} aria-label="supalens 홈">
          <LogoMark size={22} />
          <span className={s.wordmark}>supalens</span>
        </Link>
        <div className={s.headerActions}>
          <Link href="/login" className={s.loginLink}>
            로그인
          </Link>
          <Link href={CONNECT_HREF} className={s.headerCta}>
            무료로 시작
          </Link>
        </div>
      </header>

      <main className={s.main}>
        {/* ── split hero: pitch + composer (left) / live dashboard preview (right) ── */}
        <section className={s.hero}>
          <div className={s.pitch}>
            <span className={s.badge}>
              <span className={s.badgeDot} aria-hidden />
              라이브 Postgres · 가입 불필요
            </span>
            <h1 className={s.title}>
              라이브 데이터베이스에 <em className={s.titleEm}>뭐든</em> 물어보세요
            </h1>
            <p className={s.sub}>
              진짜 이커머스 Postgres 데이터베이스입니다 — 고객, 상품, 주문. 자연어로 질문하면 읽기 전용 AI
              애널리스트가 SQL을 작성·실행하고 차트로 답합니다.
            </p>
            <div className={s.schemaRow}>
              <span className={s.schemaLabel}>연결된 스키마</span>
              {SCHEMA_TABLES.map((tb) => (
                <span key={tb} className={s.schemaChip}>
                  {tb}
                </span>
              ))}
            </div>
          </div>

          <div className={s.ask}>
            <div className={s.suggestLabel}>바로 실행 — 즉시 응답</div>
            <div className={s.chips}>
              {QUESTIONS.map((q) => (
                <button key={q} type="button" className={s.chipBtn}>
                  {q}
                </button>
              ))}
            </div>
            <div className={s.composer}>
              <input
                type="text"
                className={s.input}
                placeholder="직접 질문해 보세요 — 예: 이번 달 가장 빨리 성장한 카테고리는?"
              />
              <button type="button" className={s.sendBtn}>
                질문
              </button>
            </div>
            <p className={s.readonlyNote}>구조적으로 읽기 전용 — 데모 에이전트는 SELECT만 실행할 수 있습니다.</p>
          </div>

          <aside className={s.preview} aria-label="자동 생성 KPI 대시보드 미리보기">
            <div className={s.previewEyebrow}>AUTO-KPI · 연결하면 자동 생성</div>
            <div className={s.panel}>
              <div className={s.panelHead}>
                <span className={s.winDots} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span className={s.panelTitle}>핵심 KPI — 이커머스 데모</span>
                <span className={s.updatedNote}>방금 업데이트</span>
                <span className={s.liveChip}>
                  <span className={s.liveDot} aria-hidden />
                  LIVE
                </span>
              </div>
              <div className={s.pGrid}>
                <div className={s.cellStat}>
                  <WidgetRenderer spec={specOf(PANEL_KEYS[0])} fill menu={null} />
                </div>
                <div className={s.cellStat}>
                  <WidgetRenderer spec={specOf(PANEL_KEYS[1])} fill menu={null} />
                </div>
                <div className={s.cellWide}>
                  <WidgetRenderer spec={specOf(PANEL_KEYS[2])} fill menu={null} />
                </div>
                <div className={s.cellHalf}>
                  <WidgetRenderer spec={specOf(PANEL_KEYS[3])} fill menu={null} />
                </div>
                <div className={s.cellHalf}>
                  <WidgetRenderer spec={specOf(PANEL_KEYS[4])} fill menu={null} />
                </div>
              </div>
            </div>
            <p className={s.panelCaption}>
              데이터베이스를 연결하면 Supalens가 스키마(그리고 레포)를 읽어 이런 KPI 대시보드를 자동으로 만들고,
              지표를 감시하다 이상이 생기면 Slack으로 원인까지 설명합니다.
            </p>
          </aside>
        </section>

        {/* ── below the fold: one sample answered turn ── */}
        <section className={s.turnSection}>
          <div className={s.eyebrow}>SAMPLE ANSWER</div>
          <h2 className={s.sectionTitle}>이렇게 답합니다</h2>
          <p className={s.sectionSub}>위 데모 데이터베이스에서 실제로 실행된 질문 하나를 그대로 옮겼습니다.</p>

          <div className={s.turn}>
            <div className={s.userRow}>
              <div className={s.userMsg}>{SAMPLE_QUESTION}</div>
            </div>
            <span className={s.cachedChip}>앞서 라이브로 분석된 답변 · 캐시 제공</span>
            <div className={s.statsRow}>
              <WidgetRenderer spec={specOf('aov')} menu={null} />
            </div>
            <div className={s.chartCol}>
              <WidgetRenderer spec={specOf('top_products')} menu={null} />
            </div>
            <p className={s.answerText}>{SAMPLE_ANSWER}</p>
            <Link href={CONNECT_HREF} className={s.answerCta}>
              내 데이터로도 보고 싶다면? Supabase/Postgres를 무료로 연결하세요. →
            </Link>
          </div>
        </section>

        {/* ── final conversion CTA ── */}
        <section className={s.ctaCard}>
          <h2 className={s.ctaTitle}>당신의 데이터베이스도 됩니다</h2>
          <p className={s.ctaSub}>
            설계부터 읽기 전용. Supabase OAuth 또는 Postgres 연결 문자열 — 약 2분이면 충분합니다.
          </p>
          <Link href={CONNECT_HREF} className={s.ctaBtn}>
            내 데이터베이스 연결 — 무료
          </Link>
          <Link href="/docs/mcp" className={s.ctaMcp}>
            Claude가 편하다면? MCP 커넥터 사용 →
          </Link>
        </section>
      </main>
    </div>
    </KoIntl>
  )
}
