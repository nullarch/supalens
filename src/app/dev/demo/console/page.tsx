import { notFound } from 'next/navigation'

import '@/components/landing/editorial/editorial.css'
import type { AgentChunk } from '@/components/agent/AgentView'
import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { AnswerBody } from '../../../[locale]/demo/AnswerCard'

// Dev-only fixture for the public demo answer states (live stages, finished, cached, error).
// Sample specs from the canned catalog; no run, stream or API call. notFound() in production.

const revenue = DEMO_KPI_PROPOSALS.find((p) => p.key === 'daily_revenue')!.vizSpec
const total = DEMO_KPI_PROPOSALS.find((p) => p.key === 'total_revenue')!.vizSpec

const schema: AgentChunk = { type: 'tool_use', tool: 'mcp__supalens__get_schema', input: {} }
const query: AgentChunk = { type: 'tool_use', tool: 'mcp__supalens__execute_sql', input: { sql: revenue.query.sql } }
const chart: AgentChunk = { type: 'visualization', spec: revenue }
const stat: AgentChunk = { type: 'visualization', spec: total }
const prose =
  '## Revenue dipped for five days\n\nDaily revenue fell from about **$3.5K** to **$1.9K** a day, then recovered.\n\n- `Selvedge Denim Jeans` had no paid orders in that window\n- Footwear and accessories stayed at their usual level\n\nThe timing points to the best seller being out of stock.'
const text: AgentChunk = { type: 'text', text: prose }

const STAGES: { label: string; chunks: AgentChunk[]; phase: 'streaming' | 'done' | 'error' }[] = [
  { label: 'Live · starting', chunks: [], phase: 'streaming' },
  { label: 'Live · schema read, writing SQL', chunks: [schema], phase: 'streaming' },
  { label: 'Live · chart built', chunks: [schema, query, stat, chart], phase: 'streaming' },
  { label: 'Live · writing', chunks: [schema, query, stat, chart, { type: 'text', text: prose.slice(0, 140) }], phase: 'streaming' },
  { label: 'Live · done', chunks: [schema, query, stat, chart, text], phase: 'done' },
  { label: 'Live · interrupted', chunks: [schema, query], phase: 'error' },
]

export default function DemoConsoleFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className="ed" style={{ padding: '40px 20px', display: 'grid', gap: 40, maxWidth: 820, margin: '0 auto' }}>
      <p style={{ fontSize: 12 }}>DESIGN FIXTURE · Public demo answer states with sample data.</p>
      {STAGES.map((stage) => (
        <section key={stage.label} className="ed-product" style={{ padding: 20, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper-2)' }}>
          <p style={{ fontSize: 12, marginBottom: 12, color: 'var(--ink-3)' }}>{stage.label}</p>
          <AnswerBody mode="live" chunks={stage.chunks} phase={stage.phase} startedAt={Date.now() - 14000} />
        </section>
      ))}
      <section className="ed-product" style={{ padding: 20, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper-2)' }}>
        <p style={{ fontSize: 12, marginBottom: 12, color: 'var(--ink-3)' }}>Cached</p>
        <AnswerBody mode="cached" result={{ text: prose, visualizations: [total, revenue] }} answeredAt={new Date(Date.now() - 3 * 3600_000).toISOString()} />
      </section>
    </main>
  )
}
