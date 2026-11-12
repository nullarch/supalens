import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import '@/components/landing/landing.css'
import './test-app.css'
import { Shell } from './_components/Shell'

export const metadata = {
  title: 'Product Prototype (test) · supalens',
  robots: { index: false, follow: false },
}

/**
 * Design-prototype staging ground: the product UI (질문하기 · 대시보드 · 알림)
 * rebuilt in the marketing ".cx" language. Not a shipped surface — gated to
 * dev only, mirroring the /dev widget gallery convention.
 */
export default function TestAppLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="cx tx">
      <Shell>{children}</Shell>
    </div>
  )
}
