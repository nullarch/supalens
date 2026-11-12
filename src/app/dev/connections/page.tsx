import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { ConnectionsPreview } from './ConnectionsPreview'

export const metadata = { title: 'Connection design fixtures', robots: { index: false, follow: false } }

/**
 * Views: `list` (populated sources), `connect` (no sources; `mode=demo` → sample only),
 * `form` (postgres|mysql|firestore), `repo` (empty|list|attached), `projects` (see ProjectPickerView).
 * Rendered inside <AppSurface> so it carries the /app tokens the real route gets from DashboardShell.
 */
export default async function ConnectionsPreviewPage({ searchParams }: {
  searchParams: Promise<{ view?: string; mode?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'projects', mode = 'choose' } = await searchParams
  // `list` is the real /app/sources surface, which renders at the wide container — the fixture has
  // to match it or the card grid is measured at the wrong width.
  const wide = view === 'list' || view === 'connect'
  return <AppSurface>
    <main style={{ maxWidth: wide ? 'var(--ax-content-wide)' : 'var(--ax-content)', margin: '0 auto', padding: 'clamp(32px, 5vw, 48px) var(--ax-gutter) clamp(64px, 8vw, 80px)', boxSizing: 'content-box' }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6, margin: '0 0 28px' }}>
        DESIGN FIXTURE · Sample data. Project actions are local simulations. Do not submit real credentials, repository changes or OAuth connections. Browser tests intercept all connection requests.
      </p>
      <ConnectionsPreview view={view} mode={mode} />
    </main>
  </AppSurface>
}
