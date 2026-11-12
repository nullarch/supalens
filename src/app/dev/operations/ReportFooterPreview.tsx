'use client'

import { DashboardGrid, type GridWidget } from '@/components/dashboard/widgets'

const states = ['recorded', 'pending', 'invalid', 'paused', 'incident', 'unlinked'] as const
const widgets: GridWidget[] = states.map((state, index) => ({
  id: `footer-${state}`,
  spec: { type: 'bignumber', title: `Sample ${state} / 決済後のアクセス権限 · 결제 후 권한`, value: 'value' },
  data: { columns: ['value'], rows: [{ value: 3 }] },
  w: 4, h: index % 2 ? 3 : 5,
  monitor: state === 'unlinked' ? null : {
    alertId: `sample-monitor-${state}`, status: state === 'incident' ? 'firing' : 'normal', enabled: state !== 'paused', via: 'provenance',
    lastCheckedAt: state === 'pending' ? null : state === 'invalid' ? 'not-a-date' : '2026-09-08T00:00:00Z',
    ...(state === 'incident' ? { openIncidentEventId: 'sample-incident' } : {}),
  },
  definition: { key: 'sample-definition', description: 'Stored sample definition. No database query was executed.', evidence: Array.from({ length: 9 }, (_, i) => ({ kind: 'code', ref: `src/billing/${'international-entitlement-check-'.repeat(4)}${i}.ts`, note: `Evidence ${i + 1}: 결제 완료 후 접근 권한을 확인합니다. 支払い済みの顧客に利用権限があるか確認します.` })) },
}))

/** Actual grid/footers, with sample links only and no persistence callbacks. */
export function ReportFooterPreview() {
  return <div data-report-footer-preview><DashboardGrid widgets={widgets} storageKey="dev-report-footer" isAdmin
    editMeta={Object.fromEntries(widgets.map(w => [w.id, { title: w.spec.title ?? '', sql: null, refreshInterval: null }]))} /></div>
}
