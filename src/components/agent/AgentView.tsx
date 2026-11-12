import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { WidgetRenderer } from '@/components/dashboard/widgets'
import type { AnalysisChunk } from '@/lib/agent/run-analysis'
import { buildMonitorHref, looksMultiColumn } from '@/lib/agent/monitor-draft'
import { AddToDashboard } from './AddToDashboard'
import s from './ask-chat.module.css'

/** The runner's chunk contract, verbatim (type-only import — erased at compile time, so no
 *  server code reaches this client bundle). Do NOT redeclare it here: a hand-maintained copy
 *  silently drifts when the runner gains a chunk variant. */
export type AgentChunk = AnalysisChunk

/** Streaming phase, derived by each transport (Trigger Realtime / local SSE) and passed down
 *  so the message can show a thinking/caret affordance without parsing localized status text. */
export type AgentPhase = 'streaming' | 'done' | 'error'

/** Presentational assistant message shared by the Trigger.dev (Realtime) and local (SSE)
 *  streamers, and reused by the code-analysis run (its chunks are a subset: text/tool_use/status).
 *  Reading order: prose first, the figures (each widget its own card), the monitor next step,
 *  then the method (raw SQL) tucked into a disclosure. `dataSourceId` threads into 위젯 추가 so a saved widget stays re-runnable. */
export function AgentView({
  chunks,
  phase = 'streaming',
  error,
  dataSourceId,
  question,
  readOnly = false,
}: {
  chunks: AgentChunk[]
  phase?: AgentPhase
  error?: string
  dataSourceId?: string | null
  /** the turn's question — becomes the draft monitor's name in the Turn-into-monitor link */
  question?: string
  /** Persisted/sample output must not offer account mutations. */
  readOnly?: boolean
}) {
  const t = useTranslations('appAsk')
  const text = chunks
    .filter((c): c is Extract<AgentChunk, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)
    .join('')
  const tools = chunks.filter((c): c is Extract<AgentChunk, { type: 'tool_use' }> => c.type === 'tool_use')
  const vizes = chunks.filter((c): c is Extract<AgentChunk, { type: 'visualization' }> => c.type === 'visualization')
  // Headline stats (kpi/bignumber) scan side-by-side like a dashboard row; real charts keep the
  // full column width below — a half-width line/bar chart in a ~720px chat column is unreadable.
  // Sniff BOTH spec shapes (envelope {chart:{type}} / bare {type}) like SharedAnswer.tsx —
  // WidgetRenderer accepts both, so this split must never throw on a bare chart chunk.
  const isStat = (v: (typeof vizes)[number]) => {
    const o = v.spec as unknown as { chart?: { type?: string }; type?: string } | null
    const type = o?.chart?.type ?? o?.type
    return type === 'kpi' || type === 'bignumber'
  }
  const statVizes = vizes.filter(isStat)
  const chartVizes = vizes.filter((v) => !isStat(v))
  const sqlTools = tools
    .map((tl) => (typeof (tl.input as Record<string, unknown> | null)?.sql === 'string' ? { tool: tl.tool, sql: (tl.input as { sql: string }).sql } : null))
    .filter((x): x is { tool: string; sql: string } => x !== null)
  // Non-SQL tool calls (the code-analysis run uses list_files/read_file/grep_code/get_diff — no
  // `sql` field). AgentView is reused for those runs, so render their activity too; otherwise a long
  // clone+analysis shows only the thinking dots with zero grounding feedback. Tool names + their
  // path/pattern args are identifiers/data, not UI copy, so they need no translation.
  const otherTools = tools
    .map((tl) => {
      const input = (tl.input as Record<string, unknown> | null) ?? {}
      if (typeof input.sql === 'string') return null // rendered in the SQL disclosure below
      const arg = [
        input.path,
        input.pattern,
        input.glob,
        input.collection,
        typeof input.before === 'string' && typeof input.after === 'string' ? `${input.before}..${input.after}` : null,
      ].find((v) => typeof v === 'string' && v.length > 0) as string | undefined
      return { tool: tl.tool, arg: arg ?? null }
    })
    .filter((x): x is { tool: string; arg: string | null } => x !== null)

  const streaming = phase === 'streaming'
  // Before any prose/chart arrives, show a thinking affordance so the message never looks empty.
  const showThinking = streaming && !text && vizes.length === 0

  // Turn into monitor — the answer's own SQL becomes a monitor draft. Prefer the SQL the agent
  // BOUND to a chart (that's the number the user is looking at); otherwise the last query it ran.
  // Only for finished SQL runs against a known source: a code-analysis run has no SQL, and a
  // half-streamed query is not a proposal yet.
  const vizSql = vizes
    .map((v) => (v.spec as unknown as { query?: { sql?: string } } | null)?.query?.sql)
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    .at(-1)
  const monitorSql = vizSql ?? sqlTools.at(-1)?.sql ?? null
  const monitorHref =
    !readOnly && phase === 'done' && dataSourceId && monitorSql
      ? buildMonitorHref({ dataSourceId, name: question ?? '', sql: monitorSql })
      : null
  // A multi-column result can still seed a monitor, but it needs editing before it evaluates to
  // one scalar — say "draft" so the user isn't surprised by the form asking for changes.
  const monitorIsDraft = monitorSql ? looksMultiColumn(monitorSql) : false

  return (
    <div className={s.assistant}>
      {(error || phase === 'error') && <div className={`${s.notice} ${s.noticeError}`} role="alert">{error ? t('view.streamError', { error }) : t('view.interrupted')}</div>}

      {showThinking && (
        <span className={s.progress} role="status">
          <span className={s.pulse} aria-hidden />
          {t('chat.thinking')}
        </span>
      )}

      {phase === 'done' && !text && vizes.length === 0 && <p className={`${s.prose} ${s.proseMuted}`}>{t('run.noAnswer')}</p>}

      {text && (
        <div className={s.prose}>
          {text}
          {streaming && <span className={s.caret} aria-hidden />}
        </div>
      )}

      {vizes.length > 0 && (
        <div className={s.charts}>
          {/* 위젯 추가 rides the card's header menu slot (where the dashboard ⋯ menu lives) —
              without it the header renders a no-op DefaultMenu dot button. */}
          {statVizes.length > 0 && (
            <div className={s.statGrid}>
              {statVizes.map((v, i) => (
                <WidgetRenderer key={i} spec={v.spec} menu={readOnly ? null : <AddToDashboard spec={v.spec} dataSourceId={dataSourceId} compact />} />
              ))}
            </div>
          )}
          {chartVizes.map((v, i) => (
            <WidgetRenderer key={i} spec={v.spec} menu={readOnly ? null : <AddToDashboard spec={v.spec} dataSourceId={dataSourceId} />} />
          ))}
        </div>
      )}

      {/* The product's next step, not the chat's: an answer worth reading twice is a monitor.
          Ranked first, ahead of "save to report" (which lives on each chart's header menu). */}
      {monitorHref && (
        <div className={s.nextActions}>
          <Link className={s.nextBtn} href={monitorHref}>
            <BellIcon />
            {monitorIsDraft ? t('monitor.ctaDraft') : t('monitor.cta')}
          </Link>
          <span className={s.nextHint}>{t('monitor.hint')}</span>
        </div>
      )}

      {/* Method: what the agent ran, collapsed under a disclosure. */}
      {sqlTools.length > 0 && (
        <details className={s.sql}>
          <summary className={s.sqlSummary}>
            <Chevron />
            {t('chat.sqlSteps', { count: sqlTools.length })}
          </summary>
          <div className={s.sqlBody}>
            {sqlTools.map((q, i) => (
              <div key={i}>
                <p className={s.sqlLabel}>{t('view.ranSqlLabel', { tool: q.tool })}</p>
                <pre className={s.sqlPre}>{q.sql}</pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {otherTools.length > 0 && (
        <details className={s.sql}>
          <summary className={s.sqlSummary}>
            <Chevron />
            {t('chat.toolSteps', { count: otherTools.length })}
          </summary>
          <div className={s.sqlBody}>
            {otherTools.map((tl, i) => (
              <p key={i} className={s.sqlLabel}>
                {tl.tool}
                {tl.arg ? ` — ${tl.arg}` : ''}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg className={s.chev} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
