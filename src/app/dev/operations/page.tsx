import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { BillingView } from '@/app/app/settings/billing/BillingView'
import { BillingSummaryPreview } from './BillingSummaryPreview'
import { MonitorSummaryPreview } from './MonitorSummaryPreview'
import { MonitorDetailView } from '@/app/app/monitors/[id]/MonitorDetailView'
import type { BillingSummary } from '@/lib/plans/summary'
import { getPlanLimits } from '@/lib/plans/limits'
import type { AlertSummary, AlertEventSummary } from '@/lib/alerts/server'
import { ReportEditorPreview } from './ReportEditorPreview'
import { ReportFooterPreview } from './ReportFooterPreview'
import { ReportGridActionsPreview } from './ReportGridActionsPreview'
import { ReportHeaderPreview } from './ReportHeaderPreview'
import { ReportFlowPreview } from './ReportFlowPreview'
import { ReportsIndex } from '@/app/app/dashboards/ReportsIndex'
import { EmptyReport } from '@/app/app/dashboards/EmptyReport'

export const metadata = { title: 'Operational design fixtures', robots: { index: false, follow: false } }

const billingModes = ['free', 'active', 'past_due', 'paused', 'scheduled', 'trialing', 'unlimited']
const monitorModes = ['healthy', 'incident', 'error', 'paused', 'empty']

function billingFor(mode: string): BillingSummary {
  const plan = mode === 'free' ? 'free' : mode === 'unlimited' ? 'premium' : 'basic'
  const effectivePlan = ['past_due', 'paused'].includes(mode) ? 'free' : plan
  return {
    plan, effectivePlan, limits: getPlanLimits(effectivePlan),
    subscriptionStatus: mode === 'free' ? null : ['past_due', 'paused', 'trialing'].includes(mode) ? mode : 'active',
    periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z',
    scheduledChange: mode === 'scheduled' ? { action: 'cancel', effective_at: '2026-10-01T00:00:00Z' } : null,
    hasBilling: mode !== 'free',
    usage: { queries: mode === 'past_due' ? 165 : 12, tokens: 0, connections: 1, members: 2, alerts: 3, dashboards: 2 },
    overage: mode === 'active' ? { enabled: true, queries: 4, estUsd: .4, ratePerQueryUsd: .1 } : null,
    transactions: mode === 'free' ? [] : [
      { id: 'fixture-current', date: '2026-09-01T00:00:00Z', amountCents: 8900, currency: 'USD', status: mode === 'past_due' ? 'past_due' : 'completed' },
      { id: 'fixture-refund', date: '2026-08-12T00:00:00Z', amountCents: 2500, currency: 'USD', status: 'refunded' },
      { id: 'fixture-unknown', date: null, amountCents: null, currency: null, status: null },
    ],
  }
}

function monitorFor(mode: string): AlertSummary {
  return {
    id: 'fixture-monitor', orgId: 'fixture-org', dataSourceId: 'fixture-source', dataSourceName: 'Northstar / production',
    name: 'Paid without access', description: 'Completed payments without an active entitlement. Internal test accounts are excluded.',
    type: 'threshold', operator: 'gte', threshold: 1, metricSql: 'SELECT 3::numeric AS value', sensitivity: null, goal: null, condition: null,
    fireThreshold: 2, cooldownSeconds: 3600, enabled: mode !== 'paused', status: mode === 'incident' ? 'firing' : 'normal',
    lastValue: mode === 'empty' ? null : mode === 'healthy' ? 0 : 3,
    lastCheckedAt: mode === 'empty' ? null : '2026-09-06T06:00:00Z',
    lastError: mode === 'error' ? 'Sample: statement timeout while checking entitlements' : null,
    lastNotifiedAt: null, createdAt: '2026-08-15T06:00:00Z', explanation: null, lastFiredAt: null,
  }
}

const events: AlertEventSummary[] = [
  { id: 'fixture-recovered', kind: 'resolved', value: 0, message: 'No completed payment is missing an entitlement in this sample.', explanation: null, notified: false, createdAt: '2026-09-05T06:10:00Z' },
  { id: 'fixture-fired', kind: 'fired', value: 3, message: 'Three sample payments have no matching active entitlement.', explanation: 'A provisioning retry may not have completed. Review worker logs to verify; the query alone does not establish the cause.', notified: false, createdAt: '2026-09-05T06:00:00Z' },
]

/** Presentation-only views: no page loaders, auth, billing reconciliation or live queries.
 * Billing/report management is inert. Monitor uses viewer permissions. Report editor
 * receives local callbacks only, never the production server actions.
 */
export default async function OperationsPreview({ searchParams }: {
  searchParams: Promise<{ view?: string; mode?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'billing', mode = view === 'monitor' ? 'incident' : 'active' } = await searchParams
  if (!['billing', 'monitor', 'reports', 'board-empty', 'editor', 'footer', 'grid-actions', 'header', 'save', 'report-actions'].includes(view)) notFound()
  if (['save', 'report-actions'].includes(view) && !['active', 'success', 'failure', 'throw', 'empty', 'load-error', 'partial', 'create-failure', 'unconfigured', 'add-throw', 'create-throw'].includes(mode)) notFound()
  if (view === 'header' && !['active', 'success', 'failure', 'throw'].includes(mode)) notFound()
  if (view === 'billing' && !billingModes.includes(mode)) notFound()
  if (view === 'monitor' && !monitorModes.includes(mode)) notFound()
  return <AppSurface><main style={{ maxWidth: 1168, padding: '32px 20px', margin: '0 auto' }}>
    <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)', marginBottom: 20 }}>
      DESIGN FIXTURE · Sample data · No live query, billing, notification or account changes.
    </p>
    {view === 'billing' && <BillingSummaryPreview><BillingView summary={billingFor(mode)} billingConfigured={false} yearlyAvailable={false} /></BillingSummaryPreview>}
    {view === 'monitor' && <MonitorSummaryPreview><MonitorDetailView alert={monitorFor(mode)} events={mode === 'empty' ? [] : events}
      targets={{ slackChannel: 'business-alerts', slackWebhook: false, discord: false, emailCount: 1 }} timezone="UTC" intervalSec={600} canManage={false} canConfigure={false} /></MonitorSummaryPreview>}
    {view === 'reports' && <div inert><ReportsIndex dashboards={mode === 'empty' ? [] : [
      { id: 'fixture-core', slug: 'fixture-core', name: 'Business health', pinned: true, position: 0 },
      { id: 'fixture-growth', slug: 'fixture-growth', name: 'Acquisition and activation — weekly operating review', pinned: false, position: 1 },
    ]} /></div>}
    {view === 'editor' && <ReportEditorPreview />}
    {view === 'footer' && <ReportFooterPreview />}
    {view === 'grid-actions' && <ReportGridActionsPreview />}
    {view === 'board-empty' && <EmptyReport />}
    {view === 'header' && <ReportHeaderPreview key={mode} mode={mode} />}
    {(view === 'save' || view === 'report-actions') && <ReportFlowPreview key={`${view}-${mode}`} view={view} mode={mode} />}
  </main></AppSurface>
}
