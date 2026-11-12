'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { History, SquarePen } from 'lucide-react'

import { AgentStream } from './AgentStream'
import { AgentStreamLocal } from './AgentStreamLocal'
import { SourcePicker } from './SourcePicker'
import { ShareAction, StopFeedback, useStopRun, type RunActionIO } from './RunActions'
import { parseAnalysisStart, type AnalysisRun as RunState } from './analysis-start'
import { buildSuggestedQuestions, type SuggestibleKpi } from '@/lib/agent/suggested-questions'
import { askErrorLabel } from './error-label'
import { track } from '@/utils/analytics'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import s from './ask-chat.module.css'

interface DataSource {
  id: string
  name: string
  engine?: string
  provider?: string
  context?: 'schema' | 'code'
  isDemo?: boolean
  /** undefined = unknown (older/partial callers) — only an explicit `false` triggers the repo nudges. */
  hasRepo?: boolean
}

// dataSourceId is captured AT SUBMIT (not read from the picker at render) so a widget saved
// from a turn is attributed to the source that turn actually queried.
interface Turn {
  key: string
  question: string
  /** context_choice/extracting = the pre-run context gate; then starting → (streaming | error | quota) */
  status: 'context_choice' | 'extracting' | 'starting' | 'streaming' | 'error' | 'quota'
  run: RunState | null
  runId: string | null
  /** stream finished (success or fault) — drives Stop→Share swap */
  done: boolean
  error?: string
  quota?: string
  /** context gate: whether the source had a repo when the choice was shown (drives copy + extract path) */
  gateHasRepo?: boolean
  /** context gate: inline message shown in the choice card after a blocked/failed extraction */
  gateNote?: string
  gateBilling?: boolean
}

export interface AnalyzeIO {
  request: typeof fetch
  refresh: () => void
  track: typeof track
  runActions: RunActionIO
  renderStream: (props: { run: RunState; question: string; onDone: () => void }) => React.ReactNode
}

/** `children` = the landing banner (the setup guide), shown above the empty conversation only. */
export function AnalyzeClient({ dataSources, actions, children }: { dataSources: DataSource[]; actions?: AnalyzeIO; children?: React.ReactNode }) {
  const request = actions?.request ?? fetch
  const record = actions?.track ?? track
  const t = useTranslations('appAsk')
  const integrations = useIntegrations()

  // `?q=` prefill — the seam Monitors / Incidents / Overview use for "ask about this
  // metric" deep links. Prefill only; the user still presses send (no auto-run, so a
  // shared link can never spend quota on open).
  const searchParams = useSearchParams()
  const [dataSourceId, setDataSourceId] = useState(dataSources[0]?.id ?? '')
  const [question, setQuestion] = useState(() => (searchParams?.get('q') ?? '').slice(0, 2000))
  const [submitting, setSubmitting] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [threadIds, setThreadIds] = useState<string[]>([])
  // per-source, session-only: user already chose "proceed without context" (or extraction finished),
  // so the context gate never re-prompts for this source this session.
  const [contextDecided, setContextDecided] = useState<Set<string>>(new Set())
  const selected = dataSources.find((d) => d.id === dataSourceId)

  const keyRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // set when the user escapes an in-flight extraction ("proceed now") so the poll loop bails
  const extractionEpoch = useRef(0)
  // in-flight /api/agent/analyze fetch — aborted on new-chat/source-switch so an abandoned run's
  // id can never be appended to the CLEARED thread (a late response would corrupt the new thread).
  const analyzeAbortRef = useRef<AbortController | null>(null)
  const router = useRouter()
  const refreshPage = actions?.refresh ?? router.refresh
  useEffect(() => () => {
    extractionEpoch.current++
    analyzeAbortRef.current?.abort()
  }, [])

  // Approved KPIs of the selected source → suggested questions on the empty screen. Fetched only
  // when there's no thread yet (that's the only place they render) and never for the demo source,
  // which ships its own canned chips. A failure just means no chips.
  const [suggestedKpis, setSuggestedKpis] = useState<SuggestibleKpi[]>([])
  useEffect(() => {
    if (!dataSourceId || selected?.isDemo || turns.length > 0) {
      setSuggestedKpis([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await request(`/api/data-sources/${dataSourceId}/kpis`)
        if (!res.ok) return
        const data = (await res.json()) as { kpis?: SuggestibleKpi[] }
        if (!cancelled) setSuggestedKpis(Array.isArray(data.kpis) ? data.kpis : [])
      } catch {
        /* no chips is a fine outcome */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dataSourceId, selected?.isDemo, turns.length, request])

  function scrollSoon() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' }))
  }

  function patchTurn(key: string, patch: Partial<Turn>) {
    setTurns((prev) => prev.map((tn) => (tn.key === key ? { ...tn, ...patch } : tn)))
  }

  function resetInputHeight() {
    const el = inputRef.current
    if (el) el.style.height = 'auto'
  }
  function autoGrow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  // A source is gate-eligible when it has NO usable SUPALENS.md context (fresh/stale) yet — offer to
  // extract one before answering. Demo sources ship a canned context, so they're never gated.
  function gateEligible(ds?: DataSource): boolean {
    return !!ds && !ds.isDemo && !ds.context
  }
  function markContextDecided(id: string) {
    setContextDecided((prev) => new Set(prev).add(id))
  }

  // "Just proceed" / "proceed now" — abort any in-flight extraction poll, remember the choice for this
  // source, and run the held question WITHOUT context (existingKey reuses the same turn + skips the gate).
  function proceedWithout(key: string, q: string) {
    extractionEpoch.current++
    markContextDecided(dataSourceId)
    void runQuestion(q, key)
  }

  // Poll the context doc until it becomes injectable (fresh/stale) or fails. Bails immediately if the
  // user escaped. The extraction keeps running server-side regardless, so an escape isn't wasted.
  async function pollContextReady(sid: string, epoch: number): Promise<'ready' | 'failed' | 'timeout'> {
    const start = Date.now()
    const TIMEOUT_MS = 8 * 60 * 1000
    const INTERVAL_MS = 5000
    while (Date.now() - start < TIMEOUT_MS) {
      if (extractionEpoch.current !== epoch) return 'timeout'
      await new Promise((r) => setTimeout(r, INTERVAL_MS))
      if (extractionEpoch.current !== epoch) return 'timeout'
      try {
        const r = await request(`/api/data-sources/${sid}/context`)
        const d = await r.json().catch(() => ({}))
        if (extractionEpoch.current !== epoch) return 'timeout'
        if (!r.ok) continue
        const st = (d?.context?.status ?? null) as string | null
        if (st === 'fresh' || st === 'stale') return 'ready'
        if (st === 'failed') return 'failed'
        // 'generating' or no row yet → keep polling
      } catch {
        // transient network error → keep polling
      }
    }
    return 'timeout'
  }

  // "Extract context, then continue" — kick off generation, wait for it, then run the held question so
  // the answer is context-aware. Repo → tier-2 (Trigger clone + code agent, polled). No repo → tier-1
  // schema introspection (synchronous: populates the cache + regenerates the baseline).
  async function extractThenRun(key: string, q: string) {
    const sid = dataSourceId
    const hasRepo = selected?.hasRepo === true
    const epoch = ++extractionEpoch.current
    patchTurn(key, { status: 'extracting', gateNote: undefined, gateBilling: false, gateHasRepo: hasRepo })
    scrollSoon()
    try {
      if (hasRepo) {
        const res = await request(`/api/data-sources/${sid}/context`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (extractionEpoch.current !== epoch) return // proceed-now/cancel raced the POST — the turn moved on
        if (res.status === 402) {
          // context_limit = the free plan's one lifetime extraction is spent (upgrade copy);
          // anything else is the cycle usage quota.
          const note = data?.error === 'context_limit' ? t('contextGate.contextLimit') : t('contextGate.quota')
          patchTurn(key, { status: 'context_choice', gateNote: note, gateBilling: true })
          return
        }
        // 409 generation_in_progress = ALREADY in flight (in-flight guard) — not a failure; poll
        // it. Other 409s (repo_invalid / installation_not_found) ARE failures: fail fast instead
        // of polling a generation that was never started.
        const inProgress = res.status === 409 && data?.error === 'generation_in_progress'
        if (!res.ok && !inProgress) {
          patchTurn(key, { status: 'context_choice', gateNote: t('contextGate.failed') })
          return
        }
        // tier:1 means it fell back to an inline baseline (already done); tier:2 needs polling.
        if (data.tier !== 1) {
          const outcome = await pollContextReady(sid, epoch)
          if (extractionEpoch.current !== epoch) return // user escaped mid-poll; the turn is already running
          if (outcome !== 'ready') {
            patchTurn(key, { status: 'context_choice', gateNote: t('contextGate.failed') })
            return
          }
        }
      } else {
        // no repo → schema-only baseline via a synchronous re-introspect (no Trigger needed)
        const res = await request(`/api/data-sources/${sid}/introspect`, { method: 'POST' })
        if (extractionEpoch.current !== epoch) return
        if (!res.ok) {
          patchTurn(key, { status: 'context_choice', gateNote: t('contextGate.failed') })
          return
        }
      }
      // The wait may have been abandoned (proceed-now, source switch, new chat) — the gate turn no
      // longer owns the conversation, so never auto-run into it: a late run here would be invisible
      // (its turn was cleared) yet still hit quota AND push its runId into the NEW thread's ids.
      if (extractionEpoch.current !== epoch) return
      // context now exists → remember the decision, refresh server data (hint chips), run the question.
      // Injection reads the doc fresh on the agent host, so the answer is context-aware even before
      // refreshPage() propagates the new `selected.context` to the client.
      markContextDecided(sid)
      refreshPage()
      await runQuestion(q, key)
    } catch {
      if (extractionEpoch.current !== epoch) return // never clobber a turn that proceed-now/cancel already took over
      patchTurn(key, { status: 'context_choice', gateNote: t('contextGate.failed') })
    }
  }

  // `existingKey` set → RETRY a failed turn in place (reset it), instead of appending a duplicate
  // turn with the same question. A failed turn errored pre-stream, so it never entered threadIds;
  // retrying with the current threadIds keeps the thread correct.
  async function runQuestion(raw: string, existingKey?: string) {
    const q = raw.trim()
    if (!dataSourceId || !q || (analyzeAbortRef.current && !analyzeAbortRef.current.signal.aborted)) return
    // One answer at a time (the composer shows Stop, not Send, while one streams).
    if (turns.some((tn) => tn.run && !tn.done)) return
    // Don't let a stray send slip through while a context choice/extraction is pending — the card
    // must be resolved first. (existingKey calls come FROM the gate resolution, so they pass.)
    if (!existingKey && turns.some((tn) => tn.status === 'context_choice' || tn.status === 'extracting')) return
    // Context gate: on the FIRST message against a source with no usable context (and not already
    // decided this session), show an inline choice instead of running — extract context first, or
    // just proceed. Retries / gate-resolution (existingKey) always skip this.
    if (!existingKey && turns.length === 0 && gateEligible(selected) && !contextDecided.has(dataSourceId)) {
      const gateKey = String(++keyRef.current)
      setTurns((prev) => [
        ...prev,
        { key: gateKey, question: q, status: 'context_choice', run: null, runId: null, done: false, gateHasRepo: selected?.hasRepo === true },
      ])
      setQuestion('')
      resetInputHeight()
      scrollSoon()
      return
    }
    const key = existingKey ?? String(++keyRef.current)
    const priorTurns = threadIds.length
    setSubmitting(true)
    if (existingKey) {
      patchTurn(key, { question: q, status: 'starting', error: undefined, quota: undefined, run: null, runId: null, done: false })
    } else {
      setTurns((prev) => [...prev, { key, question: q, status: 'starting', run: null, runId: null, done: false }])
      setQuestion('')
      resetInputHeight()
    }
    scrollSoon()
    const priorRunIds = threadIds
    const ac = new AbortController()
    analyzeAbortRef.current = ac
    try {
      const res = await request('/api/agent/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataSourceId, question: q, priorRunIds }),
        signal: ac.signal,
      })
      const body = await res.json()
      const data = body && typeof body === 'object' ? body : {}
      // A new-chat/source-switch abandoned this request while it was in flight — its turn was
      // cleared; touching threadIds now would prepend THIS Q&A onto the fresh thread.
      if (ac.signal.aborted) return
      // Metered quota reached → offer an upgrade, not a raw error.
      if (res.status === 402 || data.error === 'quota_exceeded') {
        patchTurn(key, { status: 'quota', quota: typeof data.reason === 'string' ? data.reason : t('quota.default'), done: true })
        return
      }
      if (!res.ok) {
        patchTurn(key, { status: 'error', error: askErrorLabel(t, typeof data.error === 'string' ? data.error : null), done: true })
        return
      }
      const started = parseAnalysisStart(data, dataSourceId, priorRunIds)
      if (!started) throw new Error(t('chat.startUnconfirmed'))
      setThreadIds((prev) => [...prev, started.runId])
      patchTurn(key, { status: 'streaming', run: started.run, runId: started.runId })
      record(priorTurns > 0 ? 'followup_asked' : 'analysis_started', { context: selected?.context ?? 'none' })
      refreshPage() // refresh server data (e.g. data source list)
    } catch {
      if (ac.signal.aborted) return // aborted fetch rejects — the turn is gone, nothing to patch
      patchTurn(key, { status: 'error', error: t('chat.startUnconfirmed'), done: true })
    } finally {
      if (analyzeAbortRef.current === ac) {
        analyzeAbortRef.current = null
        setSubmitting(false)
        scrollSoon()
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline. Never fire mid-IME-composition (Korean/Japanese).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault()
      void runQuestion(question)
    }
  }

  // switching source starts a fresh conversation so prior turns never leak into another source's run
  // — clear the visible transcript too, else a retry on an old turn would re-run against the NEW
  // source while the stale answers from the OLD source are still shown above it.
  function onSourceChange(id: string) {
    if (id === dataSourceId) return
    extractionEpoch.current++ // abandon any in-flight extraction wait — its turn is being cleared
    analyzeAbortRef.current?.abort() // abandon an in-flight analyze fetch (its runId must not join the new thread)
    analyzeAbortRef.current = null
    setSubmitting(false)
    setDataSourceId(id)
    setThreadIds([])
    setTurns([])
    setQuestion('')
    resetInputHeight()
  }

  function newChat() {
    extractionEpoch.current++ // same as onSourceChange: a cleared transcript must never receive a late auto-run
    analyzeAbortRef.current?.abort()
    analyzeAbortRef.current = null
    setSubmitting(false)
    setThreadIds([])
    setTurns([])
    setQuestion('')
    resetInputHeight()
    inputRef.current?.focus()
  }

  const hasThread = turns.length > 0
  // while a context choice/extraction is pending, the composer is locked so the card is resolved first
  const gatePending = turns.some((tn) => tn.status === 'context_choice' || tn.status === 'extracting')
  // The answer on screen that is still streaming (at most one: sending waits for it, like ChatGPT) —
  // the composer's send button becomes its stop button.
  const streamingTurn = turns.find((tn) => tn.run && !tn.done) ?? null
  const stopper = useStopRun(streamingTurn?.runId ?? null, actions?.runActions)

  // One quiet line under the composer, most urgent first: a live run's reset caveat, the demo
  // banner, the repo nudge, the context provenance — else the answer disclaimer.
  const footnote = turns.some((turn) => !turn.done) ? (
    <span>{t('chat.resetHint')}</span>
  ) : selected?.isDemo ? (
    <span className={s.footLine}>
      <span className="dx-badge dx-badge-bloom">{t('demo.tag')}</span>
      <span>
        {t('demo.banner')}{' '}
        <Link href="/app/sources" className={s.hintLink}>
          {t('demo.connectCta')}
        </Link>
      </span>
    </span>
  ) : selected?.hasRepo === false && integrations.github ? (
    <span className={s.footLine}>
      <RepoIcon />
      <span>
        {t('repoHint.note')}{' '}
        {/* Setup owns connect-and-attach as one resumable step; /app/sources is the
            maintenance surface, not where an unfinished workspace should land. */}
        <Link href="/app/setup" className={s.hintLink}>
          {t('repoHint.cta')}
        </Link>
      </span>
    </span>
  ) : selected?.context ? (
    <span className={s.footLine}>
      <SparkleIcon />
      <span>{t('context.note', { kind: selected.context === 'code' ? t('context.code') : t('context.schema') })}</span>
    </span>
  ) : (
    <span>{t('chat.disclaimer')}</span>
  )

  return (
    <div className={s.wrap} data-state={hasThread ? 'thread' : 'empty'}>
      {/* Top bar, right-aligned like ChatGPT's: start over, open past analyses. */}
      <div className={s.header}>
        {hasThread && (
          <button type="button" className={s.headerBtn} onClick={newChat}>
            <SquarePen size={16} strokeWidth={1.8} aria-hidden />
            <span className={s.headerLabel}>{t('chat.newChat')}</span>
          </button>
        )}
        <Link href="/app/ask/history" className={s.headerBtn}>
          <History size={16} strokeWidth={1.8} aria-hidden />
          <span className={s.headerLabel}>{t('chat.history')}</span>
        </Link>
      </div>

      {/* the setup guide belongs to the landing moment, not to a conversation */}
      {!hasThread && children && <div className={s.banner}>{children}</div>}

      {/* Composer keeps ONE tree position across empty → thread, so typing focus survives the
          first send. Empty: greeting, composer and suggestions centered as one group. */}
      <div className={s.stage}>
        {!hasThread ? (
          <div className={s.welcome}>
            <h1 className={s.welcomeTitle}>{t('chat.welcomeTitle')}</h1>
          </div>
        ) : (
          <div className={s.transcript}>
            <h1 className="sr-only">{t('chat.currentConversation')}</h1>
            {turns.map((turn, i) => (
              <div key={turn.key} className={s.turn}>
                {/* the question — the user's own message, a bubble on the right */}
                <div className={s.userRow}>
                  <div className={s.question}>{turn.question}</div>
                </div>

                {turn.status === 'context_choice' && (
                  <div className={s.choiceCard}>
                    <p className={s.choiceHead}>
                      {turn.gateHasRepo ? t('contextGate.titleRepo') : t('contextGate.titleSchema')}
                    </p>
                    <p className={s.choiceBody}>
                      {turn.gateHasRepo ? t('contextGate.descRepo') : t('contextGate.descSchema')}
                    </p>
                    {turn.gateNote && <p className={s.choiceNote} role="alert">{turn.gateNote}</p>}
                    <div className={s.choiceActions}>
                      <button type="button" className={s.choicePrimary} onClick={() => void extractThenRun(turn.key, turn.question)}>
                        {turn.gateHasRepo ? t('contextGate.extractRepo') : t('contextGate.extractSchema')}
                      </button>
                      <button type="button" className={s.choiceSecondary} onClick={() => proceedWithout(turn.key, turn.question)}>
                        {turn.gateNote ? t('contextGate.proceedAnyway') : t('contextGate.proceed')}
                      </button>
                      {turn.gateBilling && <Link className={s.choiceSecondary} href="/app/settings/billing">{t('quota.upgrade')}</Link>}
                    </div>
                  </div>
                )}

                {turn.status === 'extracting' && (
                  <div className={s.choiceCard}>
                    <span className={s.progress} role="status">
                      <span className={s.pulse} aria-hidden />
                      {turn.gateHasRepo ? t('contextGate.extractingRepo') : t('contextGate.extractingSchema')}
                    </span>
                    <p className={s.choiceBody}>{t('contextGate.background')}</p>
                    <div className={s.choiceActions}>
                      <button type="button" className={s.choiceSecondary} onClick={() => proceedWithout(turn.key, turn.question)}>
                        {t('contextGate.proceedNow')}
                      </button>
                    </div>
                  </div>
                )}

                {turn.status === 'starting' && (
                  <div className={s.assistant}>
                    <span className={s.progress} role="status">
                      <span className={s.pulse} aria-hidden />
                      {t('chat.thinking')}
                    </span>
                  </div>
                )}

                {turn.status === 'error' && (
                  <div className={s.assistant}>
                    <div className={`${s.notice} ${s.noticeError}`} role="alert">
                      <span>{turn.error}</span>
                      <Link href="/app/ask/history">{t('historyLink')}</Link>
                      <button type="button" className={s.retry} onClick={() => void runQuestion(turn.question, turn.key)}>
                        {t('share.retry')}
                      </button>
                    </div>
                  </div>
                )}

                {turn.status === 'quota' && (
                  <div className={s.assistant}>
                    <div className={`${s.notice} ${s.noticeQuota}`} role="alert">
                      <span>{turn.quota}</span>
                      <Link href="/app/settings/billing" className={s.noticeBtn}>
                        {t('quota.upgrade')}
                      </Link>
                    </div>
                  </div>
                )}

                {turn.run && (
                  <>
                    {actions ? actions.renderStream({ run: turn.run, question: turn.question, onDone: () => { patchTurn(turn.key, { done: true }); if (i === turns.length - 1) scrollSoon() } }) : turn.run.mode === 'trigger' ? (
                      <AgentStream
                        runId={turn.run.triggerRunId}
                        accessToken={turn.run.publicToken}
                        dataSourceId={turn.run.dataSourceId}
                        question={turn.question}
                        onDone={() => {
                          patchTurn(turn.key, { done: true })
                          if (i === turns.length - 1) scrollSoon()
                        }}
                      />
                    ) : (
                      <AgentStreamLocal
                        runId={turn.run.runId}
                        dataSourceId={turn.run.dataSourceId}
                        priorRunIds={turn.run.priorRunIds}
                        question={turn.question}
                        onDone={() => {
                          patchTurn(turn.key, { done: true })
                          if (i === turns.length - 1) scrollSoon()
                        }}
                      />
                    )}
                    {/* the answer's action row appears once it is complete (stop lives in the composer) */}
                    {turn.done && (
                      <div className={s.msgActions}>
                        <ShareAction runId={turn.runId} actions={actions?.runActions} variant="ghost" />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <div ref={bottomRef} className={s.end} />
          </div>
        )}

        <div className={s.composer}>
          {/* a stop request's outcome sits in the composer's flow, above the input — never over the answer */}
          {streamingTurn && stopper.state !== 'idle' && (
            <div className={s.stopNote} data-run-stop>
              <StopFeedback stopper={stopper} />
            </div>
          )}
          <div className={s.bar}>
            <textarea
              ref={inputRef}
              className={s.input}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value)
                autoGrow()
              }}
              onKeyDown={onKeyDown}
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.questionLabel')}
              rows={1}
            />
            <div className={s.barControls}>
              {dataSources.length > 0 && (
                <SourcePicker
                  sources={dataSources}
                  value={dataSourceId}
                  onChange={onSourceChange}
                  label={t('chat.sourceLabel')}
                  demoLabel={t('demo.tag')}
                />
              )}
              {streamingTurn ? (
                <span className={s.stopSlot} data-run-stop>
                  <button type="button" className={s.stop} aria-label={stopper.label} title={stopper.label} disabled={!stopper.enabled} onClick={() => void stopper.stop()}>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                      <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
                    </svg>
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={s.send}
                  disabled={submitting || gatePending || !question.trim()}
                  onClick={() => void runQuestion(question)}
                  aria-label={t('chat.send')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <p className={s.footnote}>{footnote}</p>
        </div>

        {!hasThread && (selected?.isDemo ? (
          <DemoChips onPick={(q) => { record('demo_chip_clicked'); void runQuestion(q) }} disabled={submitting || gatePending} />
        ) : (
          <KpiChips kpis={suggestedKpis} onPick={(q) => { record('kpi_chip_clicked'); setQuestion(q); requestAnimationFrame(() => { autoGrow(); inputRef.current?.focus() }) }} disabled={submitting || gatePending} />
        ))}
      </div>
    </div>
  )
}

/** Suggested questions: a grid of quiet cards under the composer (ChatGPT's starter prompts). */
function Suggestions({ title, questions, onPick, disabled }: {
  title: string
  questions: { id: string; text: string }[]
  onPick: (q: string) => void
  disabled: boolean
}) {
  return (
    <div className={s.suggest}>
      <p className={s.suggestLabel}>{title}</p>
      <ul className={s.suggestList}>
        {questions.map((q) => (
          <li key={q.id}>
            <button type="button" className={s.suggestion} disabled={disabled} onClick={() => onPick(q.text)}>
              {q.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Example-question chips for the demo source's empty state — the schema is a stranger's, so we
 * hand the first question over. Click = run immediately (typing it out adds nothing). */
function DemoChips({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  const t = useTranslations('appAsk')
  const raw = t.raw('chat.demoChips')
  if (!Array.isArray(raw) || raw.length === 0) return null
  return (
    <Suggestions
      title={t('chat.demoChipsTitle')}
      questions={(raw as string[]).map((q) => ({ id: q, text: q }))}
      onPick={onPick}
      disabled={disabled}
    />
  )
}

/**
 * Suggested questions from the source's APPROVED KPI definitions — the team already agreed these
 * are the numbers that matter, so they are the best first question. Unlike the demo chips these
 * only FILL the composer: a real KPI question usually wants a tweak (period, segment) before it
 * spends a run.
 */
function KpiChips({
  kpis,
  onPick,
  disabled,
}: {
  kpis: SuggestibleKpi[]
  onPick: (q: string) => void
  disabled: boolean
}) {
  const t = useTranslations('appAsk')
  const raw = t.raw('kpiChips.templates')
  const templates = Array.isArray(raw) ? (raw as string[]) : []
  const questions = buildSuggestedQuestions(kpis, templates)
  if (questions.length === 0) return null
  return <Suggestions title={t('kpiChips.title')} questions={questions} onPick={onPick} disabled={disabled} />
}

function SparkleIcon() {
  return (
    <svg className={`${s.hintIcon} ${s.hintIconBloom}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" />
    </svg>
  )
}
// git-branch glyph — matches RepoChipIcon in sources/SourcesClient.tsx ("attach a code repo")
function RepoIcon() {
  return (
    <svg className={s.hintIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="4" x2="6" y2="15" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <path d="M18 9.4c0 4.6-3.9 5.6-8 5.6" />
    </svg>
  )
}
