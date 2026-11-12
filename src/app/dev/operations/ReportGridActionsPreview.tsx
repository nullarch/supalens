'use client'

import { useEffect, useState } from 'react'
import { DashboardGrid, type GridWidget } from '@/components/dashboard/widgets'

const widgets: GridWidget[] = ['a', 'b', 'c'].map((id, index) => ({
  id, spec: { type: 'bignumber', title: `${id.toUpperCase()} · Payments / 결제 / 決済 ${'International entitlement review '.repeat(2)}`, value: 'value' },
  data: { columns: ['value'], rows: [{ value: index + 1 }] }, w: 6, h: 3,
}))
const sql = `SELECT '${'sample_value_'.repeat(30)}' AS value\n${'-- Read-only example; no query is executed.\n'.repeat(35)}`
const editMeta = Object.fromEntries(widgets.map(widget => [widget.id, { title: widget.spec.title!, sql, refreshInterval: 60 }]))

/** Only local promises/counters. Never calls report actions, clipboard or SQL. */
export function ReportGridActionsPreview() {
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState('success')
  const [board, setBoard] = useState(0)
  const [calls, setCalls] = useState({ layout: 0, remove: 0, update: 0, copy: 0 })
  const [payload, setPayload] = useState('')
  useEffect(() => setReady(true), [])
  async function action(kind: keyof typeof calls, value: unknown) {
    setCalls(previous => ({ ...previous, [kind]: previous[kind] + 1 }))
    setPayload(JSON.stringify({ kind, value }))
    if (mode === 'pending') await new Promise(resolve => setTimeout(resolve, 1800))
    if (mode === 'throw') throw new Error('Local simulated failure')
    if (mode === 'malformed') return undefined
    return { ok: mode !== 'rejected', message: 'Private sample response must not be displayed' }
  }
  return <section data-grid-actions-ready={ready}>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <label>Local outcome <select aria-label="Local outcome" value={mode} onChange={event => setMode(event.target.value)}>
        {['success', 'rejected', 'throw', 'malformed', 'pending'].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <button type="button" onClick={() => setBoard(previous => previous + 1)}>Switch sample report</button>
    </div>
    <output data-grid-calls={JSON.stringify(calls)} data-grid-payload={payload} style={{ display: 'none' }} />
    <DashboardGrid widgets={widgets} storageKey={`dev-grid-actions-${board}`} isAdmin editMeta={editMeta}
      onPersist={items => action('layout', items)} onRemoveWidget={id => action('remove', id)}
      onUpdateWidget={async (id, patch) => await action('update', { id, patch }) as { ok: boolean }}
      onCopySql={async value => { const result = await action('copy', value); if (!result?.ok) throw new Error('Local copy rejected') }} />
  </section>
}
