import '@/app/app/dashboard.css' // the app tokens + .dx-* primitives a real report renders inside
import { getTranslations } from 'next-intl/server'
import DashboardShell from '@/components/dashboard/DashboardShell'
import type { AppChrome } from '@/lib/dashboards/types'
import { ReportPreviewBoard } from './ReportPreviewBoard'

/**
 * Dev-only preview of a REPORT PAGE — the real shell, the real report header and the real
 * board with the monitoring strip in its four states (watching / anomaly / paused /
 * unlinked — the last card must have no strip). `/app/dashboards/[slug]` is auth-gated, so
 * everything here is fixture data with local, in-memory actions.
 */
const CHROME: AppChrome = {
  dashboards: [{ id: 'dev-report', slug: 'core-kpi', name: '핵심 KPI', pinned: true, position: 0 }],
  user: { name: 'Preview', email: 'preview@example.com', initials: 'PR', isAdmin: false },
  org: { id: 'o1', name: 'Acme', initials: 'AC' },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', initials: 'AC', role: 'owner' }],
  billing: { plan: 'free', queriesUsed: 3, queriesLimit: 15, monitorsUsed: 3, monitorsLimit: 3 },
  monitors: { enabled: 3 },
}

export default async function ReportPreviewPage() {
  const t = await getTranslations('appDashboards')
  return (
    <DashboardShell chrome={CHROME}>
      <ReportPreviewBoard addWidgetLabel={t('addWidget')} />
    </DashboardShell>
  )
}
