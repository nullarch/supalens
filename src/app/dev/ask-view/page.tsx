import { notFound } from 'next/navigation'

/**
 * Dev fixture for the /app/ask assistant-message layout (AgentView): the stat strip
 * (kpi/bignumber side-by-side) + full-width chart stack, with account actions hidden.
 * Feeds AgentView exactly the chunks a live run streams, from the widget gallery samples —
 * eyeball layout changes here without burning an agent run: npm run dev → /dev/ask-view.
 */
import { AgentView } from '@/components/agent/AgentView'
import type { AgentChunk } from '@/components/agent/AgentView'
import { byKey } from '@/components/dashboard/widgets/__fixtures__/samples'
import type { VisualizationSpec } from '@/lib/viz/spec'

function vizChunk(sampleKey: string): AgentChunk {
  const sample = byKey(sampleKey)
  if (!sample) throw new Error(`unknown widget sample "${sampleKey}"`)
  const spec: VisualizationSpec = {
    v: 1,
    query: { sql: `-- fixture: ${sampleKey}\nselect * from sample`, queryId: `q_${sampleKey}` },
    sample: { columns: sample.data.columns, rows: sample.data.rows },
    chart: sample.spec,
  }
  return { type: 'visualization', spec }
}

const sql = (text: string): AgentChunk => ({ type: 'tool_use', tool: 'execute_sql', input: { sql: text } })
const prose = (text: string): AgentChunk => ({ type: 'text', text })

interface Scenario {
  label: string
  note: string
  chunks: AgentChunk[]
}

const SCENARIOS: Scenario[] = [
  {
    label: 'KPI + 추이 (canonical pair)',
    note: '헤드라인 스탯 1개가 타일로 위에, 추이 차트가 full-width로 아래에.',
    chunks: [
      prose('6월 매출은 1억 4,100만 원으로 전월 대비 19.5% 늘었어요. 최근 6개월 추이를 함께 보면 4월의 하락 이후 두 달 연속 회복세입니다.'),
      sql('select sum(amount) as revenue, lag_month(amount) as prev_revenue from orders'),
      sql("select date_trunc('month', created_at) as month, sum(amount) as revenue from orders group by 1 order by 1"),
      vizChunk('kpi'),
      vizChunk('line'),
    ],
  },
  {
    label: '스탯 2개 + 카테고리 + 상세 표',
    note: '스탯 스트립이 2-up으로 나란히, 막대/표는 각각 full-width.',
    chunks: [
      prose('전자기기가 전체 매출의 38%로 가장 크고, 활성 사용자는 지난 7일 기준으로 안정적입니다. 카테고리별 분포와 상위 상품 상세는 아래에서 확인하세요.'),
      sql('select category, sum(amount) as amount from orders group by 1 order by 2 desc'),
      vizChunk('kpi'),
      vizChunk('bignumber'),
      vizChunk('bar'),
      vizChunk('table'),
    ],
  },
  {
    label: '차트만 (스탯 없음)',
    note: '스탯 스트립 없이 차트 stack만 — 기존과 동일해야 함.',
    chunks: [
      prose('플랜별 MRR은 Pro가 성장을 견인하고 있어요.'),
      sql('select month, plan, mrr from mrr_by_plan'),
      vizChunk('stackedBar'),
    ],
  },
]

export default function DevAskViewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main style={{ maxWidth: 768, margin: '0 auto', padding: '48px 20px 96px' }}>
      <header className="dx-page-head">
        <div>
          <h1 className="dx-title">Assistant message layout</h1>
          <p className="dx-sub">
            실제 런이 스트리밍하는 chunk 그대로 <code className="dx-mono">AgentView</code>에 먹인 fixture (dev). 산문 / 스탯·차트 카드 /
            SQL 디스클로저를 여기서 눈으로 검증.
          </p>
        </div>
      </header>

      {SCENARIOS.map((sc) => (
        <section key={sc.label} className="dx-section">
          <div className="dx-section-head" style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
            <div>
              <h2 className="dx-section-title">{sc.label}</h2>
              <p className="dx-section-sub">{sc.note}</p>
            </div>
          </div>
          {/* Read-only samples preserve the output layout without exposing account actions. */}
          <AgentView chunks={sc.chunks} phase="done" dataSourceId="dev-source" question={sc.label} readOnly />
        </section>
      ))}
    </main>
  )
}
