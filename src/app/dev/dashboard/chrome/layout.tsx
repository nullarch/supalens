import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Chrome Variations (dev) · supalens',
  robots: { index: false, follow: false },
}

/** Dev-only: the sidebar+header variation gallery is not part of the product surface. */
export default function DevChromeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>{children}</div>
}
