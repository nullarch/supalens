import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { ViewSwitch } from '@/app/app/monitors/ViewSwitch'
import { MONITORS_VIEWS } from '@/app/app/monitors/view'
import { MonitorManagerPreview } from './MonitorManagerPreview'
import { MonitorDetailPreview } from './MonitorDetailPreview'

const DETAIL_OUTCOMES = ['success', 'failure', 'throw', 'malformed', 'pending', 'retry', 'unmet', 'refresh-error', 'navigation-error']

export const metadata = { title: 'Monitor manager design fixture', robots: { index: false, follow: false } }

export default async function MonitorPreview({ searchParams }: {
  searchParams: Promise<{ view?: string; mode?: string; outcome?: string; role?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'manager', mode = 'mixed', outcome = 'success', role = 'owner' } = await searchParams
  if (view === 'detail-actions') {
    if (!DETAIL_OUTCOMES.includes(outcome)) notFound()
    return <AppSurface><MonitorDetailPreview key={`${outcome}-${role}`} outcome={outcome} viewer={role === 'viewer'} /></AppSurface>
  }
  // The 감시 screen's view switch, on its own so both states and the count extremes can be eyeballed
  // (it renders above whichever view is showing on the real /app/monitors).
  if (view === 'switch') {
    const counts = [{ monitors: 0, incidents: 0 }, { monitors: 4, incidents: 2 }, { monitors: 1284, incidents: 1284 }]
    return (
      <AppSurface>
        <div data-page-width="wide" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24, padding: '40px 20px' }}>
          {counts.map((c) => MONITORS_VIEWS.map((v) => <ViewSwitch key={`${v}-${c.monitors}`} view={v} counts={c} />))}
        </div>
      </AppSurface>
    )
  }
  if (view !== 'manager') notFound()
  if (!['mixed', 'empty', 'paused', 'error', 'pending', 'healthy', 'incident', 'no-source', 'reconnect', 'reauthorized', 'goal', 'goal-composer'].includes(mode)) notFound()
  if (!['success', 'failure', 'throw', 'history-error', 'history-empty', 'partial', 'malformed'].includes(outcome)) notFound()
  return <AppSurface><MonitorManagerPreview key={`${mode}-${outcome}-${role}`} mode={mode} outcome={outcome} viewer={role === 'viewer'} /></AppSurface>
}
