'use client'

import { useState } from 'react'
import { AppErrorContent } from '@/components/feedback/AppErrorContent'
import { RootErrorContent, useRootErrorDisplay } from '@/components/feedback/RootErrorContent'

/** Actual presentations, local retry callback only: no exception reporting. */
export function ErrorPreview({ root = false }: { root?: boolean }) {
  const [attempts, setAttempts] = useState(0)
  const { locale, theme } = useRootErrorDisplay()
  const reset = () => setAttempts(value => value + 1)
  return <div className={root ? 'sl-root-fallback' : undefined} data-fallback-theme={theme} data-error-preview>
    {root ? <RootErrorContent locale={locale} reset={reset} /> : <AppErrorContent reset={reset} />}
    <p style={{ fontSize: 13, padding: 16 }} role="status">Local retry callbacks: {attempts}. No actual recovery or report sent.</p>
  </div>
}
