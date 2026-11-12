import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { KpiReviewClient } from '@/app/app/sources/[id]/kpis/KpiReviewClient'
import { base } from './fixtures'
import { KpiOwnerPreview } from './KpiOwnerPreview'
import { KpiExtractPreview } from './KpiExtractPreview'
import { EXTRACT_MODES } from './extract-fixtures'

export const metadata = { title: 'KPI design fixtures', robots: { index: false, follow: false } }
const REEXTRACT_MODES = ['extract-accepted', 'extract-running', 'extract-conflict', 'extract-malformed', 'extract-throw', 'extract-retry']

/** Viewer role suppresses the automatic apply dry-run; no running extraction
 * means no polling. Inert content also blocks manual mutations/navigation.
 */
export default async function KpiPreview({ searchParams }: { searchParams: Promise<{ mode?: string; owner?: string; variant?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'review', owner, variant } = await searchParams
  if (variant === 'extract') {
    if (!EXTRACT_MODES.includes(mode)) notFound()
    return <AppSurface><main style={{ padding: 24 }}><KpiExtractPreview key={mode} mode={mode} /></main></AppSurface>
  }
  if (owner === '1') {
    if (mode.startsWith('extract-') && !REEXTRACT_MODES.includes(mode)) notFound()
    return <AppSurface><KpiOwnerPreview key={`${mode}-${variant}`} mode={mode} modal={variant === 'modal'} /></AppSurface>
  }
  if (!['review', 'empty', 'failed'].includes(mode)) notFound()
  return <AppSurface><main style={{ padding: 'clamp(32px, 5vw, 48px) clamp(20px, 3.4vw, 36px) 80px', maxWidth: 1096, margin: '0 auto' }}>
    <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 20 }}>DESIGN FIXTURE · Sample KPI proposals · Read-only preview; no queries or approvals.</p>
    <div inert>
      <KpiReviewClient sourceId="fixture-source" sourceName="Northstar / production" canManage={false} dashboards={[]} initialKpis={mode === 'review' ? [
        base,
        { ...base, id: 'fixture-accepted', key: 'active_accounts', title: 'Active accounts', status: 'accepted', importance: 3, alertConfig: null, applied: { dashboardId: 'fixture-dashboard' } },
        { ...base, id: 'fixture-stale', key: 'failed_jobs', title: 'Failed paid jobs', status: 'stale', importance: 3 },
      ] : []} initialExtraction={mode === 'failed' ? {
        id: 'fixture-extraction', orgId: 'fixture-org', dataSourceId: 'fixture-source', status: 'failed', tier: 2, proposedCount: null,
        error: 'Sample: connection unavailable during analysis.', triggerRunId: null, createdAt: '2026-09-06T10:00:00Z', completedAt: null,
      } : null} />
    </div>
  </main></AppSurface>
}
