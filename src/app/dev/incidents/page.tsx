import { notFound } from 'next/navigation'

import '@/app/app/dashboard.css' // .dx-* classes the incident UI renders with
import { deriveIncidents, type IncidentAlertRow, type IncidentEventRow } from '@/lib/alerts/incidents'
import { IncidentsTable, parseFilter } from '@/app/app/incidents/IncidentsTable'
import { IncidentDetailView } from '@/app/app/incidents/IncidentDetailView'
import { AppSurface } from '@/components/dashboard/AppSurface'
import DashboardShell from '@/components/dashboard/DashboardShell'
import type { AppChrome } from '@/lib/dashboards/types'
import { DevThemeToggle } from '../modals/DevThemeToggle'
import { IncidentTriagePreview } from './IncidentTriagePreview'

// Dev-only visual preview of the incidents queue + one incident detail — NO auth, NO DB.
// Renders the REAL view components from fixtures, so the honest-by-construction bits (the
// confirmed/hypothesis split, the "no time series" note, the timeline without invented
// timestamps) can be eyeballed instantly, in light AND dark:
//   npm run dev → http://localhost:3000/dev/incidents
//   ?shell=list | detail — one view mounted in the REAL app shell, to check the wide container
// notFound() in production, same as the other /dev galleries.

// A non-UTC zone on purpose: every stamp below must visibly render in the ORG's zone, which is
// exactly the regression `formatInOrgTz` exists to catch.
const TIMEZONE = 'Asia/Seoul'

const HOUR = 3_600_000
const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()

const ALERTS: IncidentAlertRow[] = [
  {
    id: 'a1',
    name: '일 매출',
    type: 'threshold',
    operator: 'lt',
    threshold: 4_000_000,
    sensitivity: null,
    fire_threshold: 2,
    data_source_name: '데일리카트 · prod',
  },
  {
    id: 'a2',
    name: '결제 성공률',
    type: 'anomaly',
    operator: 'gt',
    threshold: 0,
    sensitivity: 3,
    data_source_name: '데일리카트 · prod',
  },
  {
    id: 'a3',
    name: '신규 가입',
    type: 'threshold',
    operator: 'lt',
    threshold: 200,
    sensitivity: null,
    fire_threshold: 1,
    data_source_name: 'analytics',
  },
]

// An explanation that CARRIES the markers → renders as two blocks, plus a segment list.
const EXPLAINED = `데이터에서 확인됨:
- 갱신 매출 −31% (₩2.9M → ₩2.0M)
- 신규 구독 −4%, 사실상 평소 범위
- US: normal
- Japan: −52%

가능성 높은 원인:
결제 웹훅 실패율이 0.3%에서 7.8%로 올라간 구간과 매출 하락 구간이 겹칩니다. 저장된 코드 컨텍스트상 결제 확정은 status = 'paid' 에서만 매출로 잡히므로, 확정되지 못한 주문이 매출에서 빠진 것으로 보입니다.`

const EVENTS: IncidentEventRow[] = [
  // 1. open, explained, unacked — the flagship row
  {
    id: 'e1',
    alert_id: 'a1',
    kind: 'fired',
    value: 1_900_000,
    message: '일 매출이 임계치 ₩4,000,000 아래로 내려갔습니다. (현재 ₩1,900,000)',
    explanation: EXPLAINED,
    explained: true,
    notified: true,
    created_at: ago(5 * HOUR),
  },
  // 2. anomaly, resolved, acknowledged
  {
    id: 'e2',
    alert_id: 'a2',
    kind: 'fired',
    value: 91.2,
    message: '결제 성공률이 평소 평균 98.4 대비 7.2σ 이탈했습니다.',
    explanation: '카드사 한 곳의 승인 거절이 늘어난 구간으로 보입니다. 확정된 사실은 해당 PG 경유 주문에서만 실패가 늘었다는 점입니다.',
    explained: true,
    notified: true,
    created_at: ago(30 * HOUR),
    acknowledged_at: ago(28 * HOUR),
    acknowledged_by: null,
    ack_kind: 'ack',
    cause_feedback: 'partial',
    cause_correction: null,
  },
  { id: 'e2r', alert_id: 'a2', kind: 'resolved', value: 98.1, message: null, explanation: null, explained: false, notified: true, created_at: ago(26 * HOUR) },
  // 3. investigating (just fired, no explanation yet)
  {
    id: 'e3',
    alert_id: 'a3',
    kind: 'fired',
    value: 190,
    message: '신규 가입이 임계치 200 아래로 내려갔습니다. (현재 190)',
    explanation: null,
    explained: false,
    notified: false,
    created_at: ago(3 * 60_000),
  },
]

const INCIDENTS = deriveIncidents(EVENTS, new Map(ALERTS.map((a) => [a.id, a])), now)
const FLAGSHIP = INCIDENTS.find((i) => i.id === 'e1')!

const MOCK_CHROME: AppChrome = {
  dashboards: [{ id: 'd1', slug: 'core-kpi', name: '핵심 KPI', pinned: true, position: 0 }],
  user: { name: '김하나', email: 'admin@example.com', initials: '김하', isAdmin: false },
  org: { id: 'o1', name: 'Acme', initials: 'AC' },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', initials: 'AC', role: 'owner' }],
  billing: { plan: 'free', queriesUsed: 3, queriesLimit: 15, monitorsUsed: 3, monitorsLimit: 3 },
  monitors: { enabled: 3 },
}

function Label({ children }: { children: string }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--ink-3)',
        margin: '0 0 14px',
      }}
    >
      {children}
    </p>
  )
}

export default async function DevIncidentsPage({ searchParams }: { searchParams: Promise<{ mode?: string; status?: string; shell?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'success', status = 'all', shell } = await searchParams
  if (!['success', 'failure', 'throw', 'viewer', 'legacy', 'empty', 'long', 'pending', 'resolved'].includes(mode)) notFound()
  const selected = mode === 'resolved' ? INCIDENTS.find(i => i.id === 'e2')! : mode === 'pending' ? INCIDENTS.find(i => i.id === 'e3')! : FLAGSHIP
  const incident = { ...selected,
    feedback: selected.explanation ? selected.feedback ?? { value: 'partial' as const, correction: 'Sample retained correction' } : null,
    ...(mode === 'long' ? { alertName: 'SampleInternationalBusinessSignal_'.repeat(5), message: 'recorded_value_'.repeat(60), explanation: 'Unverified sample hypothesis: ' + 'diagnostic_'.repeat(80) } : {}),
  }
  const list = (
    <IncidentsTable incidents={mode === 'empty' ? [] : mode === 'long' ? [incident] : INCIDENTS} filter={parseFilter(status)} timezone={TIMEZONE} />
  )
  const detail = (
    <IncidentDetailView
      incident={incident}
      alert={ALERTS.find(a => a.id === incident.alertId)!}
      description="결제가 확정된 주문 기준 당일 매출 합계."
      metricSql={"select sum(total_amount)\nfrom orders\nwhere status = 'paid'\n  and order_date = current_date"}
      snoozedUntil={null}
      ackReady={mode !== 'legacy'}
      canManage={mode !== 'viewer'}
      timezone={TIMEZONE}
      triage={<IncidentTriagePreview key={`${mode}-${incident.id}`} mode={mode} incident={incident} />}
    />
  )

  if (shell === 'list' || shell === 'detail') {
    return <DashboardShell chrome={MOCK_CHROME}>{shell === 'list' ? list : detail}</DashboardShell>
  }

  return (
    <AppSurface>
    <div style={{ minHeight: '100vh', background: 'var(--paper)', padding: '40px 28px' }}>
      <DevThemeToggle />
      {/* The pages render at the shell's wide container (--ax-content-wide). */}
      <div style={{ maxWidth: 'var(--ax-content-wide)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 56 }}>
        <div>
          <Label>Incidents · list</Label>
          <p style={{ fontSize: 13, marginBottom: 16 }}>LOCAL SAMPLE DATA · No database connection or real incident action.</p>
          {list}
        </div>
        <div>
          <Label>Incidents · detail (open · explained · unacked)</Label>
          {detail}
        </div>
      </div>
    </div>
    </AppSurface>
  )
}
