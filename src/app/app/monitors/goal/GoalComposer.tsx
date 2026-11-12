'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRealtimeRunWithStreams } from '@trigger.dev/react-hooks'

import type { MonitorCondition } from '@/lib/alerts/condition'
import type { MonitorDraft } from '@/lib/alerts/draft'
import type { createAlert, loadMonitorDraft } from '@/lib/alerts/actions'
import type { DataSourceOption } from '@/lib/alerts/server'
import { parseAnalysisStart } from '@/components/agent/analysis-start'
import { Select } from '@/components/ui/Select'
import { draftStage, finalText, latestDraft, type DraftChunk, type DraftStage } from './draft-view'
import { DraftCard } from './DraftCard'
import { isCloud } from '@/config/edition'
import s from './goal.module.css'

type Phase = 'streaming' | 'done' | 'error'
type StartedRun =
  | { mode: 'trigger'; runId: string; triggerRunId: string; publicToken: string }
  | { mode: 'local'; runId: string }

type State =
  | { kind: 'idle'; error?: string; quota?: boolean }
  | { kind: 'starting' }
  | { kind: 'working'; run: StartedRun; chunks: DraftChunk[]; phase: Phase }
  | { kind: 'review'; runId: string | null; draft: MonitorDraft }
  | { kind: 'finishing'; runId: string; text: string }
  | { kind: 'failed'; text: string }

const TERMINAL: Record<string, Phase> = {
  COMPLETED: 'done',
  FAILED: 'error',
  CANCELED: 'error',
  TIMED_OUT: 'error',
  CRASHED: 'error',
  SYSTEM_FAILURE: 'error',
  EXPIRED: 'error',
}

const STEPS: DraftStage[] = ['schema', 'query', 'propose']

/**
 * "What should we watch?" — the default way to create a monitor. The goal goes to the analysis
 * agent in drafting mode (POST /api/agent/analyze, intent 'monitor': same quota gate + task as a
 * question), the draft streams back, and the operator approves it on the DraftCard. Nothing is
 * created until they do.
 */
export function GoalComposer({
  dataSources,
  timezone,
  initialGoal = '',
  initialSourceId,
  initialDraft = null,
  create,
  loadDraft,
  onCreated,
  onClose,
}: {
  dataSources: DataSourceOption[]
  timezone: string
  initialGoal?: string
  initialSourceId?: string | null
  /** a persisted draft (/app/monitors?draft=<runId>) — opens straight on the approval card */
  initialDraft?: { runId: string; dataSourceId: string; draft: MonitorDraft } | null
  create: typeof createAlert
  /** persisted-draft fallback for a stream that ended before the draft chunk arrived */
  loadDraft: typeof loadMonitorDraft
  onCreated: (name: string) => void
  onClose: () => void
}) {
  const t = useTranslations('appMonitors.goal')
  const [goal, setGoal] = useState(initialDraft?.draft.goal ?? initialGoal)
  const [dsId, setDsId] = useState(
    initialDraft?.dataSourceId ??
      (initialSourceId && dataSources.some((d) => d.id === initialSourceId) ? initialSourceId : dataSources[0]?.id ?? ''),
  )
  const [state, setState] = useState<State>(
    initialDraft ? { kind: 'review', runId: initialDraft.runId, draft: initialDraft.draft } : { kind: 'idle' },
  )
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (!initialDraft) inputRef.current?.focus()
  }, [initialDraft])

  const sourceName = dataSources.find((d) => d.id === dsId)?.name ?? null

  async function start(text: string) {
    const g = text.trim()
    if (!g || !dsId || state.kind === 'starting' || state.kind === 'working') return
    setState({ kind: 'starting' })
    setCreateError(null)
    try {
      const res = await fetch('/api/agent/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataSourceId: dsId, question: g, intent: 'monitor' }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status === 402 || data.error === 'quota_exceeded') {
        setState({ kind: 'idle', quota: true })
        return
      }
      if (!res.ok) {
        const code = typeof data.error === 'string' ? data.error : ''
        const known = ['sql_only', 'duplicate_run', 'goal_too_long', 'forbidden'].includes(code)
        setState({ kind: 'idle', error: t(`errors.${known ? code : 'generic'}`) })
        return
      }
      const started = parseAnalysisStart(data, dsId, [])
      if (!started) {
        setState({ kind: 'idle', error: t('errors.generic') })
        return
      }
      const run: StartedRun =
        started.run.mode === 'trigger'
          ? { mode: 'trigger', runId: started.runId, triggerRunId: started.run.triggerRunId, publicToken: started.run.publicToken }
          : { mode: 'local', runId: started.runId }
      setState({ kind: 'working', run, chunks: [], phase: 'streaming' })
    } catch {
      setState({ kind: 'idle', error: t('errors.generic') })
    }
  }

  // the stream subscriber reports every update here; the run's end decides the next screen
  function onStream(chunks: DraftChunk[], phase: Phase) {
    setState((cur) => {
      if (cur.kind !== 'working') return cur
      if (phase === 'streaming') return { ...cur, chunks, phase }
      const draft = latestDraft(chunks)
      if (draft) return { kind: 'review', runId: cur.run.runId, draft }
      // the run can report COMPLETED before its last stream chunks land — the draft is persisted
      // on the run row by then, so read it back before calling the attempt a failure
      return { kind: 'finishing', runId: cur.run.runId, text: finalText(chunks) }
    })
  }
  useEffect(() => {
    if (state.kind !== 'finishing') return
    let live = true
    const { runId, text } = state
    void loadDraft(runId)
      .then((res) => {
        if (!live) return
        setState(res.ok ? { kind: 'review', runId, draft: res.data.draft } : { kind: 'failed', text })
      })
      .catch(() => live && setState({ kind: 'failed', text }))
    return () => {
      live = false
    }
  }, [state, loadDraft])

  async function cancel() {
    if (state.kind !== 'working') return
    const runId = state.run.runId
    setState({ kind: 'idle' })
    try {
      await fetch(`/api/agent/runs/${runId}/cancel`, { method: 'POST' })
    } catch {
      /* best-effort — the run row is reaped either way */
    }
  }

  function approve(args: { name: string; condition: MonitorCondition }) {
    if (state.kind !== 'review' || creating) return
    const draft = state.draft
    setCreating(true)
    setCreateError(null)
    void (async () => {
      try {
        const res = await create({
          name: args.name,
          dataSourceId: dsId,
          metricSql: draft.metricSql,
          goal: draft.goal,
          condition: args.condition,
          description: draft.rationale,
        })
        if (res.ok) onCreated(args.name)
        else setCreateError(res.message ?? t('errors.createFailed'))
      } catch {
        setCreateError(t('errors.createFailed'))
      } finally {
        setCreating(false)
      }
    })()
  }

  const working = state.kind === 'working' ? state : null
  const stage = working ? draftStage(working.chunks) : 'start'

  return (
    <section className={`dx-card ${s.composer}`} aria-label={t('title')} data-goal-composer>
      <div className={s.head}>
        <div>
          <h2 className="dx-card-title">{t('title')}</h2>
          {state.kind === 'idle' || state.kind === 'starting' ? <p className={s.lead}>{t('lead')}</p> : null}
        </div>
        <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => (working ? void cancel().then(onClose) : onClose())}>
          {t('close')}
        </button>
      </div>

      <div className={s.body}>
        {(state.kind === 'idle' || state.kind === 'starting') && (
          <form
            className={s.working}
            onSubmit={(e) => {
              e.preventDefault()
              void start(goal)
            }}
          >
            <div className={s.goalRow}>
              <textarea
                ref={inputRef}
                className={s.goalInput}
                rows={1}
                maxLength={500}
                value={goal}
                placeholder={t('placeholder')}
                aria-label={t('title')}
                disabled={state.kind === 'starting'}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault()
                    void start(goal)
                  }
                }}
              />
              <Select block value={dsId} onValueChange={setDsId} disabled={state.kind === 'starting'} ariaLabel={t('sourceLabel')}
                options={dataSources.map((d) => ({ value: d.id, label: d.name }))} />
            </div>
            <div className={s.examples}>
              <span>{t('examplesLabel')}</span>
              {(['ex1', 'ex2', 'ex3'] as const).map((k) => (
                <button key={k} type="button" className={s.chip} disabled={state.kind === 'starting'} onClick={() => setGoal(t(k))}>
                  {t(k)}
                </button>
              ))}
            </div>
            {state.kind === 'idle' && state.error && <p role="alert" className={s.error}>{state.error}</p>}
            {state.kind === 'idle' && state.quota && (
              <p role="alert" className={s.error}>
                {t('quota')}{' '}
                <Link href="/app/settings/billing" className={s.link}>{t('quotaCta')}</Link>
              </p>
            )}
            <div className={s.foot}>
              <p className={s.footHint}>
                {t.rich(isCloud() ? 'footHint' : 'footHintSelf', {
                  kpi: (chunks) => <Link href="/app/sources" className={s.link}>{chunks}</Link>,
                })}
              </p>
              <button type="submit" className="dx-btn" disabled={!goal.trim() || !dsId || state.kind === 'starting'}>
                {state.kind === 'starting' ? t('starting') : t('submit')}
              </button>
            </div>
          </form>
        )}

        {state.kind === 'finishing' && <p role="status" className={s.footHint}>{t('stage.propose')}</p>}

        {working && (
          <div className={s.working} role="status" aria-live="polite">
            <p className={s.quoted}>“{goal.trim()}”</p>
            <ol className={s.steps}>
              {STEPS.map((k) => {
                const idx = STEPS.indexOf(k)
                const at = stage === 'start' ? -1 : STEPS.indexOf(stage)
                const st = idx < at ? 'done' : idx === at || (at === -1 && idx === 0) ? 'active' : 'todo'
                return (
                  <li key={k} className={s.step} data-state={st}>
                    <span className={s.stepDot} aria-hidden />
                    {t(`stage.${k}`)}
                  </li>
                )
              })}
            </ol>
            <div className={s.foot}>
              <p className={s.footHint}>{t('workingHint')}</p>
              <button type="button" className="dx-btn-ghost" onClick={() => void cancel()}>{t('cancel')}</button>
            </div>
            {working.run.mode === 'trigger' ? (
              <TriggerDraftStream runId={working.run.triggerRunId} token={working.run.publicToken} onUpdate={onStream} />
            ) : (
              <LocalDraftStream runId={working.run.runId} onUpdate={onStream} />
            )}
          </div>
        )}

        {state.kind === 'failed' && (
          <div className={s.working}>
            <p className={s.quoted}>“{goal.trim()}”</p>
            <p role="alert" className={s.error}>{t('failed')}</p>
            {state.text && <p className={s.agentText}>{state.text}</p>}
            <p className={s.footHint}>{t('failedHint')}</p>
            <div className={s.foot}>
              <span className={s.footHint} />
              <button type="button" className="dx-btn" onClick={() => setState({ kind: 'idle' })}>{t('retry')}</button>
            </div>
          </div>
        )}

        {state.kind === 'review' && (
          <>
            {createError && <p role="alert" className={s.error}>{createError}</p>}
            <DraftCard
              draft={state.draft}
              sourceName={sourceName}
              timezone={timezone}
              pending={creating}
              onCreate={approve}
              onRedraft={() => {
                setGoal(state.draft.goal)
                void start(state.draft.goal)
              }}
              onDiscard={() => setState({ kind: 'idle' })}
            />
          </>
        )}
      </div>
    </section>
  )
}

/** Trigger.dev (production): the run's Realtime stream via its run-scoped public token. */
function TriggerDraftStream({ runId, token, onUpdate }: { runId: string; token: string; onUpdate: (c: DraftChunk[], p: Phase) => void }) {
  const { run, streams, error } = useRealtimeRunWithStreams(runId, { accessToken: token, baseURL: process.env.NEXT_PUBLIC_TRIGGER_API_URL || undefined })
  const chunks = ((streams as Record<string, unknown[]> | undefined)?.agent ?? []) as DraftChunk[]
  const raw = (run as { status?: string } | undefined)?.status
  const phase: Phase = error ? 'error' : raw ? TERMINAL[raw] ?? 'streaming' : 'streaming'
  const update = useRef(onUpdate)
  update.current = onUpdate
  useEffect(() => {
    update.current(chunks, phase)
  }, [chunks.length, phase]) // eslint-disable-line react-hooks/exhaustive-deps -- chunks only grow
  return null
}

/** Local dev (no Trigger.dev): the inline SSE run endpoint. */
function LocalDraftStream({ runId, onUpdate }: { runId: string; onUpdate: (c: DraftChunk[], p: Phase) => void }) {
  const update = useRef(onUpdate)
  update.current = onUpdate
  useEffect(() => {
    const chunks: DraftChunk[] = []
    let phase: Phase = 'streaming'
    const es = new EventSource(`/api/agent/runs/${runId}/stream`)
    es.onmessage = (e) => {
      let c: DraftChunk
      try {
        c = JSON.parse(e.data) as DraftChunk
      } catch {
        return
      }
      chunks.push(c)
      if (c.type === 'status') {
        const st = (c as { status?: string }).status
        if (st === 'done') phase = 'done'
        else if (st === 'failed' || st === 'budget_exceeded') phase = 'error'
        if (phase !== 'streaming') es.close()
      }
      update.current([...chunks], phase)
    }
    es.onerror = () => {
      es.close()
      if (phase === 'streaming') {
        phase = 'error'
        update.current([...chunks], phase)
      }
    }
    return () => es.close()
  }, [runId])
  return null
}
