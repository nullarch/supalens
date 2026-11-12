'use client'

import { useRef, useState, type ComponentProps } from 'react'
import { BusinessModelTabs, type BusinessModelIO } from '@/app/app/business-model/[sourceId]/BusinessModelTabs'

type Props = Omit<ComponentProps<typeof BusinessModelTabs>, 'io'>

/** No transport, server actions or actual context generation from this fixture. */
export function ContextPreview({ mode, ...props }: Props & { mode: string }) {
  const restored = useRef(false)
  const [calls, setCalls] = useState(0)
  const [refreshes, setRefreshes] = useState(0)
  const io: BusinessModelIO = {
    request: async () => {
      setCalls(n => n + 1)
      await new Promise(resolve => setTimeout(resolve, 500))
      const current = restored.current ? 'success' : mode
      if (current === 'throw') throw new Error('Sample transport failure')
      const errors: Record<string, string> = { failure: 'forbidden', limit: 'context_limit', quota: 'quota_exceeded', running: 'generation_in_progress' }
      if (errors[current]) return Response.json({ error: errors[current] }, { status: 409 })
      if (current === 'malformed') return Response.json({ ok: true, tier: 2 })
      return Response.json(props.parsed.looksBaseline ? { ok: true, tier: 1 } : { ok: true, tier: 2, triggerRunId: 'sample-job' })
    },
    refresh: () => { setRefreshes(n => n + 1) },
  }
  return <section data-context-preview>
    <p style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 12 }}>
      Local requests: <span data-requests>{calls}</span> · Local refreshes: <span data-refreshes>{refreshes}</span>
      {' '}<button type="button" className="dx-btn-ghost" onClick={() => { restored.current = true }}>Restore sample responses</button>
    </p>
    <BusinessModelTabs {...props} io={io} />
  </section>
}
