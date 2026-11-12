import { notFound } from 'next/navigation'

import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import s from '@/app/app/setup/setup.module.css'
import { nextPhaseToRun, reduceAll, type BootstrapEvent } from '@/lib/bootstrap/events'
import { ScanGalleryView, ScanFixture } from './ScanFixture'

/**
 * Dev-only gallery for the unified onboarding scan — NO auth, NO DB.
 *
 * The fixtures are produced by replaying canned events through the REAL reducer
 * (`reduceAll`), so what you see here is exactly what the Trigger task's event stream would
 * render. `active` is forced false so the component does not poll a route that would 401.
 *   npm run dev → http://localhost:3100/dev/setup-scan  (?mode=<fixture> mounts the live controller)
 */
const ev = (e: Partial<BootstrapEvent> & Pick<BootstrapEvent, 'phase' | 'kind'>): BootstrapEvent => ({
  type: 'bootstrap',
  at: Date.now(),
  ...e,
})

/** What the context phase reports once the doc is parsed: a few names, then the real totals. */
const CONTEXT_FINDINGS: BootstrapEvent[] = [
  ...['Users', 'Subscriptions', 'Payments', 'Credits', 'Generations', 'Refunds'].map((name) =>
    ev({ phase: 'context', kind: 'item', metric: 'entities', label: name }),
  ),
  ev({ phase: 'context', kind: 'count', metric: 'entities', count: 6 }),
  ...[
    '취소된 구독은 MRR에서 제외한다',
    '환불된 결제는 매출에서 제외한다',
    '삭제된 사용자는 집계하지 않는다',
    '내부 테스트 계정은 제외한다',
  ].map((text) => ev({ phase: 'context', kind: 'item', metric: 'rules', label: text })),
  ev({ phase: 'context', kind: 'count', metric: 'rules', count: 9 }),
]

const SCENES: Array<{ title: string; note: string; events: BootstrapEvent[]; hasRepo: boolean }> = [
  {
    title: 'Idle — nothing scanned yet',
    note: 'Every counter reads "—". An unmeasured count is never rendered as 0.',
    events: [],
    hasRepo: true,
  },
  {
    title: 'Schema done, understanding running',
    note: 'Only the table count exists so far; entities and rules are unknown until the doc lands.',
    events: [
      ev({ phase: 'schema', kind: 'phase_start' }),
      ev({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: 42 }),
      ev({ phase: 'context', kind: 'phase_start' }),
    ],
    hasRepo: true,
  },
  {
    title: 'Understanding done, KPIs arriving',
    note: 'Entities and rules were counted by parsing the finished doc; KPI names appear one by one.',
    events: [
      ev({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: 42 }),
      ev({ phase: 'context', kind: 'phase_start' }),
      ...CONTEXT_FINDINGS,
      ev({ phase: 'context', kind: 'phase_done' }),
      ev({ phase: 'kpi', kind: 'phase_start' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: 'MRR' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '신규 유료 전환' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '환불률' }),
    ],
    hasRepo: true,
  },
  {
    title: 'Finished',
    note: 'All four counters are real values from the completed run.',
    events: [
      ev({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: 42 }),
      ...CONTEXT_FINDINGS,
      ev({ phase: 'context', kind: 'phase_done' }),
      ev({ phase: 'kpi', kind: 'phase_start' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: 'MRR' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '신규 유료 전환' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '환불률' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '체험 전환율' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '이탈률' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: '생성 성공률' }),
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: 'ARPU' }),
      ev({ phase: 'kpi', kind: 'phase_done', metric: 'kpis', count: 7 }),
    ],
    hasRepo: true,
  },
  {
    title: 'KPI half failed — retry resumes there',
    note: 'The context phase stays "done", so resuming will not re-clone or re-author the doc.',
    events: [
      ev({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: 42 }),
      ...CONTEXT_FINDINGS,
      ev({ phase: 'context', kind: 'phase_done' }),
      ev({ phase: 'kpi', kind: 'phase_start' }),
      ev({ phase: 'kpi', kind: 'phase_failed', error: 'agent token budget exhausted' }),
    ],
    hasRepo: true,
  },
  {
    title: 'Schema-only source (no repo attached)',
    note: 'Tier 1: no code to read, so the CTA offers a schema-only scan.',
    events: [],
    hasRepo: false,
  },
]

export default async function DevSetupScanPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode } = await searchParams
  if (mode) {
    if (!['idle', 'schema-only', 'schema', 'context', 'kpi', 'failed', 'ready', 'zero', 'skipped', 'overflow', 'post-limit', 'post-quota', 'post-repository', 'post-installation', 'post-denied', 'post-failed', 'post-throw', 'post-conflict', 'read-error', 'read-throw', 'read-malformed', 'waiting', 'done-response', 'slow', 'timeout'].includes(mode)) notFound()
    return <AppSurface><ScanFixture key={mode} mode={mode} /></AppSurface>
  }

  return (
    <AppSurface>
    <div style={{ padding: 'clamp(20px, 4vw, 48px)', display: 'flex', flexDirection: 'column', gap: 40, maxWidth: 856, margin: '0 auto' }}>
      <header className="dx-page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="dx-title">Dev · onboarding scan</h1>
          <p className="dx-sub">
            Read-only fixtures replayed through the real event reducer. No polling, analytics or job actions.
          </p>
        </div>
      </header>

      {SCENES.map((scene) => {
        const progress = reduceAll(scene.events)
        return (
          <section key={scene.title} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h2 className="dx-section-title">{scene.title}</h2>
              <p className="dx-section-sub">{scene.note}</p>
            </div>
            <div className={s.card}>
              <ScanGalleryView
                hasRepo={scene.hasRepo}
                status={{
                  phases: progress.phases,
                  counts: progress.counts,
                  items: progress.items,
                  error: progress.error,
                  active: Object.values(progress.phases).includes('running'),
                  resumeFrom: nextPhaseToRun(progress),
                }}
              />
            </div>
          </section>
        )
      })}
    </div>
    </AppSurface>
  )
}
