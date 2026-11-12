'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MonitorsManager, type MonitorActions } from '@/app/app/monitors/MonitorsManager'
import type { AlertSummary } from '@/lib/alerts/server'
import { OAuthReturnFeedback } from '@/components/feedback/OAuthReturnFeedback'
import type { MonitorDraft } from '@/lib/alerts/draft'

/** 90 days of synthetic daily signups ending YESTERDAY (weekly rhythm, slow growth, two dips). */
function fixtureDraft(): MonitorDraft {
  const rows: Record<string, unknown>[] = []
  const today = new Date()
  for (let i = 90; i >= 1; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const weekday = d.getUTCDay()
    const trend = 38 + (90 - i) * 0.12
    const weekly = weekday === 0 || weekday === 6 ? -7 : 2
    const noise = ((i * 37) % 11) - 5
    const dip = i === 41 || i === 40 ? -24 : i === 12 ? -21 : 0
    rows.push({ day: d.toISOString().slice(0, 10), signups: Math.max(0, Math.round(trend + weekly + noise + dip)) })
  }
  return {
    name: '일일 가입자 수',
    goal: '일일 가입이 꺾이면 알려줘',
    metricSql:
      "with days as (select generate_series(current_date - 90, current_date - 1, interval '1 day')::date as day)\nselect d.day, count(p.id) as signups\nfrom days d left join profiles p on p.created_at >= d.day and p.created_at < d.day + 1\ngroup by d.day order by d.day",
    condition: { v: 1, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 },
    rationale: 'profiles 테이블의 일별 신규 가입 수를 봅니다. 가입은 요일마다 출렁이므로 고정 숫자 대신 최근 4주의 평소 범위에서 크게 떨어질 때만 알립니다.',
    format: { kind: 'number', unit: '명' },
    sample: { columns: ['day', 'signups'], rows },
  }
}

const base: AlertSummary = {
  id: 'fixture-healthy', orgId: 'fixture-org', dataSourceId: 'fixture-source', dataSourceName: 'Northstar / production',
  name: 'Paid without access', description: 'Completed payments without an active entitlement. Internal test accounts are excluded.',
  type: 'threshold', operator: 'gte', threshold: 1, metricSql: 'SELECT 0::numeric AS value', sensitivity: null, goal: null, condition: null,
  fireThreshold: 2, cooldownSeconds: 3600, enabled: true, status: 'normal', lastValue: 0,
  lastCheckedAt: '2026-09-06T06:00:00Z', lastError: null, lastNotifiedAt: null,
  createdAt: '2026-08-15T06:00:00Z', explanation: null, lastFiredAt: null,
}
const samples: Record<string, AlertSummary> = {
  healthy: base,
  incident: { ...base, id: 'fixture-incident', name: 'International subscription entitlement processing — delayed provisioning', status: 'firing', lastValue: 3, lastFiredAt: '2026-09-06T06:00:00Z', explanation: 'Sample hypothesis: provisioning retries stalled after the 06:00 deploy, so paid checkouts are not getting entitlements. Let me summarize the findings:\n\n**Likely cause: the entitlement worker stopped draining its retry queue.**\n\nIn the sample, 3 of 41 checkouts since 06:00 (7.3%) have no matching entitlement, against 0 in the prior 7 days. All 3 went through the international price IDs; domestic checkouts are unaffected.\n\nThe query alone does not establish a cause — check the worker logs for the retry queue before acting.' },
  error: { ...base, id: 'fixture-error', name: 'Paid job failure rate', type: 'anomaly', sensitivity: 3, lastValue: 17, lastError: 'Sample: statement timeout while checking international_subscription_entitlements' },
  paused: { ...base, id: 'fixture-paused', name: 'Refund reconciliation', enabled: false, lastValue: 23 },
  pending: { ...base, id: 'fixture-pending', name: 'First evaluation pending', lastCheckedAt: null, lastValue: null },
  goalAnomaly: { ...base, id: 'fixture-goal', name: 'Daily signups', type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 3, lastValue: 47,
    goal: 'Tell me when daily signups dip', description: 'Daily new rows in profiles, judged against the last four weeks.',
    condition: { v: 1, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 } },
  goalRelative: { ...base, id: 'fixture-goal-rel', name: 'Daily revenue', type: 'change_rate', operator: 'lt', threshold: 0, lastValue: 1830000,
    goal: 'Tell me when revenue is 30% below last week’s average', description: null,
    condition: { v: 1, strategy: 'relative', direction: 'down', pct: 0.3, window: 7 } },
}

/** Every action resolves locally after a short delay. No query or server action is invoked. */
export function MonitorManagerPreview({ mode, outcome, viewer }: { mode: string; outcome: string; viewer: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const [draft] = useState(() => (mode === 'goal' ? { runId: 'fixture-run', dataSourceId: 'fixture-source', draft: fixtureDraft() } : null))
  const [alerts, setAlerts] = useState<AlertSummary[]>(() => ['reconnect', 'reauthorized'].includes(mode)
    ? ['트라이얼 → Pro 전환율', '현재 활성 트라이얼 사용자 (잠재 매출 파이프라인)', '활성 Pro 구독자 수', '유료 전환율 (가입 → Pro)'].map((name, index) => ({
      ...base, id: `fixture-reconnect-${index}`, name, description: null, operator: 'lt', threshold: index === 2 ? 10 : 1,
      lastValue: [0.82, 0, 8, 0.64][index], lastError: 'reconnect_required',
      connectionId: '00000000-0000-4000-8000-000000000001',
      ...(mode === 'reauthorized' ? { connectionStatus: 'active', connectionRefreshedAt: '2026-09-08T08:00:00Z' } : {}),
    }))
    : mode === 'mixed' ? Object.values(samples) : ['empty', 'no-source', 'goal', 'goal-composer'].includes(mode) ? [] : [samples[mode]])
  const [calls, setCalls] = useState<string[]>([])
  const [refreshes, setRefreshes] = useState(0)
  const historyAttempts = useRef(0)
  const created = useRef(0)
  const actions = useMemo<MonitorActions>(() => {
    const wait = async (label: string) => {
      setCalls(items => [...items, label])
      await new Promise(resolve => setTimeout(resolve, 900))
      if (outcome === 'throw') throw new Error('Sample transport failure')
    }
    const fail = { ok: false as const, reason: 'error' as const, message: 'Sample request failed. Stored state is unchanged.' }
    return {
      verifyRecovery: async id => {
        await wait(`recovery:${id}`)
        if (outcome === 'failure' || (outcome === 'partial' && id.endsWith('1'))) return { ok: false, reason: 'authorization' }
        if (outcome === 'malformed') return { ok: true } as never
        return { ok: true, checkedAt: new Date().toISOString(), value: 2, conditionMet: id.endsWith('2') }
      },
      create: async input => {
        await wait('create')
        if (outcome === 'failure') return fail
        const id = `fixture-created-${++created.current}`
        setAlerts(items => [...items, { ...base, ...input, id, type: input.condition ? (input.condition.strategy === 'anomaly' ? 'anomaly' : input.condition.strategy === 'relative' ? 'change_rate' : 'threshold') : input.type ?? 'threshold', goal: input.goal ?? null, condition: input.condition ?? null, description: input.description ?? null, lastCheckedAt: null, lastValue: null }])
        return { ok: true, data: { id } }
      },
      update: async (id, patch) => {
        await wait('update')
        if (outcome === 'failure') return fail
        setAlerts(items => items.map(a => a.id === id ? { ...a, ...patch } : a))
        return { ok: true, data: undefined }
      },
      toggle: async (id, enabled) => {
        await wait('toggle')
        if (outcome === 'failure') return fail
        setAlerts(items => items.map(a => a.id === id ? { ...a, enabled } : a))
        return { ok: true, data: undefined }
      },
      bulk: async (ids, enabled) => {
        await wait('bulk')
        if (outcome === 'failure') return fail
        setAlerts(items => items.map(a => ids.includes(a.id) ? { ...a, enabled } : a))
        return { ok: true, data: { changed: ids.length } }
      },
      remove: async id => {
        await wait('delete')
        if (outcome === 'failure') return fail
        setAlerts(items => items.filter(a => a.id !== id))
        return { ok: true, data: undefined }
      },
      test: async () => {
        await wait('test')
        if (outcome === 'failure') return fail
        return { ok: true, data: { value: 3, met: true, detail: 'Sample value 3 ≥ 1; no production query was run' } }
      },
      history: async () => {
        await wait('history')
        if (outcome === 'failure' || (outcome === 'history-error' && historyAttempts.current++ === 0)) return fail
        return { ok: true, data: outcome === 'history-empty' ? [] : [
          { id: 'sample-resolved', kind: 'resolved', value: 0, createdAt: '2026-09-06T06:10:00Z', message: 'No missing entitlement in the sample.', explanation: null, notified: false },
          { id: 'sample-fired', kind: 'fired', value: 3, createdAt: '2026-09-06T06:00:00Z', message: 'Three sample payments have no matching entitlement.', explanation: 'Sample hypothesis: provisioning retries stalled after the 06:00 deploy, so paid checkouts are not getting entitlements. Let me summarize the findings:\n\n**Likely cause: the entitlement worker stopped draining its retry queue.**\n\nIn the sample, 3 of 41 checkouts since 06:00 (7.3%) have no matching entitlement, against 0 in the prior 7 days. All 3 went through the international price IDs; domestic checkouts are unaffected.\n\nThe query alone does not establish a cause — check the worker logs for the retry queue before acting.', notified: false },
        ] }
      },
      loadDraft: async () => ({ ok: false as const, reason: 'not_found' as const }),
      refresh: () => setRefreshes(n => n + 1),
    }
  }, [outcome])
  return <main style={{ maxWidth: 1520, padding: '32px 20px', margin: '0 auto' }}>
    <OAuthReturnFeedback />
    <aside data-fixture-ready={ready} style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24, lineHeight: 1.6 }}>
      DESIGN FIXTURE · Local sample data and simulated actions only. No query, monitor, notification or server action is sent.
      <p data-fixture-calls>{calls.join(', ') || 'No sample requests'} · Local refreshes: {refreshes}</p>
    </aside>
    <MonitorsManager alerts={alerts} dataSources={mode === 'no-source' ? [] : [{ id: 'fixture-source', name: 'Northstar / international-subscription-entitlement-production' }]}
      canManage={!viewer} canConfigure={!viewer} targets={{ slackChannel: 'international-business-monitoring', slackWebhook: false, discord: false, emailCount: 2 }}
      checkIntervalSec={7200} timezone="Asia/Seoul" actions={actions}
      initialDraft={draft} initialGoal={mode === 'goal-composer' ? { goal: '', sourceId: null } : null} />
  </main>
}
