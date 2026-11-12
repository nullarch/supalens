import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { InvitationPreview } from './InvitationPreview'

export const metadata = { title: 'Invitation design fixtures', robots: { index: false, follow: false } }
const INVITATION_MODES = ['success', 'long', 'unconfigured', 'preview-unavailable', 'expired', 'processed', 'missing', 'mismatch', 'rejected', 'throw', 'malformed', 'missing-org', 'unauthorized', 'unavailable', 'pending', 'navigation-failed', 'navigation-pending', 'reload-failed', 'retry', 'stale'] as const

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'success' } = await searchParams
  if (!(INVITATION_MODES as readonly string[]).includes(mode)) notFound()
  return <AppSurface>
    <main style={{ width: 'min(100% - 2 * var(--ax-gutter), var(--ax-content))', margin: '0 auto', padding: '48px 0 80px' }}>
      <span className="dx-label">Design fixture · local sample invitation only. No membership, session, navigation or email changes.</span>
      <InvitationPreview key={mode} mode={mode} />
    </main>
  </AppSurface>
}
