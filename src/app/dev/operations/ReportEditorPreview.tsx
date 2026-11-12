'use client'

import { useEffect, useState } from 'react'
import { DashboardGrid, type GridWidget } from '@/components/dashboard/widgets'
import s from './operations-preview.module.css'

const widgets: GridWidget[] = [{ id: 'fixture-widget', spec: { type: 'bignumber', title: 'Paid without access', value: 'value' }, data: { columns: ['value'], rows: [{ value: 3 }] }, w: 6, h: 4 }]

/** Uses production editor/layout controls with in-memory persistence and no server actions. */
export function ReportEditorPreview() {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const [result, setResult] = useState('')
  const [fail, setFail] = useState(false)
  return <>
    <label data-report-editor-ready={ready} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13 }}>
      <input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} className={s.simulationToggle} />
      Simulate a save failure (local preview)
    </label>
    <DashboardGrid widgets={widgets} storageKey="dev-operations-editor" isAdmin
      editMeta={{ 'fixture-widget': { title: 'Paid without access', sql: 'SELECT 3::numeric AS value', refreshInterval: 60 } }}
      onPersist={items => { setResult(`Local layout: ${items.length} widget`); return { ok: true } }}
      onUpdateWidget={async (id, patch) => {
        if (fail) return { ok: false, message: 'Sample save failed. Your edits are still available.' }
        setResult(`Local update: ${id} / ${JSON.stringify(patch)}`)
        return { ok: true }
      }} />
    <p role="status" style={{ marginTop: 16, fontSize: 13 }}>{result}</p>
  </>
}
