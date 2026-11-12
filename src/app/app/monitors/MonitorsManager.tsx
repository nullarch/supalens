'use client'

import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

import {
  createAlert, toggleAlert, toggleAlertsBulk, deleteAlert, updateAlert, testAlert, listAlertEvents, loadMonitorDraft,
  type AlertOp, type AlertEventRow,
} from '@/lib/alerts/actions'
import { conditionViewOf, type MonitorCondition } from '@/lib/alerts/condition'
import { conditionShort } from '@/lib/alerts/condition-label'
import type { MonitorDraft } from '@/lib/alerts/draft'
import { GoalComposer } from './goal/GoalComposer'
import { ConditionControls } from './goal/ConditionControls'
import type { AlertSummary, DataSourceOption, NotificationTargets } from '@/lib/alerts/server'
import { nextCheckAt, cadenceParts } from '@/lib/alerts/health'
import { monitorDisplayHealth, monitorSummary, type DisplayHealth } from './presentation'
import { OPERATOR_SYMBOL, expectedRangeLabel } from '@/lib/alerts/evaluate'
import { formatInOrgTz } from '@/lib/org/timezone'
import { PageHead } from '@/components/dashboard/PageHead'
import { Select } from '@/components/ui/Select'
import { BaseModal, ModalButton } from '@/components/modals'
import { isCloud } from '@/config/edition'
import s from './monitors.module.css'
import { isConnectionErrorCode } from '@/lib/supabase-oauth/errors'
import { isLabelledAlertErrorCode, truncateError } from './last-error'
import { RowActionsMenu } from './RowActionsMenu'
import { ExplanationDisclosure } from './ExplanationDisclosure'
import { RecoveryGuide } from '@/components/feedback/RecoveryGuide'
import { authorizationAwaitingCheck, type RecoveryCheckResult } from '@/lib/alerts/recovery'

const OPS: AlertOp[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq']
const FILTERS = ['all', 'healthy', 'incident', 'error', 'pending', 'paused'] as const
type Filter = (typeof FILTERS)[number]

const DOT: Record<DisplayHealth, string> = {
  healthy: 'dx-dot-ok',
  incident: 'dx-dot-attention',
  error: 'dx-dot-warning',
  paused: 'dx-dot-idle',
  pending: 'dx-dot-idle',
}

/** Local previews can replace all IO; production retains the same role-gated server actions. */
export interface MonitorActions {
  create: typeof createAlert
  toggle: typeof toggleAlert
  bulk: typeof toggleAlertsBulk
  remove: typeof deleteAlert
  update: typeof updateAlert
  test: typeof testAlert
  history: typeof listAlertEvents
  /** persisted goal-monitor draft (composer fallback) */
  loadDraft?: typeof loadMonitorDraft
  refresh: () => void
  verifyRecovery?: (id: string) => Promise<RecoveryCheckResult>
}

function fmt(n: number | null, intlLocale: string): string {
  return n === null ? '—' : new Intl.NumberFormat(intlLocale).format(n)
}

/** Compact table stamp in the ORG's zone (not the viewer's, not raw UTC) — "Sep 4, 09:12". */
function stamp(iso: string | null, timezone: string, intlLocale: string): string {
  return formatInOrgTz(iso, timezone, intlLocale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Human "Slack #alerts · Email (2)" line for the org's destinations (same for every monitor). */
function useDestinationLabel(targets: NotificationTargets): string {
  const t = useTranslations('appMonitors')
  const parts: string[] = []
  if (targets.slackChannel) parts.push(t('dest.slack', { name: targets.slackChannel }))
  else if (targets.slackWebhook) parts.push(t('dest.slackWebhook'))
  if (targets.discord) parts.push(t('dest.discord'))
  if (targets.emailCount > 0) parts.push(t('dest.email', { count: targets.emailCount }))
  return parts.length > 0 ? parts.join(' · ') : t('row.noDestination')
}

export function MonitorsManager({
  alerts,
  dataSources,
  canManage,
  canConfigure,
  targets,
  checkIntervalSec,
  timezone,
  initialEditId = null,
  initialNew = false,
  initialFilter = null,
  initialGoal = null,
  initialDraft = null,
  actions,
}: {
  alerts: AlertSummary[]
  dataSources: DataSourceOption[]
  canManage: boolean
  canConfigure: boolean
  targets: NotificationTargets
  /** the org's effective evaluation interval (seconds) — per plan, floored to the cron period */
  checkIntervalSec: number
  /** the org's declared display zone (`organizations.timezone`); every stamp below renders in it */
  timezone: string
  initialEditId?: string | null
  initialNew?: boolean
  initialFilter?: string | null
  /** open the goal composer (`?new=goal`), optionally prefilled (`&goal=…&source=…`) */
  initialGoal?: { goal: string; sourceId: string | null } | null
  /** a persisted goal-monitor draft (`?draft=<runId>`) — opens on its approval card */
  initialDraft?: { runId: string; dataSourceId: string; draft: MonitorDraft } | null
  actions?: MonitorActions
}) {
  const router = useRouter()
  const io: MonitorActions = actions ?? { create: createAlert, toggle: toggleAlert, bulk: toggleAlertsBulk, remove: deleteAlert, update: updateAlert, test: testAlert, history: listAlertEvents, loadDraft: loadMonitorDraft, refresh: router.refresh }
  const tc = useTranslations('appCondition')
  const t = useTranslations('appMonitors')
  const recoveryT = useTranslations('appRecovery')
  const locale = useLocale()
  const common = useTranslations('appCommon')
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [filter, setFilter] = useState<Filter>(
    FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : 'all',
  )
  const [showForm, setShowForm] = useState(initialNew)
  // the goal composer is the default way in; the SQL form is the advanced path
  const [goalOpen, setGoalOpen] = useState(Boolean(initialGoal || initialDraft))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButton = useRef<HTMLButtonElement | null>(null)
  const menuFromEnd = useRef(false)
  const createName = useRef<HTMLInputElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const uid = useId()
  const [deleteTarget, setDeleteTarget] = useState<AlertSummary | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // the clock the "next check" column is computed against — refreshed each minute so a page left
  // open keeps saying the right thing without a reload
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    items?.[menuFromEnd.current ? items.length - 1 : 0]?.focus()
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuOpen(false)
        menuButton.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => { if (showForm) createName.current?.focus() }, [showForm])

  const cadence = useMemo(() => {
    const p = cadenceParts(checkIntervalSec)
    return p.unit === 'hours' ? t('cadence.everyHours', { n: p.n }) : t('cadence.everyMinutes', { n: p.n })
  }, [checkIntervalSec, t])
  const destination = useDestinationLabel(targets)
  const at = (iso: string | null) => stamp(iso, timezone, intlLocale)

  /**
   * `alerts.operator` stores the FIRING condition, so printing it next to the current value states
   * a proposition that is FALSE for every healthy monitor ("5,000 < 4,000"). State the range the
   * monitor is expected to stay inside instead — same reading as /app/overview.
   */
  const expected = (a: AlertSummary) =>
    t('row.expected', { range: expectedRangeLabel(a.operator as AlertOp, fmt(a.threshold, intlLocale)) })
  /** the rule cell: goal monitors read their structured rule; legacy rows keep their wording */
  const ruleCell = (a: AlertSummary) => {
    if (a.condition) {
      const view = conditionViewOf(a)
      return view.kind === 'absolute' ? expected(a) : conditionShort(view, tc, (n) => fmt(n, intlLocale))
    }
    return a.type === 'anomaly' ? t('detail.sensitivity', { sigma: a.sensitivity ?? 3 }) : expected(a)
  }

  /** `last_error` is either a stable runner code or a raw query/driver message (kept raw: it is
   *  what makes a broken condition query debuggable). */
  function errorText(raw: string) {
    if (isConnectionErrorCode(raw)) return t('row.reconnect')
    if (isLabelledAlertErrorCode(raw)) return t(`errors.${raw}`)
    return (
      <>
        {t('errors.checkFailed')}{' '}
        <code className={s.errRaw} title={raw}>
          {truncateError(raw)}
        </code>
      </>
    )
  }

  // create-form state
  const [name, setName] = useState('')
  const [dsId, setDsId] = useState(dataSources[0]?.id ?? '')
  const [sql, setSql] = useState('')
  const [op, setOp] = useState<AlertOp>('lt')
  const [threshold, setThreshold] = useState('')
  const [alertType, setAlertType] = useState<'threshold' | 'anomaly'>('threshold')
  const [sensitivity, setSensitivity] = useState('3')
  const [sqlOpen, setSqlOpen] = useState(initialNew)
  // Prefill from an Ask answer (`?new=sql&source=&name=&sql=`) — the "turn into monitor" bridge.
  // Read here rather than in the server page so the params reach the form's own state; then
  // stripped from the URL so a refresh (or a back-nav) doesn't re-seed over the user's edits.
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const [prefilled, setPrefilled] = useState(false)
  useEffect(() => {
    const sqlParam = searchParams?.get('sql')
    const nameParam = searchParams?.get('name')
    const sourceParam = searchParams?.get('source')
    if (!sqlParam && !nameParam && !sourceParam) return
    if (sqlParam) {
      setSql(sqlParam)
      setSqlOpen(true)
    }
    if (nameParam) setName(nameParam)
    if (sourceParam && dataSources.some((d) => d.id === sourceParam)) setDsId(sourceParam)
    setShowForm(true)
    setPrefilled(true)
    const keep = new URLSearchParams(searchParams?.toString() ?? '')
    for (const k of ['sql', 'name', 'source', 'new']) keep.delete(k)
    const qs = keep.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from the landing URL only
  }, [])

  // per-row edit + event-history state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', description: '', sql: '', op: 'lt' as AlertOp, threshold: '', sensitivity: '3' })
  const [editCondition, setEditCondition] = useState<MonitorCondition | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [events, setEvents] = useState<Record<string, AlertEventRow[] | 'loading' | 'error'>>({})
  useEffect(() => {
    if (!pending && restoreFocus.current?.isConnected) {
      restoreFocus.current.focus()
      restoreFocus.current = null
    }
  }, [pending, editingId, showForm])

  function openEdit(a: AlertSummary) {
    if (pending || !canManage) return
    setHistoryId(null)
    setEditingId(a.id)
    setEdit({
      name: a.name,
      description: a.description ?? '',
      sql: a.metricSql,
      op: (OPS.includes(a.operator as AlertOp) ? a.operator : 'gt') as AlertOp,
      threshold: String(a.threshold),
      sensitivity: String(a.sensitivity ?? 3),
    })
    setEditCondition(a.condition)
  }
  function closeEdit(id: string) {
    restoreFocus.current = document.getElementById(`${uid}-${id}-edit`)
    setEditingId(null)
  }
  // deep link from the detail page: /app/monitors?edit=<id> opens that row's inline editor
  useEffect(() => {
    if (!initialEditId || !canManage) return
    const a = alerts.find((x) => x.id === initialEditId)
    if (a) openEdit(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId])

  function onSaveEdit(a: AlertSummary) {
    if (pending || !canManage) return
    if (a.condition && editCondition) {
      if (!edit.name.trim() || !edit.sql.trim()) {
        setNotice({ kind: 'err', text: t('form.fillAll') })
        return
      }
      startTransition(async () => {
        try {
          const res = await io.update(a.id, { name: edit.name, description: edit.description.trim() || null, metricSql: edit.sql, condition: editCondition })
          if (res.ok) {
            setNotice({ kind: 'ok', text: t('notice.updated') })
            closeEdit(a.id)
            io.refresh()
          } else {
            setNotice({ kind: 'err', text: res.message ?? t('notice.updateFailed') })
          }
        } catch { setNotice({ kind: 'err', text: t('notice.updateFailed') }) }
      })
      return
    }
    const isAnomaly = a.type === 'anomaly'
    const num = Number(edit.threshold)
    const sens = Number(edit.sensitivity)
    if (!edit.name.trim() || !edit.sql.trim() || (!isAnomaly && (!edit.threshold.trim() || !Number.isFinite(num))) || (isAnomaly && !(sens > 0 && Number.isFinite(sens)))) {
      setNotice({ kind: 'err', text: t('form.fillAll') })
      return
    }
    startTransition(async () => {
      try {
        const description = edit.description.trim() || null
        const res = await io.update(
          a.id,
          isAnomaly
            ? { name: edit.name, description, metricSql: edit.sql, sensitivity: sens }
            : { name: edit.name, description, metricSql: edit.sql, operator: edit.op, threshold: num },
        )
        if (res.ok) {
          setNotice({ kind: 'ok', text: t('notice.updated') })
          closeEdit(a.id)
          io.refresh()
        } else {
          setNotice({ kind: 'err', text: res.message ?? t('notice.updateFailed') })
        }
      } catch { setNotice({ kind: 'err', text: t('notice.updateFailed') }) }
    })
  }

  function onTest(a: AlertSummary) {
    if (pending || !canManage) return
    startTransition(async () => {
      try {
        const res = await io.test(a.id)
        if (res.ok) {
          setNotice({
            kind: 'ok',
            text: t('test.result', { detail: res.data.detail, outcome: res.data.met ? t('test.met') : t('test.unmet') }),
          })
        } else {
          setNotice({ kind: 'err', text: res.message ?? t('notice.testFailed') })
        }
      } catch { setNotice({ kind: 'err', text: t('notice.testFailed') }) }
    })
  }

  function onToggleHistory(a: AlertSummary) {
    if (pending) return
    setEditingId(null)
    if (historyId === a.id) {
      setHistoryId(null)
      return
    }
    setHistoryId(a.id)
    if (!events[a.id] || events[a.id] === 'error') void loadHistory(a.id)
  }

  async function loadHistory(id: string) {
    setEvents(m => ({ ...m, [id]: 'loading' }))
    try {
      const res = await io.history(id)
      setEvents(m => ({ ...m, [id]: res.ok ? res.data : 'error' }))
    } catch { setEvents(m => ({ ...m, [id]: 'error' })) }
  }

  const withHealth = useMemo(() => alerts.map((a) => ({ a, health: monitorDisplayHealth(a) })), [alerts])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: alerts.length, healthy: 0, incident: 0, error: 0, pending: 0, paused: 0 }
    for (const { health } of withHealth) c[health] += 1
    return c
  }, [withHealth, alerts.length])
  const summary = monitorSummary(counts)
  const rows = useMemo(
    () => withHealth.filter(({ health }) => filter === 'all' || health === filter),
    [withHealth, filter],
  )
  const allVisibleSelected = rows.length > 0 && rows.every(({ a }) => selected.has(a.id))

  function run(request: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    if (pending || !canManage) return
    startTransition(async () => {
      try {
        const res = await request()
        setNotice(res.ok ? { kind: 'ok', text: okText } : { kind: 'err', text: res.message ?? t('notice.requestFailed') })
        if (res.ok) io.refresh()
      } catch { setNotice({ kind: 'err', text: t('notice.requestFailed') }) }
    })
  }

  function onBulk(enabled: boolean) {
    if (pending || !canManage || selected.size === 0) return
    const ids = Array.from(selected)
    startTransition(async () => {
      try {
        const res = await io.bulk(ids, enabled)
        if (res.ok) {
          setNotice({ kind: 'ok', text: t(enabled ? 'notice.bulkResumed' : 'notice.bulkPaused', { count: res.data.changed }) })
          setSelected(new Set())
          io.refresh()
        } else {
          setNotice({ kind: 'err', text: res.message ?? t('notice.requestFailed') })
        }
      } catch { setNotice({ kind: 'err', text: t('notice.requestFailed') }) }
    })
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (pending || !canManage) return
    const isAnomaly = alertType === 'anomaly'
    const num = Number(threshold)
    const sens = Number(sensitivity)
    if (!name.trim() || !dsId || !sql.trim() || (!isAnomaly && (!threshold.trim() || !Number.isFinite(num))) || (isAnomaly && !(sens > 0 && Number.isFinite(sens)))) {
      if (!sql.trim()) setSqlOpen(true)
      setNotice({ kind: 'err', text: t('form.fillAll') })
      return
    }
    startTransition(async () => {
      try {
        const res = await io.create(
          isAnomaly
            ? { name, dataSourceId: dsId, metricSql: sql, type: 'anomaly', sensitivity: sens }
            : { name, dataSourceId: dsId, metricSql: sql, operator: op, threshold: num },
        )
        if (res.ok) {
          setNotice({ kind: 'ok', text: t('notice.created') })
          setName(''); setSql(''); setThreshold(''); setShowForm(false); setPrefilled(false)
          restoreFocus.current = menuButton.current
          io.refresh()
        } else {
          setNotice({ kind: 'err', text: res.message ?? t('notice.createFailed') })
        }
      } catch { setNotice({ kind: 'err', text: t('notice.createFailed') }) }
    })
  }

  function onDelete() {
    if (!deleteTarget || pending || !canManage) return
    const id = deleteTarget.id
    setDeleteError(null)
    startTransition(async () => {
      try {
        const res = await io.remove(id)
        if (!res.ok) { setDeleteError(res.message ?? t('notice.requestFailed')); return }
        setDeleteTarget(null)
        setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
        setNotice({ kind: 'ok', text: t('notice.deleted') })
        io.refresh()
      } catch { setDeleteError(t('notice.requestFailed')) }
    })
  }

  function nextLabel(a: AlertSummary): string {
    const next = nextCheckAt(a, checkIntervalSec, now)
    if (!next) return ''
    const mins = Math.round((next.getTime() - now) / 60_000)
    return mins <= 0 ? t('row.nextSoon') : t('row.next', { when: t('row.inMinutes', { n: mins }) })
  }


  const chrome = useTranslations('appChrome')
  const span = canManage ? 6 : 5
  const summaryTone = summary === 'incident' ? 'negative' : summary === 'error' ? 'warning' : undefined

  return (
    // A list of operational rows reads better at the overview's wide container than at the
    // 1024px reading column (the shell widens for any page that renders data-page-width="wide").
    <div className={s.manager} data-monitor-manager data-page-width="wide">
      <PageHead
        title={t('title')}
        subtitle={t(isCloud() ? 'subtitle' : 'subtitleSelf', { cadence })}
        actions={
          canManage ? (
            <div className={s.menuRoot} ref={menuRef} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false) }}>
              <span className={s.newActions}>
                <button
                  className="dx-btn-ghost"
                  ref={menuButton}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-controls={menuOpen ? `${uid}-menu` : undefined}
                  disabled={pending || dataSources.length === 0}
                  onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); menuFromEnd.current = e.key === 'ArrowUp'; setMenuOpen(true) } }}
                  onClick={() => { menuFromEnd.current = false; setMenuOpen((v) => !v) }}
                >
                  {t('newMenu.other')}
                </button>
                <button
                  className={`dx-btn ${s.newButton}`}
                  type="button"
                  disabled={pending || dataSources.length === 0}
                  onClick={() => { setShowForm(false); setGoalOpen(true) }}
                >
                  + {t('newMenu.label')}
                </button>
              </span>
              {menuOpen && (
                <div id={`${uid}-menu`} className={s.menu} role="menu" aria-label={t('newMenu.label')} onKeyDown={e => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
                  e.preventDefault()
                  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
                  const current = items.indexOf(document.activeElement as HTMLElement)
                  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  items[next]?.focus()
                }}>
                  <Link href="/app/sources" className={s.menuItem} role="menuitem" tabIndex={-1} onClick={() => setMenuOpen(false)}>
                    <span className={s.menuTitle}>{t('newMenu.fromKpi')}</span>
                    <span className={s.menuHint}>{t('newMenu.fromKpiHint')}</span>
                  </Link>
                  <Link href="/app/ask" className={s.menuItem} role="menuitem" tabIndex={-1} onClick={() => setMenuOpen(false)}>
                    <span className={s.menuTitle}>{t('newMenu.fromAsk')}</span>
                    <span className={s.menuHint}>{t('newMenu.fromAskHint')}</span>
                  </Link>
                  <button
                    type="button"
                    className={s.menuItem}
                    role="menuitem"
                    tabIndex={-1}
                    data-advanced="true"
                    onClick={() => { setMenuOpen(false); setGoalOpen(false); setShowForm(true); setSqlOpen(true) }}
                  >
                    <span className={s.menuTitle}>{t('newMenu.fromSql')}</span>
                    <span className={s.menuHint}>{t('newMenu.fromSqlHint')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      <RecoveryGuide monitors={alerts} canManage={canManage} canConfigure={canConfigure}
        verify={actions ? actions.verifyRecovery ?? (async () => ({ ok: false, reason: 'unavailable' })) : undefined} refresh={io.refresh} />

      {pending && <p role="status" className={s.processing}>{common('processing')}</p>}
      {notice && (
        <div role={notice.kind === 'err' ? 'alert' : 'status'} className={s.notice} data-kind={notice.kind}>
          {notice.text}
        </div>
      )}

      {canManage && dataSources.length === 0 && (
        <div className={`dx-card ${s.needSource}`}>
          <p className={s.needSourceText}>{t('needSource')}</p>
          <Link href="/app/sources" className="dx-btn">{chrome('nav.connections')}</Link>
        </div>
      )}

      {goalOpen && canManage && dataSources.length > 0 && (
        <GoalComposer
          dataSources={dataSources}
          timezone={timezone}
          initialGoal={initialGoal?.goal ?? ''}
          initialSourceId={initialGoal?.sourceId ?? null}
          initialDraft={initialDraft}
          create={io.create}
          loadDraft={io.loadDraft ?? loadMonitorDraft}
          onCreated={(created) => {
            setGoalOpen(false)
            setNotice({ kind: 'ok', text: t('notice.createdGoal', { name: created }) })
            restoreFocus.current = menuButton.current
            io.refresh()
          }}
          onClose={() => setGoalOpen(false)}
        />
      )}

      {showForm && canManage && (
        <section className={`dx-card ${s.createCard}`} aria-label={t('form.title')}>
          <div className={s.createHead}>
            <h2 className="dx-card-title">{t('form.title')}</h2>
            <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.small}`} disabled={pending} onClick={() => { setShowForm(false); menuButton.current?.focus() }}>{t('btn.cancel')}</button>
          </div>
          <form onSubmit={onCreate} className={s.createBody}>
            <fieldset className={s.fields} disabled={pending} aria-busy={pending}>
              {prefilled && <p className={s.formNote}>{t('form.prefilled')}</p>}
              <div className={s.fieldGrid}>
                <label className={s.field}>
                  <span className="dx-label">{t('edit.namePlaceholder')}</span>
                  <input ref={createName} className={s.input} placeholder={t('form.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div className={s.field}>
                  <span className="dx-label">{t('detail.source')}</span>
                  <Select block value={dsId} onValueChange={setDsId} disabled={pending} ariaLabel={t('detail.source')}
                    options={dataSources.map((d) => ({ value: d.id, label: d.name }))} />
                </div>
              </div>
              <div className={s.condition}>
                <div className={`dx-segmented ${s.segmented}`} role="group" aria-label={t('form.typeAria')}>
                  <button type="button" aria-pressed={alertType === 'threshold'} onClick={() => setAlertType('threshold')}>{t('form.threshold')}</button>
                  <button type="button" aria-pressed={alertType === 'anomaly'} onClick={() => setAlertType('anomaly')}>{t('form.anomaly')}</button>
                </div>
                {alertType === 'anomaly' ? (
                  <div className={s.sentence}>
                    <span>{t('form.vsNormal')}</span>
                    <input aria-label={t('form.vsNormal')} className={`${s.input} ${s.inputSigma}`} inputMode="decimal" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} />
                    <span>{t('form.sigmaHint')}</span>
                  </div>
                ) : (
                  <div className={s.sentence}>
                    <span>{t('form.resultIs')}</span>
                    <Select value={op} onValueChange={(v) => setOp(v as AlertOp)} disabled={pending} ariaLabel={t('form.resultIs')}
                      options={OPS.map((o) => ({ value: o, label: OPERATOR_SYMBOL[o] }))} />
                    <input aria-label={t('form.thresholdPlaceholder')} className={`${s.input} ${s.inputThreshold}`} placeholder={t('form.thresholdPlaceholder')} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                    <span>{t('form.thenAlert')}</span>
                  </div>
                )}
              </div>
              <details className={s.details} open={sqlOpen} onToggle={(e) => setSqlOpen((e.target as HTMLDetailsElement).open)}>
                <summary className={s.summary}>{t('form.sqlSummary')}</summary>
                <textarea
                  aria-label={t('form.sqlSummary')}
                  className={`${s.input} ${s.sql}`}
                  placeholder={alertType === 'anomaly' ? t('form.sqlPlaceholderAnomaly') : t('form.sqlPlaceholderThreshold')}
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                />
              </details>
              <div className={s.formFoot}>
                <p className={s.formHint}>
                  {t(isCloud() ? 'form.cadenceNote' : 'form.cadenceNoteSelf', { cadence })}{' '}
                  {t.rich('form.noSqlHint', {
                    a: (chunks) => (
                      <button type="button" className={`${s.inlineLink} ${s.linkButton}`} onClick={() => { setShowForm(false); setGoalOpen(true) }}>
                        {chunks}
                      </button>
                    ),
                  })}
                </p>
                <button className={`dx-btn ${s.submit}`} type="submit" disabled={pending}>{t('form.create')}</button>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      {/* One summary card, two cells: the collection state (serif figure) beside where an
          incident would land. Stacks at narrow widths. */}
      <div className={`dx-card ${s.stats}`}>
        <div className={s.stat}>
          <span className="dx-kpi-label">{t('strip.label')}</span>
          <span className={`dx-figure ${s.collection}`} data-monitor-summary={summary} data-tone={summaryTone} role="status">
            <span className={`dx-dot ${summary === 'empty' ? 'dx-dot-idle' : DOT[summary]}`} />
            {t(`collection.${summary}`, { count: summary === 'empty' ? 0 : counts[summary] })}
          </span>
        </div>
        <div className={s.stat}>
          <span className={s.statHead}>
            <span className="dx-kpi-label">{t('strip.destinations')}</span>
            {canConfigure && <Link href="/app/settings/notifications" className="dx-text-link">{t('strip.configure')} <Arrow /></Link>}
          </span>
          <span className={s.destValue}>{destination}</span>
        </div>
      </div>

      {/* filters and select-all over zero monitors are just noise ("All 0 · Healthy 0 …") */}
      {alerts.length > 0 && <div className={s.toolbar}>
        <div className={`dx-segmented ${s.segmented}`} role="group" aria-label={t('filter.aria')}>
          {FILTERS.map(f => (
            <button key={f} type="button" data-active={filter === f} aria-pressed={filter === f} disabled={pending} onClick={() => setFilter(f)}>
              {t(`filter.${f}`)}<span className={s.count} data-tone={f === 'incident' && counts[f] > 0 ? 'negative' : f === 'error' && counts[f] > 0 ? 'warning' : undefined}>{counts[f]}</span>
            </button>
          ))}
        </div>
        {canManage && (
          <div className={s.selection}>
            {selected.size > 0 && (
              <div className={s.bulk} role="toolbar">
                <span className={s.bulkCount}>{t('bulk.selected', { count: selected.size })}</span>
                <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.small}`} disabled={pending} onClick={() => onBulk(false)}>{t('bulk.pause')}</button>
                <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.small}`} disabled={pending} onClick={() => onBulk(true)}>{t('bulk.resume')}</button>
                <button type="button" className={`${s.clear} ${s.small}`} disabled={pending} onClick={() => setSelected(new Set())}>{t('bulk.clear')}</button>
              </div>
            )}
            <label className={s.selectAll}>
              <input type="checkbox" className={s.checkbox} aria-label={t('bulk.selectAll')} checked={allVisibleSelected}
                disabled={pending || rows.length === 0}
                ref={el => { if (el) el.indeterminate = !allVisibleSelected && rows.some(({ a }) => selected.has(a.id)) }}
                onChange={e => {
                  const next = new Set(selected)
                  for (const { a } of rows) {
                    if (e.target.checked) next.add(a.id)
                    else next.delete(a.id)
                  }
                  setSelected(next)
                }} />
              {t('bulk.selectAll')}
            </label>
          </div>
        )}
      </div>}

      <section className={`dx-table-shell ${s.shell}`}>
        <table className={`dx-table ${s.table}`} aria-label={t('title')} data-owner={canManage}>
          <colgroup>
            {canManage && <col className={s.checkColumn} />}
            <col />
            <col className={s.valueColumn} />
            <col className={s.scheduleColumn} />
            <col className={s.incidentColumn} />
            <col className={canManage ? s.actionsColumn : s.viewerColumn} />
          </colgroup>
          <thead>
            <tr>
              {canManage && <th className={s.check} aria-label={t('bulk.selectAll')} />}
              <th>{t('table.name')}</th>
              <th>{t('table.current')}</th>
              <th>{t('table.schedule')}</th>
              <th>{t('table.lastIncident')}</th>
              <th className={s.right}>{canManage ? t('table.manage') : t('table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className={s.emptyRow}>
                <td colSpan={span}>
                  <div className={s.empty}>
                    <p className={s.emptyText}>{alerts.length === 0 ? t('table.empty') : t('table.emptyFiltered')}</p>
                    {alerts.length === 0 && canManage && dataSources.length > 0 && (
                      <div className={s.emptyActions}>
                        <button type="button" className="dx-btn" onClick={() => { setShowForm(false); setGoalOpen(true) }}>{t('newMenu.fromGoal')}</button>
                        <Link href="/app/sources" className="dx-btn-ghost">{t('newMenu.fromKpi')}</Link>
                      </div>
                    )}
                    {alerts.length > 0 && (
                      <div className={s.emptyActions}>
                        <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => setFilter('all')}>{t('filter.all')}</button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ) : rows.map(({ a, health }) => {
              const healthLabel = t(`health.${health}`)
              const typeLabel = t(`type.${a.type === 'anomaly' ? 'anomaly' : a.type === 'change_rate' ? 'change_rate' : 'threshold'}`)
              const unknown = Boolean(a.lastError || !a.enabled || a.lastValue === null)
              const next = a.enabled ? nextLabel(a) : ''
              return (
                <Fragment key={a.id}>
                <tr className={s.monitorRow} data-owner={canManage} data-monitor-id={a.id} data-selected={selected.has(a.id)} data-health={health}>
                  {canManage && (
                    <td className={s.check}>
                      <input
                        type="checkbox"
                        className={s.checkbox}
                        aria-label={t('bulk.selectOne', { name: a.name })}
                        checked={selected.has(a.id)}
                        disabled={pending}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(a.id)
                          else next.delete(a.id)
                          setSelected(next)
                        }}
                      />
                    </td>
                  )}
                  <td className={s.nameCell}>
                    <Link href={`/app/monitors/${a.id}`} className={s.nameMain}>
                      {a.name}
                    </Link>
                    <span className={s.nameMeta}>
                      <span className={s.health} data-health={health}><span className={`dx-dot ${DOT[health]}`} aria-hidden />{healthLabel}</span>
                      <span className={s.typeLabel}>{typeLabel}</span>
                    </span>
                    {a.goal && !a.lastError && <span className={s.nameGoal}>{t('row.goal', { goal: a.goal })}</span>}
                    {(a.lastError || (a.description && !a.goal)) && <span className={s.nameSub} data-error={Boolean(a.lastError)}>
                      {authorizationAwaitingCheck(a) ? recoveryT('authorizationSaved') : isConnectionErrorCode(a.lastError) ? t('connection.rowLabel') : a.lastError ? errorText(a.lastError) : a.description}
                    </span>}
                  </td>
                  <td className={s.valueCell} data-label={t('table.current')}>
                    <span className={s.currentValue} data-current-value data-unknown={unknown}>
                      {a.lastError || !a.enabled ? '—' : fmt(a.lastValue, intlLocale)}
                    </span>
                    <span className={s.expectedValue}>{ruleCell(a)}</span>
                    {(a.lastError || !a.enabled) && a.lastValue !== null && <span className={s.recorded}>{t('detail.lastRecorded')} · {fmt(a.lastValue, intlLocale)}</span>}
                  </td>
                  <td className={s.scheduleCell} data-label={t('table.schedule')}>
                    {/* the cadence is org-wide (stated in the page subtitle), so rows only carry
                        what differs per monitor: the next check and the last one */}
                    {next && <span className={s.cadence}>{next}</span>}
                    <span className={s.checked}>{t('table.lastChecked')} · {a.lastCheckedAt ? <time className={s.time} dateTime={a.lastCheckedAt}>{at(a.lastCheckedAt)}</time> : t('row.never')}</span>
                  </td>
                  <td className={s.incidentCell} data-label={t('table.lastIncident')}>
                    {a.lastFiredAt ? <time className={s.time} dateTime={a.lastFiredAt}>{at(a.lastFiredAt)}</time> : <span className={s.never}>{t('row.never')}</span>}
                  </td>
                  <td className={s.right} data-label={canManage ? t('table.manage') : t('table.status')}>
                    {canManage ? (
                      <div className={s.actions}>
                        <button type="button" className={s.toggle} data-on={a.enabled} aria-pressed={a.enabled} aria-label={`${a.name} ${a.enabled ? t('row.toggleOff') : t('row.toggleOn')}`} disabled={pending} onClick={() => run(() => io.toggle(a.id, !a.enabled), a.enabled ? t('notice.disabled') : t('notice.enabled'))}><span aria-hidden /></button>
                        <button id={`${uid}-${a.id}-edit`} type="button" className={s.rowButton} disabled={pending} aria-expanded={editingId === a.id} onClick={() => (editingId === a.id ? closeEdit(a.id) : openEdit(a))}>{t('btn.edit')}</button>
                        <RowActionsMenu id={`${uid}-${a.id}-more`} label={t('btn.more', { name: a.name })} disabled={pending} items={[
                          { label: t('btn.test'), onSelect: () => onTest(a) },
                          { label: t('btn.history'), expanded: historyId === a.id, onSelect: () => onToggleHistory(a) },
                          { label: t('btn.delete'), destructive: true, onSelect: () => { setDeleteError(null); setDeleteTarget(a) } },
                        ]} />
                      </div>
                    ) : (
                      <span className={s.actions}>
                        <span className={`dx-badge ${health === 'incident' ? 'dx-badge-error' : health === 'error' ? 'dx-badge-warning' : health === 'healthy' ? 'dx-badge-success' : ''}`}>{healthLabel}</span>
                        <button type="button" className={s.rowButton} aria-expanded={historyId === a.id} onClick={() => onToggleHistory(a)}>{t('btn.history')}</button>
                      </span>
                    )}
                  </td>
                </tr>
                {editingId === a.id && canManage && (
                  <tr className={s.detailRow}>
                    <td colSpan={span}>
                      <div className={s.inlinePanel}>
                      <fieldset className={s.fields} disabled={pending} aria-busy={pending}>
                        <legend className={s.legend}>{t('btn.edit')} · {a.name}</legend>
                        <div className={s.fieldGrid}>
                          <label className={s.field}><span className="dx-label">{t('edit.namePlaceholder')}</span><input autoFocus className={s.input} value={edit.name} onChange={(e) => setEdit((v) => ({ ...v, name: e.target.value }))} placeholder={t('edit.namePlaceholder')} /></label>
                          <label className={s.field}><span className="dx-label">{t('detail.definition')}</span><input className={s.input} value={edit.description} onChange={(e) => setEdit((v) => ({ ...v, description: e.target.value }))} placeholder={t('detail.definition')} /></label>
                        </div>
                        <label className={s.field}><span className="dx-label">{t('form.sqlSummary')}</span><textarea className={`${s.input} ${s.sql}`} value={edit.sql} onChange={(e) => setEdit((v) => ({ ...v, sql: e.target.value }))} /></label>
                        <div className={s.editFoot}>
                          {a.condition && editCondition ? (
                            <ConditionControls condition={editCondition} onChange={setEditCondition} current={null} disabled={pending} />
                          ) : a.type === 'anomaly' ? (
                            <div className={s.sentence}>
                              <span>{t('form.vsNormal')}</span>
                              <input aria-label={t('form.vsNormal')} className={`${s.input} ${s.inputSigma}`} inputMode="decimal" value={edit.sensitivity} onChange={(e) => setEdit((v) => ({ ...v, sensitivity: e.target.value }))} />
                              <span>{t('form.sigmaHintShort')}</span>
                            </div>
                          ) : (
                            <div className={s.sentence}>
                              <span>{t('form.resultIs')}</span>
                              <Select size="sm" value={edit.op} onValueChange={(v) => setEdit((cur) => ({ ...cur, op: v as AlertOp }))} disabled={pending} ariaLabel={t('form.resultIs')}
                                options={OPS.map((o) => ({ value: o, label: OPERATOR_SYMBOL[o] }))} />
                              <input aria-label={t('form.thresholdPlaceholder')} className={`${s.input} ${s.inputThreshold}`} inputMode="decimal" value={edit.threshold} onChange={(e) => setEdit((v) => ({ ...v, threshold: e.target.value }))} />
                              <span>{t('form.thenAlert')}</span>
                            </div>
                          )}
                          <span className={s.editActions}>
                            <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.small}`} onClick={() => closeEdit(a.id)}>{t('btn.cancel')}</button>
                            <button type="button" className={`dx-btn dx-btn-sm ${s.small}`} disabled={pending} onClick={() => onSaveEdit(a)}>{t('cta.save')}</button>
                          </span>
                        </div>
                        <p className={s.formHint}>{t('edit.resetHint')}</p>
                      </fieldset>
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === a.id && (
                  <tr className={s.detailRow}>
                    <td colSpan={span}>
                      <section className={s.inlinePanel} aria-label={t('history.title')}>
                        <span className={`dx-label ${s.panelLabel}`}>{t('history.title')}</span>
                        {events[a.id] === 'loading' || !events[a.id] ? (
                          <p role="status" className={s.panelMuted}>{t('history.loading')}</p>
                        ) : events[a.id] === 'error' ? (
                          <div className={s.panelError}>
                            <p role="alert">{t('history.failed')}</p>
                            <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.small}`} onClick={() => void loadHistory(a.id)}>{t('history.retry')}</button>
                          </div>
                        ) : (events[a.id] as AlertEventRow[]).length === 0 ? (
                          <p className={s.panelMuted}>{t('history.empty')}</p>
                        ) : (
                          <ol className={s.history}>
                            {(events[a.id] as AlertEventRow[]).map((ev) => (
                              <li key={ev.id} className={s.historyEvent} data-kind={ev.kind}>
                                <time className={s.historyTime} dateTime={ev.createdAt}>{at(ev.createdAt)}</time>
                                <div className={s.historyBody}>
                                  <span className={`dx-badge ${ev.kind === 'fired' ? 'dx-badge-error' : 'dx-badge-success'}`}>{ev.kind === 'fired' ? t('history.fired') : t('history.resolved')}</span>
                                  {ev.message && <span className={s.historyMessage}>{ev.message}</span>}
                                  {ev.explanation && (
                                    <ExplanationDisclosure
                                      className={s.historyLikely}
                                      layout="stacked"
                                      text={ev.explanation}
                                      label={t('explanation.label')}
                                      moreLabel={t('explanation.more')}
                                      lessLabel={t('explanation.less')}
                                    />
                                  )}
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    </td>
                  </tr>
                )}
                {a.status === 'firing' && a.explanation && (
                  <tr className={s.detailRow}>
                    <td colSpan={span}>
                      <ExplanationDisclosure
                        className={`${s.inlinePanel} ${s.likely}`}
                        text={a.explanation}
                        label={t('explanation.label')}
                        moreLabel={t('explanation.more')}
                        lessLabel={t('explanation.less')}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </section>
      {deleteTarget && <BaseModal open title={t('confirm.delete', { name: deleteTarget.name })} onClose={() => { if (!pending) setDeleteTarget(null) }} closeDisabled={pending} onCloseAutoFocus={event => {
        event.preventDefault()
        const trigger = document.getElementById(`${uid}-${deleteTarget.id}-more`)
        if (trigger) trigger.focus()
        else menuButton.current?.focus()
      }} size="sm" footer={<>
        <ModalButton variant="ghost" disabled={pending} onClick={() => setDeleteTarget(null)}>{t('btn.cancel')}</ModalButton>
        <ModalButton variant="destructive" disabled={pending} onClick={onDelete}>{t('btn.delete')}</ModalButton>
      </>}>
        {deleteError && <p role="alert" className={s.modalError}>{deleteError}</p>}
        {pending && <p role="status" className={s.modalStatus}>{common('processing')}</p>}
      </BaseModal>}
    </div>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
