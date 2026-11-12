import { VBarChart, Donut, LineChart, DataTable } from '../_components/charts'
import {
  CATEGORY_MIX,
  CATEGORY_TOTAL,
  KPIS,
  MONTHLY_REVENUE,
  SIGNUPS_SERIES,
  SIGNUPS_XLABELS,
  TOP_PRODUCTS,
} from '../_components/sample-data'
import s from './dashboards.module.css'

export default function DashboardsPage() {
  return (
    <div className={s.wrap}>
      <div className={s.titleRow}>
        <h1 className={`cx-type-md ${s.h1}`}>대시보드</h1>
        <button type="button" className="cx-btn cx-btn--sm">
          새 위젯 →
        </button>
      </div>

      <div className={s.tabs}>
        <span className={s.tab} data-active>
          매출 현황
        </span>
        <span className={s.tab}>성장 지표</span>
      </div>

      <div className={s.grid}>
        {KPIS.map((k) => (
          <div key={k.label} className={`${s.card} ${s.kpi}`} data-span="4">
            <span className={s.kpiLabel}>{k.label}</span>
            <span className={s.kpiValue}>{k.value}</span>
            <span className={s.kpiDelta} data-trend={k.trend}>
              {k.delta}
            </span>
          </div>
        ))}

        <div className={`${s.card} ${s.fill}`} data-span="7">
          <div className={s.cardHead}>
            <span className={s.cardTitle}>월별 매출</span>
            <span className={s.more}>…</span>
          </div>
          <VBarChart data={MONTHLY_REVENUE} />
        </div>

        <div className={s.card} data-span="5">
          <div className={s.cardHead}>
            <span className={s.cardTitle}>카테고리 분포</span>
            <span className={s.more}>…</span>
          </div>
          <Donut segments={CATEGORY_MIX} centerValue={CATEGORY_TOTAL} centerLabel="합계" />
        </div>

        <div className={`${s.card} ${s.fill}`} data-span="7">
          <div className={s.cardHead}>
            <span className={s.cardTitle}>주간 신규 가입</span>
            <span className={s.more}>…</span>
          </div>
          <LineChart series={SIGNUPS_SERIES} xLabels={SIGNUPS_XLABELS} />
        </div>

        <div className={s.card} data-span="5">
          <div className={s.cardHead}>
            <span className={s.cardTitle}>상위 상품</span>
            <span className={s.more}>…</span>
          </div>
          <DataTable
            columns={['상품', '매출']}
            rows={TOP_PRODUCTS.map((p) => [p.name, p.revenue])}
            numericFrom={1}
          />
        </div>
      </div>
    </div>
  )
}
