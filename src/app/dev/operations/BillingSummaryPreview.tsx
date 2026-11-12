'use client'

import { useEffect, useState, type ReactNode } from 'react'

/** Rendering stays inert. The verifier waits for hydration before its isolated
 * keyboard-only table check; no billing button or link is activated. */
export function BillingSummaryPreview({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  return <div inert data-billing-summary-ready={ready}>{children}</div>
}
