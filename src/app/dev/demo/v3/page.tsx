import Link from 'next/link'
import { notFound } from 'next/navigation'

import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { Composer } from './Composer'
import { ThemeToggle } from './ThemeToggle'
import s from './v3.module.css'

// Dev-only design variation of the public /demo page — V3 "Editorial minimal".
// The question is the hero: one calm 680px column, oversized serif display type,
// the composer as a ruled print-form line (the page's single motion = its breathing
// caret), suggested questions as a hairline list, the sample turn as an interview
// Q./A., and the trust signal as a ※ footnote. Copy is hardcoded Korean (the real
// page reads the `demo` i18n namespace). notFound() in production, same as the
// widgets gallery.  npm run dev → http://localhost:3000/dev/demo/v3

const CONNECT_HREF = '/login?next=/app/ask'

// sample turn: question #2 answered from the canned catalog (daily_revenue) + a
// turn-local stat over the same window — mirrors what the live agent emits
const TURN_STAT_SPEC = {
  v: 1,
  query: {
    sql: `select sum(total_amount) as revenue_14d
from orders
where status = 'paid'
  and order_date >= now() - interval '14 days'`,
  },
  sample: { columns: ['revenue_14d'], rows: [{ revenue_14d: 112370000 }] },
  chart: {
    type: 'bignumber',
    title: '최근 14일 매출',
    value: 'revenue_14d',
    caption: '결제 완료 주문 합계',
    format: { kind: 'currency', currency: 'KRW', compact: true },
  },
}

const ANSWER_TEXT =
  '최근 14일 결제 완료 매출은 총 ₩1억 1,237만 원입니다. 일평균 약 ₩1,405만 원 규모이며, 6월 29일이 ₩1,621만 원으로 가장 높았습니다. 6월 26일부터 매출이 한 단계 올라서, 구간 초반 사흘 대비 약 20% 높은 수준을 유지하고 있습니다.'

// the payoff grid: 4 canned Auto-KPI specs rendered from their persisted samples
const PAYOFF_KEYS = ['total_revenue', 'refund_rate', 'revenue_by_category', 'top_products'] as const

export default function DemoV3Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  const specOf = (key: string) => DEMO_KPI_PROPOSALS.find((p) => p.key === key)?.vizSpec
  const payoff = PAYOFF_KEYS.flatMap((key) => {
    const spec = specOf(key)
    return spec ? [{ key, spec }] : []
  })
  const turnChartSpec = specOf('daily_revenue')

  return (
    <div className={s.page}>
      <ThemeToggle />

      <header className={s.header}>
        <Link href="/" className={s.wordmark}>
          supalens
        </Link>
        <nav className={s.headerLinks}>
          <Link href="/login" className={s.loginLink}>
            로그인
          </Link>
          <Link href={CONNECT_HREF} className={s.startLink}>
            시작하기 →
          </Link>
        </nav>
      </header>

      <main className={s.main}>
        {/* hero — the badge reduced to a mono kicker line */}
        <p className={s.kicker}>
          <span className={s.kickerDot} aria-hidden />
          라이브 데모 — 진짜 Postgres · 가입 불필요
        </p>
        <h1 className={s.title}>
          라이브 데이터베이스에,
          <br />
          <em className={s.titleEm}>뭐든</em> 물어보세요.
        </h1>
        <p className={s.sub}>
          진짜 이커머스 Postgres 데이터베이스입니다 — 고객, 상품, 주문. 자연어로 질문하면 읽기 전용 AI
          애널리스트가 SQL을 작성·실행하고 차트로 답합니다.
        </p>

        {/* THE composer + footnotes + suggested questions */}
        <Composer />

        {/* sample answered turn — interview treatment */}
        <section className={s.section}>
          <p className={s.sectionKicker}>예시 — 라이브로 분석된 질문 하나</p>
          <p className={s.qaQ}>
            <span className={s.qaMark}>Q.</span>최근 14일 일별 매출을 차트로 보여줘
          </p>
          <span className={s.cachedLabel}>앞서 라이브로 분석된 답변 · 캐시 제공</span>

          <div className={s.statRow}>
            <WidgetRenderer spec={TURN_STAT_SPEC} menu={null} />
          </div>
          {turnChartSpec && (
            <div className={s.chartBlock}>
              <WidgetRenderer spec={turnChartSpec} menu={null} />
            </div>
          )}
          <p className={s.answerText}>{ANSWER_TEXT}</p>
          <Link href={CONNECT_HREF} className={s.answerCta}>
            내 데이터로도 보고 싶다면? Supabase/Postgres를 무료로 연결하세요 →
          </Link>
        </section>

        {/* payoff dashboard */}
        <section className={s.section}>
          <p className={s.sectionKicker}>연결하면, 자동으로</p>
          <h2 className={s.sectionTitle}>답변에서 끝나지 않습니다</h2>
          <p className={s.sectionSub}>
            데이터베이스를 연결하면 Supalens가 스키마(그리고 레포)를 읽어 이런 KPI 대시보드를 자동으로 만들고,
            지표를 감시하다 이상이 생기면 Slack으로 원인까지 설명합니다.
          </p>
          <div className={s.payoffGrid}>
            {payoff.map(({ key, spec }) => (
              <WidgetRenderer key={key} spec={spec} menu={null} />
            ))}
          </div>
        </section>

        {/* final CTA — the page's single solid element */}
        <section className={s.cta}>
          <h2 className={s.sectionTitle}>당신의 데이터베이스도 됩니다</h2>
          <p className={s.ctaSubCenter}>
            설계부터 읽기 전용. Supabase OAuth 또는 Postgres 연결 문자열 — 약 2분이면 충분합니다.
          </p>
          <Link href={CONNECT_HREF} className={s.ctaBtn}>
            내 데이터베이스 연결 — 무료
          </Link>
          <Link href="/docs/mcp" className={s.ctaMcp}>
            Claude가 편하다면? MCP 커넥터 사용
          </Link>
        </section>

        <footer className={s.footer}>
          <span className={s.footerMark}>supalens</span>
        </footer>
      </main>
    </div>
  )
}
