'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { AppErrorContent } from '@/components/feedback/AppErrorContent'

/**
 * Error boundary for everything under /app (the product surface). Reports to
 * Sentry then offers a friendly retry — this is the boundary users will
 * actually hit; src/app/global-error.tsx only covers a crash in the root
 * layout itself.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try { Sentry.captureException(error) } catch { /* recovery must remain available */ }
  }, [error])

  return <AppErrorContent reset={reset} />
}
