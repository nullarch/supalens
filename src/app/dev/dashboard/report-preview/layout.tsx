import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

export const metadata = { title: 'Report preview (dev) · supalens', robots: { index: false, follow: false } }

/** Dev-only: report boards are auth-gated, so the monitoring strip is eyeballed here. */
export default function DevReportPreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>{children}</div>
}
