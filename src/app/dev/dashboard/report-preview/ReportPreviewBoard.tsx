'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { DashboardGrid } from '@/components/dashboard/widgets'
import type { GridWidget } from '@/components/dashboard/widgets'
import { byKey } from '@/components/dashboard/widgets/__fixtures__/samples'
import { DashboardHeader, type ReportHeaderActions } from '@/app/app/dashboards/DashboardHeader'
import type { DashboardSummary } from '@/lib/dashboards/types'
import s from '@/app/app/dashboards/overview.module.css'

/**
 * The report page with fixtures: the real header (local, in-memory actions) above the real
 * board. `/app/dashboards/[slug]` is auth-gated and its server view wires production actions,
 * so the four monitoring states (watching / anomaly / paused / unlinked) are mounted here.
 * No persistence callbacks — layout edits stay in this browser tab.
 */
const kpi = byKey('kpi')!
const line = byKey('line')!
const bar = byKey('bar')!
const table = byKey('table') ?? byKey('bar-h')!

// fixed recorded times: a client module must render the same markup on the server and in the browser
const CHECKED = '2026-09-17T03:50:00Z'

const WIDGETS: GridWidget[] = [
  {
    id: 'w-watching',
    spec: { ...kpi.spec, title: '월 반복 매출 (MRR)' },
    data: kpi.data,
    w: 4,
    h: 4,
    monitor: { alertId: 'a1', status: 'normal', enabled: true, lastCheckedAt: CHECKED, via: 'provenance' },
    definition: {
      key: 'mrr',
      description: '취소·환불된 구독을 제외한 활성 구독의 월 환산 금액. 내부 테스트 계정은 제외합니다.',
      evidence: [
        { kind: 'file', ref: 'app/billing/mrr.ts:42' },
        { kind: 'table', ref: 'public.subscriptions' },
        { kind: 'table', ref: 'public.payments' },
      ],
    },
  },
  {
    id: 'w-incident',
    spec: { ...line.spec, title: '일별 신규 가입' },
    data: line.data,
    w: 8,
    h: 4,
    monitor: {
      alertId: 'a2',
      status: 'firing',
      enabled: true,
      lastCheckedAt: '2026-09-17T03:55:00Z',
      openIncidentEventId: 'e9',
      via: 'provenance',
    },
    definition: { key: 'new_signups', description: '삭제되지 않은 계정의 일별 신규 가입 수.', evidence: [{ kind: 'table', ref: 'auth.users' }] },
  },
  {
    id: 'w-paused',
    spec: { ...bar.spec, title: '월별 매출 추이' },
    data: bar.data,
    w: 6,
    h: 4,
    monitor: { alertId: 'a3', status: 'normal', enabled: false, lastCheckedAt: null, via: 'sql' },
    definition: null,
  },
  {
    id: 'w-unlinked',
    spec: { ...table.spec, title: '지역별 매출 (모니터 없음)' },
    data: table.data,
    w: 6,
    h: 4,
    monitor: null,
    definition: null,
  },
]

export function ReportPreviewBoard({ addWidgetLabel }: { addWidgetLabel: string }) {
  const [dashboard, setDashboard] = useState<DashboardSummary>({ id: 'dev-report', slug: 'core-kpi', name: '핵심 KPI', pinned: true, position: 0 })
  const actions = useMemo<ReportHeaderActions>(() => ({
    pin: async (_id, pinned) => { setDashboard(d => ({ ...d, pinned })); return { ok: true, data: undefined } },
    rename: async (_id, name) => { setDashboard(d => ({ ...d, name })); return { ok: true, data: undefined } },
    remove: async () => ({ ok: false, reason: 'error', message: 'Preview: deleting is disabled.' }),
    refresh: () => {},
    navigate: () => {},
  }), [])
  return (
    <DashboardHeader dashboard={dashboard} actions={actions}>
      <div className={s.reportView}>
        <DashboardGrid widgets={WIDGETS} storageKey="dev-report-preview" />
        {/* mirrors DashboardView's add-widget control (the server view is not mountable here) */}
        <Link className={s.fab} href="/app/ask" aria-label={addWidgetLabel}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className={s.fabLabel}>{addWidgetLabel}</span>
        </Link>
      </div>
    </DashboardHeader>
  )
}
