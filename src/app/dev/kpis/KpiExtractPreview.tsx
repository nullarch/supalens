'use client'

import { useState } from 'react'
import { KpiExtractModal } from '@/app/app/sources/KpiExtractModal'
import { SourcesClient, type KpiState } from '@/app/app/sources/SourcesClient'
import { extractSource, extractState } from './extract-fixtures'

/** Local component state only. Controller mode is reserved for the network-intercepting verifier. */
export function KpiExtractPreview({ mode }: { mode: string }) {
  const [open, setOpen] = useState(true)
  const [state, setState] = useState<KpiState>(extractState)
  const [calls, setCalls] = useState(0)
  const [review, setReview] = useState(false)
  if (mode === 'controller') return <SourcesClient sources={[extractSource]} repos={[]} githubAppUrl={null} />
  return <>
    <p>LOCAL SIMULATION · No extraction requests or database access.</p>
    <output data-testid="extract-calls">{calls}</output>
    <output data-testid="extract-review">{String(review)}</output>
    <button className="dx-btn" onClick={() => setOpen(true)}>Open extraction preview</button>
    {open && <KpiExtractModal source={{ ...extractSource, attachedRepoId: mode === 'repo' ? 'fixture-repo' : null }}
      state={state} onClose={() => setOpen(false)} onGoReview={() => { setReview(true); setOpen(false) }}
      onExtract={async () => {
        setCalls(value => value + 1)
        if (mode === 'pending') return new Promise(() => {})
        if (mode === 'throw') throw new Error('Local simulated transport interruption')
        if (mode === 'unknown') return { ok: false, kind: 'unknown' }
        if (mode === 'quota' || mode === 'rejected') return { ok: false, kind: mode === 'quota' ? 'quota' : 'err', text: 'Local simulated rejection. No request was sent.' }
        setState({ ...extractState, extractionStatus: 'running', proposed: 2 })
        if (['completed', 'partial', 'failed', 'missing-status'].includes(mode)) {
          setTimeout(() => setState({ ...extractState,
            extractionStatus: mode === 'missing-status' ? null : mode === 'completed' ? 'completed' : 'failed',
            proposed: mode === 'failed' ? 0 : 2,
          }), 600)
        }
        return { ok: true }
      }} />}
  </>
}
