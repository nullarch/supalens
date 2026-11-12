import { notFound } from 'next/navigation'
import Link from 'next/link'
import '@/app/app/dashboard.css'
import AppNotFound from '@/app/app/not-found'
import AppLoading from '@/app/app/loading'
import AskLoading from '@/app/app/ask/loading'
import AskHistoryLoading from '@/app/app/ask/history/loading'
import AskRunLoading from '@/app/app/ask/history/[id]/loading'
import BillingLoading from '@/app/app/settings/billing/loading'
import BusinessModelLoading from '@/app/app/business-model/loading'
import BusinessModelDetailLoading from '@/app/app/business-model/[sourceId]/loading'
import DashboardLoading from '@/app/app/dashboards/[slug]/loading'
import DashboardsLoading from '@/app/app/dashboards/loading'
import ReportsLoading from '@/app/app/reports/loading'
import DeveloperLoading from '@/app/app/settings/developer/loading'
import IncidentDetailLoading from '@/app/app/incidents/[id]/loading'
import IncidentsLoading from '@/app/app/incidents/loading'
import IntegrationsLoading from '@/app/app/settings/integrations/loading'
import KpiReviewLoading from '@/app/app/sources/[id]/kpis/loading'
import MembersLoading from '@/app/app/settings/members/loading'
import MonitorDetailLoading from '@/app/app/monitors/[id]/loading'
import MonitorsLoading from '@/app/app/monitors/loading'
import NotificationsLoading from '@/app/app/settings/notifications/loading'
import OverviewLoading from '@/app/app/overview/loading'
import SettingsLoading from '@/app/app/settings/loading'
import SetupLoading from '@/app/app/setup/loading'
import SourcesLoading from '@/app/app/sources/loading'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { ErrorPreview } from './ErrorPreview'

export const metadata = { title: 'Fallback design fixtures', robots: { index: false, follow: false } }
const loading = {
  app: AppLoading, ask: AskLoading, history: AskHistoryLoading, answer: AskRunLoading,
  billing: BillingLoading, context: BusinessModelLoading, 'context-detail': BusinessModelDetailLoading,
  dashboard: DashboardLoading, dashboards: DashboardsLoading, reports: ReportsLoading, developer: DeveloperLoading,
  'incident-detail': IncidentDetailLoading, incidents: IncidentsLoading, integrations: IntegrationsLoading,
  kpis: KpiReviewLoading, members: MembersLoading, 'monitor-detail': MonitorDetailLoading,
  monitors: MonitorsLoading, notifications: NotificationsLoading,
  overview: OverviewLoading, settings: SettingsLoading, setup: SetupLoading, sources: SourcesLoading,
}

export default async function FallbackPreview({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'all' } = await searchParams
  if (!['all', 'error', 'root-error', 'not-found', ...Object.keys(loading)].includes(mode)) notFound()
  // Skeletons for pages that render at the wide container have to be previewed there too, or the
  // grid/table inside them is measured at a width the real route never uses.
  const WIDE = new Set(['sources', 'monitors', 'incidents', 'incident-detail', 'overview', 'reports', 'dashboards'])
  const content = <main style={{ maxWidth: WIDE.has(mode) ? 1600 : 1024, margin: '0 auto', padding: 'clamp(32px, 5vw, 48px) clamp(20px, 3.4vw, 36px) 80px', minWidth: 0 }}>
    <h1 className="dx-title">Fallback design preview</h1>
    <p className="dx-sub">Actual presentations · No database, live error reporting, or account actions. Retry is a local callback.</p>
    <nav aria-label="Preview mode" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '20px 0 36px' }}>
      {['all', 'error', 'root-error', 'not-found', ...Object.keys(loading)].map(key => <Link key={key} href={`?mode=${key}`} className={key === mode ? 'dx-badge dx-badge-clay' : 'dx-badge'} aria-current={key === mode ? 'page' : undefined} style={{ textDecoration: 'none' }}>{key}</Link>)}
    </nav>
    {mode === 'error' && <ErrorPreview />}
    {mode === 'root-error' && <ErrorPreview root />}
    {mode === 'not-found' && <AppNotFound />}
    {Object.entries(loading).filter(([key]) => mode === 'all' || mode === key).map(([key, Component]) => <section key={key} data-loading-sample={key} style={{ minWidth: 0, marginBottom: 48 }}>
      <h2 className="dx-label" style={{ margin: 0, padding: '14px 0 16px', borderTop: '1px solid var(--line)' }}>{key}</h2>
      <Component />
    </section>)}
  </main>
  // The root-error document never has the app tokens; previewing it inside an app
  // surface would restyle it with rules the real failure cannot load.
  return mode === 'root-error' ? content : <AppSurface>{content}</AppSurface>
}
