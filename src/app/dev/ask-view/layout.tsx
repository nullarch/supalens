import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'

export const metadata = { title: 'Ask Answer Layout (dev) · supalens', robots: { index: false, follow: false } }

/** Dev-only: fixture render of the /app/ask assistant message (AgentView) — not a product surface. */
export default function DevAskViewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  // Mounted without DashboardShell, so the app scope (tokens + fonts) comes from AppSurface.
  return <AppSurface>{children}</AppSurface>
}
