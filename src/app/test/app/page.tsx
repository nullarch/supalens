import { HBarChart, DataTable } from './_components/charts'
import {
  ASK_INSIGHT,
  ASK_QUESTION,
  ASK_ROWS,
  ASK_SQL,
  DATA_SOURCE_TAG,
  RECENT_QUESTIONS,
} from './_components/sample-data'
import s from './ask.module.css'

export default function AskPage() {
  const barData = ASK_ROWS.map((r) => ({
    label: r.region,
    value: r.revenue,
    display: r.revenueDisplay,
    highlight: r.region === '서울',
  }))
  const tableRows = ASK_ROWS.map((r) => [r.region, r.revenueDisplay, r.orders])

  return (
    <div className={s.col}>
      <h1 className={`cx-type-md ${s.h1}`}>무엇이든 물어보세요.</h1>

      {/* input panel */}
      <div className={s.panel}>
        <textarea
          className={s.textarea}
          rows={3}
          placeholder="예: 이번 달 매출을 지역별로 보여줘"
          aria-label="질문 입력"
        />
        <div className={s.panelFoot}>
          <span className={s.sourceTag}>{DATA_SOURCE_TAG}</span>
          <button type="button" className="cx-btn cx-btn--sm">
            분석 시작 →
          </button>
        </div>
      </div>

      {/* recent questions */}
      <div className={s.chips}>
        {RECENT_QUESTIONS.map((q) => (
          <button key={q} type="button" className={s.chip}>
            {q}
          </button>
        ))}
      </div>

      {/* completed analysis — the centerpiece */}
      <section className={s.result}>
        <p className={s.question}>
          <span className={s.qMark}>“</span>
          {ASK_QUESTION}
        </p>

        <div className={s.block}>
          <span className={s.blockTag}>GENERATED SQL</span>
          <pre className={s.sql}>
            {ASK_SQL.map((line, i) => (
              <span key={i} className={s.sqlLine}>
                {line.map((tok, j) => (
                  <span key={j} className={tok.k ? s.kw : undefined}>
                    {tok.t}
                  </span>
                ))}
              </span>
            ))}
          </pre>
        </div>

        <div className={s.block}>
          <span className={s.blockTag}>결과 · 5개 지역</span>
          <DataTable columns={['지역', '매출', '주문수']} rows={tableRows} numericFrom={1} />
        </div>

        <div className={s.block}>
          <span className={s.blockTag}>지역별 매출</span>
          <HBarChart data={barData} />
        </div>

        <p className={s.insight}>{ASK_INSIGHT}</p>

        <div className={s.actions}>
          <button type="button" className="cx-btn cx-btn--secondary cx-btn--sm">
            위젯으로 추가
          </button>
          <a className={`cx-link ${s.actionLink}`} href="#">
            대시보드에서 보기 →
          </a>
        </div>
      </section>
    </div>
  )
}
