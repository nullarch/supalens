'use client'

import { useEffect, useMemo, useState } from 'react'
import { DashboardHeader, type ReportHeaderActions } from '@/app/app/dashboards/DashboardHeader'
import type { ActionResult, DashboardSummary } from '@/lib/dashboards/types'
import s from './operations-preview.module.css'

export function ReportHeaderPreview({ mode }: { mode: string }) {
  const [dashboard, setDashboard] = useState<DashboardSummary>({ id: 'fixture-report-header', slug: 'fixture-report-header', name: 'International subscription entitlement reconciliation — weekly operating review', pinned: false, position: 0 })
  const [calls, setCalls] = useState<string[]>([])
  const [navigation, setNavigation] = useState('No navigation')
  const [refreshes, setRefreshes] = useState(0)
  const [bodyActions, setBodyActions] = useState(0)
  const [responseShape, setResponseShape] = useState('normal')
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const actions = useMemo<ReportHeaderActions>(() => {
    const request = async (label: string) => {
      setCalls(rows => [...rows, label]);
      await new Promise(resolve => setTimeout(resolve, 700));
      if (mode === 'throw') throw new Error('Sample transport failure');
      return mode !== 'failure';
    };
    const failed = { ok: false as const, reason: 'error' as const, message: 'Sample permission failure. The report is unchanged.' };
    const malformed = { ok: 'yes' } as unknown as ActionResult;
    return {
      pin: async (id, pinned) => { if (!await request('pin')) return failed; if (responseShape === 'malformed') return malformed; setDashboard(d => d.id === id ? { ...d, pinned } : d); return { ok: true, data: undefined }; },
      rename: async (id, name) => { if (!await request('rename')) return failed; if (responseShape === 'malformed') return malformed; setDashboard(d => d.id === id ? { ...d, name } : d); return { ok: true, data: undefined }; },
      remove: async () => { if (!await request('delete')) return failed; if (responseShape === 'malformed') return malformed; return { ok: true, data: undefined }; },
      refresh: () => { if (responseShape === 'refresh-error') throw new Error('Sample view refresh failed'); setRefreshes(n => n + 1) },
      navigate: href => { if (responseShape === 'navigate-error') throw new Error('Sample navigation failed'); setNavigation(href) },
    };
  }, [mode, responseShape]);
  return <div data-header-ready={ready}>
    <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)' }}>All report actions resolve locally. No real report is renamed, pinned or deleted.</p>
    <DashboardHeader dashboard={dashboard} actions={actions}>
      <button className="dx-btn-ghost" type="button" data-header-body-action onClick={() => setBodyActions(n => n + 1)}>Sample report body action</button>
    </DashboardHeader>
    <p data-header-body-count>{bodyActions}</p>
    <p data-header-calls style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{calls.join(', ') || 'No sample requests'}</p>
    <p data-header-navigation style={{ fontSize: 12 }}>{navigation} · Refreshes: {refreshes}</p>
    <label className={s.fixtureControls}>Sample management response <select data-management-response value={responseShape} onChange={event => setResponseShape(event.target.value)}>
      <option value="normal">Normal</option><option value="malformed">Malformed acknowledgement</option>
      <option value="refresh-error">Refresh fails after acknowledgement</option><option value="navigate-error">Navigation fails after acknowledgement</option>
    </select></label>
    <button className="dx-btn-ghost" type="button" onClick={() => setDashboard({ id: 'fixture-replacement', slug: 'fixture-replacement', name: 'Replacement report', pinned: false, position: 0 })}>Replace sample report</button>
  </div>;
}
