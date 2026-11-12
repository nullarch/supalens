import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { IntegrationsPreview } from './IntegrationsPreview'

export const metadata = { title: 'Integration design fixtures', robots: { index: false, follow: false } }

export default async function IntegrationsPreviewPage({ searchParams }: {
  searchParams: Promise<{ mode?: string; role?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'populated', role = 'owner' } = await searchParams
  if (!['populated', 'empty', 'long', 'pending', 'revoked', 'expired', 'error', 'unknown', 'slack-unconfigured', 'slack-unavailable', 'sources-disabled'].includes(mode)) notFound()
  if (!['owner', 'admin', 'member', 'viewer'].includes(role)) notFound()
  return <AppSurface>
    <div style={{ width: 'min(100% - 2 * var(--ax-gutter), 1104px)', margin: '0 auto', padding: '32px 0 64px' }}>
      <IntegrationsPreview key={mode + role} mode={mode} role={role} />
    </div>
  </AppSurface>
}
