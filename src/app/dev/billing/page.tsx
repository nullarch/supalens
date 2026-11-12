import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { BillingActionsPreview } from './BillingActionsPreview'

export const metadata = { title: 'Billing action design fixtures', robots: { index: false, follow: false } }
export default async function BillingPreview({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'success' } = await searchParams
  if (!['success', 'start-failure', 'start-throw', 'init-failure', 'init-throw', 'open-throw',
    'confirm-failure', 'confirm-throw', 'missing-transaction', 'pending', 'portal-failure',
    'portal-throw', 'portal-invalid', 'portal-success', 'refresh-throw', 'telemetry-throw'].includes(mode)) notFound()
  return <AppSurface><main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 20px 64px' }}>
    <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>LOCAL BILLING PREVIEW · Sample data. No Paddle script, payment, account changes or external navigation. The dialog simulates events, not Paddle’s own interface.</p>
    <h1 className="dx-section-title" style={{ margin: '20px 0 0' }}>Billing actions</h1>
    <BillingActionsPreview mode={mode} />
  </main></AppSurface>
}
