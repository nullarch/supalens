import type { KpiCatalogRow } from '@/lib/kpi/types'

export const base: KpiCatalogRow = {
  id: 'fixture-kpi', orgId: 'fixture-org', dataSourceId: 'fixture-source', extractionId: null,
  key: 'paid_without_access', title: 'Paid without access', category: 'ops',
  description: 'Completed payments without a matching active entitlement. Internal test accounts are excluded.',
  importance: 5, metricSql: 'SELECT 3::numeric AS value',
  vizSpec: { v: 1, query: { sql: 'SELECT 3::numeric AS value' }, sample: { columns: ['value'], rows: [{ value: 3 }] }, chart: { type: 'bignumber', title: 'Paid without access', value: 'value' } },
  alertConfig: { type: 'threshold', operator: 'gte', threshold: 1 }, noMonitor: null,
  evidence: [{ kind: 'table', ref: 'public.entitlements' }, { kind: 'file', ref: 'src/billing/provisioning/complete-payment.ts:42' }],
  status: 'proposed', applied: null, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z',
}

export const ownerRows: KpiCatalogRow[] = [
  base,
  { ...base, id: 'fixture-anomaly', key: 'paid_job_failure_rate', title: 'Paid job failure rate', category: 'ops', alertConfig: { type: 'anomaly', sensitivity: 3 },
    vizSpec: { ...base.vizSpec, sample: { columns: ['day', 'value'], rows: [{ day: 'Mon', value: 3 }, { day: 'Tue', value: 4 }, { day: 'Wed', value: 2 }] }, chart: { type: 'bar', orientation: 'vertical', title: 'Paid job failure rate', x: 'day', y: ['value'] } } },
  { ...base, id: 'fixture-snapshot', key: 'active_accounts', title: 'Active accounts', category: 'growth', importance: 4,
    alertConfig: null, noMonitor: { kind: 'none', reason: 'snapshot_only', note: 'Sample snapshot, not a monitor.' } },
  { ...base, id: 'fixture-stale', key: 'international_subscription_entitlement_processing', title: 'International subscription entitlement processing', status: 'stale', importance: 3 },
  { ...base, id: 'fixture-accepted', key: 'approved_metric', title: 'Previously approved metric', status: 'accepted', importance: 3, applied: { dashboardId: 'fixture-report' } },
]
