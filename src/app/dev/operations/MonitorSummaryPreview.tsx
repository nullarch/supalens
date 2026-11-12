'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** Native details can open before React hydrates the server-rendered children.
 * Wait for this local marker before the verifier changes their open attribute. */
export function MonitorSummaryPreview({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  return <div data-monitor-summary-ready={ready}>{children}</div>
}
