import Link from 'next/link'
import { notFound } from 'next/navigation'

import LogoMark from '@/components/brand/LogoMark'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { DevThemeToggle } from '../../modals/DevThemeToggle'
import { Sql } from './Sql'
import s from './v1.module.css'

// Dev-only design variation V1 of the public /demo page — "Terminal / SQL-forward"
// (developer-credibility direction). Same content structure as the live ko page, hardcoded
// Korean copy (the /dev mock convention), NO auth, notFound() in production like the other
// /dev previews.  npm run dev → http://localhost:3000/dev/demo/v1

// demo/seed.sql relations — identifiers stay English (SQL is never translated)
const SCHEMA = [
  { name: 'customers', rows: '2,418', cols: 'id, name, email, country, signup_date' },
  { name: 'products', rows: '184', cols: 'id, name, category, price' },
  { name: 'orders', rows: '12,733', cols: 'id, customer_id, order_date, status, total_amount' },
  { name: 'order_items', rows: '31,209', cols: 'id, order_id, product_id, quantity, unit_price' },
]

const QUESTIONS = [
  '최근 30일 총 매출은 얼마야?',
  '최근 14일 일별 매출을 차트로 보여줘',
  '어떤 상품 카테고리가 매출이 가장 높아?',
  '누적 구매액 기준 상위 고객 5명은?',
  '월별 환불률은 어떻게 돼?',
  '고객들은 주로 어느 나라에서 왔어?',
]

// payoff grid: 4 canned Auto-KPI specs rendered from their persisted samples (zero queries).
// Catalog captions/descriptions are already Korean — keep them verbatim on the ko mock.
const PAYOFF_KEYS = ['total_revenue', 'refund_rate', 'daily_revenue', 'revenue_by_category'] as const

const CONNECT_HREF = '/login?next=/app/ask'

export default function DevDemoV1Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  const daily = DEMO_KPI_PROPOSALS.find((p) => p.key === 'daily_revenue')!
  // sum of the persisted 8-row sample — the stat card and the bar chart must agree
  const turnStatSpec = {
    v: 1,
    query: { sql: daily.metricSql },
    sample: { columns: ['total_14d'], rows: [{ total_14d: 112_370_000 }] },
    chart: {
      type: 'bignumber',
      title: '기간 매출 합계',
      value: 'total_14d',
      caption: '결제 완료 주문 · 최근 14일',
      format: { kind: 'currency', currency: 'KRW', compact: true },
    },
  }

  const payoff = PAYOFF_KEYS.flatMap((key) => {
    const p = DEMO_KPI_PROPOSALS.find((x) => x.key === key)
    return p ? [{ key, spec: p.vizSpec }] : []
  })

  return (
    <div className={s.page}>
      <div className={s.themeToggleWrap}>
        <DevThemeToggle />
      </div>

      <header className={s.header}>
        <Link href="/" className={s.brand} aria-label="supalens 홈으로">
          <LogoMark size={22} />
          <span className={s.wordmark}>supalens</span>
        </Link>
        <div className={s.headerActions}>
          <Link href="/login" className={s.loginLink}>
            로그인
          </Link>
          <Link href={CONNECT_HREF} className={s.headerCta}>
            시작하기
          </Link>
        </div>
      </header>

      <main className={s.main}>
        {/* ── hero ── */}
        <span className={s.badge}>
          <span className={s.badgeDot} aria-hidden />
          라이브 Postgres · 가입 불필요
        </span>
        <h1 className={s.title}>라이브 데이터베이스에 뭐든 물어보세요</h1>
        <p className={s.sub}>
          진짜 이커머스 Postgres 데이터베이스입니다 — 고객, 상품, 주문. 자연어로 질문하면 읽기 전용 AI
          애널리스트가 SQL을 작성·실행하고 차트로 답합니다.
        </p>

        {/* ── connected schema — psql-style terminal ── */}
        <section className={s.schemaSection}>
          <div className={s.kicker}>-- 연결된 스키마</div>
          <div className={`${s.term} ${s.schemaTerm}`}>
            <div className={s.termHead}>
              <span className={s.termDots} aria-hidden>
                <span className={s.termDot} />
                <span className={s.termDot} />
                <span className={s.termDot} />
              </span>
              <span className={s.termTitle}>supalens_demo — psql · 읽기 전용</span>
              <span className={s.termLive}>
                <span className={s.termLiveDot} aria-hidden />
                LIVE
              </span>
            </div>
            <div className={s.termBody}>
              <div className={s.promptLine}>
                <span className={s.promptHost}>supalens_demo</span>
                <span className={s.promptArrow}>=&gt;</span> \dt+ public.*
              </div>
              <div className={s.schemaGrid}>
                {SCHEMA.map((t) => (
                  <div key={t.name} style={{ display: 'contents' }}>
                    <span className={s.schemaName}>{t.name}</span>
                    <span className={s.schemaRows}>{t.rows} rows</span>
                    <span className={s.schemaCols}>{t.cols}</span>
                  </div>
                ))}
              </div>
              <div className={s.comment}>-- supalens_ro 역할 · SELECT 전용 트랜잭션 · statement_timeout 8s</div>
            </div>
          </div>
        </section>

        {/* ── suggested questions ── */}
        <section className={s.suggestBlock}>
          <div className={`${s.kicker} ${s.suggestLabel}`}>-- 바로 실행 · 즉시 응답</div>
          <div className={s.chips}>
            {QUESTIONS.map((q) => (
              <button key={q} type="button" className={s.chipBtn}>
                <span className={s.chipSigil} aria-hidden>
                  ▸
                </span>
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* ── console-prompt composer (static mock — no wiring) ── */}
        <div className={s.composer}>
          <span className={s.promptLabel} aria-hidden>
            <span className={s.promptHost}>supalens_demo</span>
            <span className={s.promptArrow}>=&gt;</span>
          </span>
          <span className={s.inputWrap}>
            <input
              type="text"
              className={s.input}
              placeholder=" "
              maxLength={300}
              aria-label="직접 질문해 보세요"
            />
            <span className={s.ghost} aria-hidden>
              <span className={s.cursorBlock} />
              <span className={s.ghostText}>직접 질문해 보세요 — 예: 이번 달 가장 빨리 성장한 카테고리는?</span>
            </span>
          </span>
          <button type="button" className={s.sendBtn}>
            실행
          </button>
        </div>
        <p className={s.readonlyNote}>-- 구조적으로 읽기 전용: 데모 에이전트는 SELECT만 실행할 수 있습니다</p>

        {/* ── one sample answered turn (static mock of a cached answer) ── */}
        <section className={s.turn}>
          <div className={s.userRow}>
            <div className={s.userMsg}>최근 14일 일별 매출을 차트로 보여줘</div>
          </div>

          <span className={s.noteChip}>앞서 라이브로 분석된 답변 · 캐시 제공</span>

          <div className={s.term}>
            <div className={s.termHead}>
              <span className={s.termDots} aria-hidden>
                <span className={s.termDot} />
                <span className={s.termDot} />
                <span className={s.termDot} />
              </span>
              <span className={s.termTitle}>agent · analyze — 실제 실행된 SQL</span>
            </div>
            <div className={s.termBody}>
              <div className={s.traceRows}>
                <div className={s.traceRow}>
                  <span className={s.traceCheck} aria-hidden>
                    ✓
                  </span>
                  <span className={s.traceName}>get_schema</span>
                  <span className={s.traceMeta}>public · 4 tables · 21 ms</span>
                </div>
                <div className={s.traceRow}>
                  <span className={s.traceCheck} aria-hidden>
                    ✓
                  </span>
                  <span className={s.traceName}>execute_sql</span>
                  <span className={s.traceMeta}>8 rows · 412 ms · read-only</span>
                </div>
                <div className={s.traceRow}>
                  <span className={s.traceCheck} aria-hidden>
                    ✓
                  </span>
                  <span className={s.traceName}>propose_visualization</span>
                  <span className={s.traceMeta}>bar · x=day · y=revenue</span>
                </div>
              </div>
              <div className={s.sqlCard}>
                <Sql code={daily.metricSql} />
              </div>
              <div className={s.sqlMeta}>-- 8 rows · 412 ms · SELECT-only transaction</div>
            </div>
          </div>

          <div className={s.answerViz}>
            <div className={s.statsGrid}>
              <WidgetRenderer spec={turnStatSpec} menu={null} />
            </div>
            <WidgetRenderer spec={daily.vizSpec} menu={null} />
          </div>

          <div className={s.answerText}>
            최근 14일 결제 완료 매출 합계는 ₩1억 1,237만, 일평균 약 ₩1,405만입니다. 6월 29일이 ₩1,621만으로 가장
            높았고 6월 23일이 ₩1,184만으로 가장 낮았습니다. 주 후반으로 갈수록 매출이 커지는 패턴이 반복되고
            있어요.
          </div>

          <Link href={CONNECT_HREF} className={s.answerCta}>
            내 데이터로도 보고 싶다면? Supabase/Postgres를 무료로 연결하세요. →
          </Link>
        </section>

        {/* ── payoff dashboard ── */}
        <section className={s.payoff}>
          <div className={s.payoffKicker}>-- auto-kpi · 연결하면 자동 생성</div>
          <h2 className={s.payoffTitle}>답변에서 끝나지 않습니다</h2>
          <p className={s.payoffSub}>
            데이터베이스를 연결하면 Supalens가 스키마(그리고 레포)를 읽어 이런 KPI 대시보드를 자동으로 만들고,
            지표를 감시하다 이상이 생기면 Slack으로 원인까지 설명합니다.
          </p>
          <div className={s.payoffGrid}>
            {payoff.map(({ key, spec }) => (
              <WidgetRenderer key={key} spec={spec} menu={null} />
            ))}
          </div>
        </section>

        {/* ── final CTA ── */}
        <section className={s.ctaCard}>
          <p className={s.ctaCmd}>
            <span className={s.ctaCmdSigil}>$</span> supalens connect --readonly{'  '}
            <span className={s.ctaCmdNote} aria-hidden>
              # supalens_ro · SELECT only · ~2분
            </span>
          </p>
          <h2 className={s.ctaTitle}>당신의 데이터베이스도 됩니다</h2>
          <p className={s.ctaSub}>
            설계부터 읽기 전용. Supabase OAuth 또는 Postgres 연결 문자열 — 약 2분이면 충분합니다.
          </p>
          <Link href={CONNECT_HREF} className={s.ctaBtn}>
            내 데이터베이스 연결 — 무료
          </Link>
          <Link href="/docs/mcp" className={s.ctaMcp}>
            Claude가 편하다면? MCP 커넥터 사용
          </Link>
        </section>
      </main>
    </div>
  )
}
