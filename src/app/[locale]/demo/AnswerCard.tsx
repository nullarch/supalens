'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { useRealtimeRunWithStreams } from '@trigger.dev/react-hooks'
import { ArrowUpRight, Check, CircleAlert, Clock3 } from 'lucide-react'

import type { AgentChunk, AgentPhase } from '@/components/agent/AgentView'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DEMO_CONNECT_HREF, type DemoAnswerResult } from './demo-types'
import { Prose } from './Prose'
import { SqlCode } from './SqlCode'
import s from './DemoConsole.module.css'

// Every terminal Trigger.dev run status resolves the answer (same mapping as AgentStream).
const TERMINAL: Record<string, AgentPhase> = {
  COMPLETED: 'done',
  FAILED: 'error',
  CANCELED: 'error',
  TIMED_OUT: 'error',
  CRASHED: 'error',
  SYSTEM_FAILURE: 'error',
  EXPIRED: 'error',
}

type ToolUse = Extract<AgentChunk, { type: 'tool_use' }>

function chartType(spec: unknown): string | undefined {
  const o = spec as { chart?: { type?: string }; type?: string } | null
  return o?.chart?.type ?? o?.type
}

function specSql(spec: unknown): string | null {
  const sql = (spec as { query?: { sql?: string } } | null)?.query?.sql
  return typeof sql === 'string' && sql.trim() ? sql : null
}

/** Each query once, ignoring whitespace and case (a chart's SQL often repeats a query the analyst ran). */
function uniqueSql(list: (string | null)[]): string[] {
  const seen = new Set<string>()
  return list.filter((sql): sql is string => {
    if (!sql) return false
    const key = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Streams a live demo run over Trigger.dev Realtime with its run-scoped public token. */
export function LiveAnswer({
  runId,
  accessToken,
  startedAt,
  onDone,
  onProgress,
}: {
  runId: string
  accessToken: string
  startedAt: number
  onDone: (phase: AgentPhase) => void
  onProgress: () => void
}) {
  const { run, streams, error } = useRealtimeRunWithStreams(runId, { accessToken })
  const chunks = ((streams as Record<string, unknown[]> | undefined)?.agent ?? []) as AgentChunk[]
  const raw = (run as { status?: string } | undefined)?.status
  const phase: AgentPhase = error ? 'error' : raw ? TERMINAL[raw] ?? 'streaming' : 'streaming'

  const fired = useRef(false)
  useEffect(() => {
    if (phase !== 'streaming' && !fired.current) {
      fired.current = true
      onDone(phase)
    }
  }, [phase, onDone])

  const textLength = chunks.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 0), 0)
  useEffect(() => {
    onProgress()
  }, [chunks.length, textLength, phase, onProgress])

  return <AnswerBody mode="live" chunks={chunks} phase={phase} startedAt={startedAt} />
}

type BodyProps =
  | { mode: 'live'; chunks: AgentChunk[]; phase: AgentPhase; startedAt: number }
  | { mode: 'cached'; result: DemoAnswerResult; answeredAt: string }

export function AnswerBody(props: BodyProps) {
  const t = useTranslations('demo.answer')
  const format = useFormatter()

  const live = props.mode === 'live'
  const phase: AgentPhase = live ? props.phase : 'done'
  const streaming = phase === 'streaming'

  const text = live
    ? props.chunks.filter((c): c is Extract<AgentChunk, { type: 'text' }> => c.type === 'text').map((c) => c.text).join('')
    : props.result.text ?? ''
  const specs: unknown[] = live
    ? props.chunks.filter((c): c is Extract<AgentChunk, { type: 'visualization' }> => c.type === 'visualization').map((c) => c.spec)
    : Array.isArray(props.result.visualizations)
      ? props.result.visualizations
      : []
  const tools: ToolUse[] = live ? props.chunks.filter((c): c is ToolUse => c.type === 'tool_use') : []
  const sqlRuns = tools.filter((tool) => tool.tool.includes('execute_sql'))
  const sqls = uniqueSql([
    ...sqlRuns.map((tool) => {
      const sql = (tool.input as { sql?: unknown } | null)?.sql
      return typeof sql === 'string' ? sql : null
    }),
    ...specs.map(specSql),
  ])
  const stats = specs.filter((spec) => ['kpi', 'bignumber'].includes(chartType(spec) ?? ''))
  const charts = specs.filter((spec) => !['kpi', 'bignumber'].includes(chartType(spec) ?? ''))

  // Elapsed seconds while a live run streams, frozen when it ends.
  const [now, setNow] = useState(() => Date.now())
  const [endedAt, setEndedAt] = useState<number | null>(null)
  useEffect(() => {
    if (!live) return
    if (!streaming) {
      setEndedAt((value) => value ?? Date.now())
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, streaming])
  const seconds = live ? Math.max(1, Math.round(((endedAt ?? now) - props.startedAt) / 1000)) : 0

  let status
  if (!live) {
    const answered = new Date(props.answeredAt)
    status = (
      <p className={s.answerStatus}>
        <Clock3 size={13} aria-hidden />
        {Number.isNaN(answered.getTime()) ? t('cachedUnknown') : t('cached', { time: format.relativeTime(answered, new Date()) })}
      </p>
    )
  } else if (phase === 'error') {
    status = (
      <p className={`${s.answerStatus} ${s.answerStatusError}`} role="alert">
        <CircleAlert size={13} aria-hidden />
        {t('interrupted')}
      </p>
    )
  } else {
    status = (
      <p className={s.answerStatus} role="status">
        {streaming ? <span className={s.pulse} aria-hidden /> : <Check size={13} aria-hidden />}
        {streaming ? t('live') : t('liveDone', { seconds })}
        {streaming && <span className={s.elapsed}>{seconds}s</span>}
      </p>
    )
  }

  // Live progress: schema → SQL → charts → prose, derived from the run's own chunks.
  const anyTool = tools.length > 0
  const steps = live
    ? [
        { key: 'schema', label: t('steps.schema'), done: anyTool, active: !anyTool && streaming },
        {
          key: 'sql',
          label: t('steps.sql', { count: sqlRuns.length }),
          done: sqlRuns.length > 0 && (specs.length > 0 || Boolean(text) || !streaming),
          active: anyTool && streaming && specs.length === 0 && !text,
        },
        ...(specs.length > 0 || streaming
          ? [
              {
                key: 'chart',
                label: t('steps.chart', { count: specs.length }),
                done: specs.length > 0 && (Boolean(text) || !streaming),
                active: specs.length > 0 && streaming && !text,
              },
            ]
          : []),
        {
          key: 'writing',
          label: phase === 'done' ? t('steps.written') : t('steps.writing'),
          done: phase === 'done',
          active: Boolean(text) && streaming,
        },
      ]
    : []

  return (
    <div className={s.answer}>
      {status}

      {live && (
        <ol className={`${s.steps} ${streaming ? '' : s.stepsDone}`} aria-label={t('live')}>
          {steps.map((step) => (
            <li key={step.key} data-state={step.done ? 'done' : step.active ? 'active' : 'waiting'}>
              <span className={s.stepMark} aria-hidden>
                {step.done ? <Check size={11} /> : null}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      )}

      {stats.length > 0 && (
        <div className={s.statGrid}>
          {stats.map((spec, i) => (
            <WidgetRenderer key={i} spec={spec} menu={null} />
          ))}
        </div>
      )}
      {charts.map((spec, i) => (
        <div key={i} className={s.chart}>
          <WidgetRenderer spec={spec} menu={null} />
        </div>
      ))}

      {text ? <Prose text={text} streaming={streaming} /> : phase === 'done' && <p className={s.muted}>{t('noAnswer')}</p>}

      {sqls.length > 0 && (
        <details className={s.sqlDetails}>
          <summary>{t('sql', { count: sqls.length })}</summary>
          {sqls.map((sql, i) => (
            <SqlCode key={i} sql={sql} />
          ))}
        </details>
      )}

      {phase === 'done' && specs.length > 0 && (
        <Link className={s.answerCta} href={DEMO_CONNECT_HREF}>
          {t('monitorCta')}
          <ArrowUpRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  )
}
