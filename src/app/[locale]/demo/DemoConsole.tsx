'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { ArrowUp, Database, RotateCcw, Table2 } from 'lucide-react'

import type { AgentPhase } from '@/components/agent/AgentView'
import { AnswerBody, LiveAnswer } from './AnswerCard'
import {
  DEMO_ASK_EVENT,
  DEMO_CONNECT_HREF,
  type DemoAnswerResult,
  type DemoConsoleTable,
  type DemoPreloadedAnswer,
  type DemoSuggestion,
  type DemoSuggestionGroup,
} from './demo-types'
import s from './DemoConsole.module.css'

const MAX_QUESTION = 300
// A 202 means the identical question is streaming for someone else; its cache row lands soon.
const PENDING_RETRY_MS = 4000
const PENDING_MAX_TRIES = 30
const GROUPS: DemoSuggestionGroup[] = ['revenue', 'diagnose', 'customers']

type NoticeKey = 'busy' | 'rateLimited' | 'dailyBudget' | 'unavailable'

type Turn = {
  key: string
  question: string
  startedAt: number
  status: 'starting' | 'pending' | 'live' | 'cached' | 'limited' | 'error'
  run?: { triggerRunId: string; publicToken: string }
  result?: DemoAnswerResult
  answeredAt?: string
  notice?: NoticeKey
  done: boolean
}

const normalize = (question: string) => question.replace(/\s+/g, ' ').trim()

export default function DemoConsole({
  configured,
  suggestions,
  preloaded,
  tables,
  liveLimit,
}: {
  configured: boolean
  suggestions: DemoSuggestion[]
  preloaded: Record<string, DemoPreloadedAnswer>
  tables: DemoConsoleTable[]
  liveLimit: number
}) {
  const t = useTranslations('demo')
  const format = useFormatter()
  const locale = useLocale()
  const rules = t.raw('console.rules') as string[]
  const limits = t.raw('console.limits') as string[]

  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const keyRef = useRef(0)
  const epochRef = useRef(0)

  const running = turns.some((turn) => !turn.done)
  const asked = new Set(turns.map((turn) => turn.question))
  const remaining = suggestions.filter((item) => !asked.has(normalize(item.question)))

  const patch = useCallback((key: string, update: Partial<Turn>) => {
    setTurns((previous) => previous.map((turn) => (turn.key === key ? { ...turn, ...update } : turn)))
  }, [])

  const scrollToEnd = useCallback((force = false) => {
    const thread = threadRef.current
    if (!thread || (!force && !stickRef.current)) return
    requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: force ? 'smooth' : 'auto' }))
  }, [])

  const ask = useCallback(
    async (raw: string, retryKey?: string) => {
      const q = normalize(raw)
      if (!q || q.length > MAX_QUESTION) return
      const key = retryKey ?? String(++keyRef.current)
      const epoch = ++epochRef.current
      stickRef.current = true

      const cached = preloaded[q]
      if (cached && !retryKey) {
        setTurns((previous) => [
          ...previous,
          { key, question: q, startedAt: Date.now(), status: 'cached', result: cached.result, answeredAt: cached.answeredAt, done: true },
        ])
        setQuestion('')
        scrollToEnd(true)
        return
      }

      const fresh: Turn = { key, question: q, startedAt: Date.now(), status: 'starting', done: false }
      if (retryKey) patch(key, fresh)
      else setTurns((previous) => [...previous, fresh])
      setQuestion('')
      scrollToEnd(true)

      try {
        for (let tries = 0; ; tries++) {
          const response = await fetch('/api/demo/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, locale }),
          })
          const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
          if (response.ok && data.mode === 'cached') {
            const result = (data.result ?? {}) as DemoAnswerResult
            patch(key, { status: 'cached', result, answeredAt: String(data.answeredAt ?? ''), done: true })
            return
          }
          if (response.ok && data.mode === 'trigger') {
            patch(key, {
              status: 'live',
              startedAt: Date.now(),
              run: { triggerRunId: String(data.triggerRunId), publicToken: String(data.publicToken) },
            })
            return
          }
          if (response.status === 202) {
            if (tries >= PENDING_MAX_TRIES) throw new Error('pending_timeout')
            patch(key, { status: 'pending' })
            await new Promise((resolve) => setTimeout(resolve, PENDING_RETRY_MS))
            if (epochRef.current !== epoch) return
            continue
          }
          if (response.status === 429 || response.status === 503) {
            const notice: NoticeKey =
              data.error === 'rate_limited' ? 'rateLimited' : data.error === 'daily_budget' ? 'dailyBudget' : data.error === 'busy' ? 'busy' : 'unavailable'
            patch(key, { status: 'limited', notice, done: true })
            return
          }
          throw new Error(String(data.error ?? response.status))
        }
      } catch {
        patch(key, { status: 'error', done: true })
      } finally {
        scrollToEnd()
      }
    },
    [locale, patch, preloaded, scrollToEnd],
  )

  // Other sections ask through a window event and bring the console into view.
  useEffect(() => {
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (typeof detail !== 'string' || running) return
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      void ask(detail)
    }
    window.addEventListener(DEMO_ASK_EVENT, onAsk)
    return () => window.removeEventListener(DEMO_ASK_EVENT, onAsk)
  }, [ask, running])

  // Grow the composer with its text (up to four lines).
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`
  }, [question])

  const submit = () => {
    if (!running && configured) void ask(question)
  }

  const suggestionButton = (item: DemoSuggestion, compact = false) => (
    <button
      key={item.question}
      type="button"
      className={compact ? s.chip : s.suggestion}
      disabled={running || (!configured && !preloaded[normalize(item.question)])}
      onClick={() => void ask(item.question)}
    >
      <span>{item.question}</span>
      {!compact && <ArrowUp size={14} className={s.suggestionArrow} aria-hidden />}
    </button>
  )

  return (
    <div ref={rootRef} className={`ed-product ${s.window}`} role="region" aria-label={t('console.label')}>
      <div className={s.titleBar}>
        <span className={s.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={s.titleName}>
          <Database size={13} aria-hidden />
          {t('console.database')}
        </span>
        <span className={s.titleEngine}>{t('console.engine')}</span>
        {configured && (
          <span className={s.livePill}>
            <span className={s.liveDot} aria-hidden />
            {t('console.live')}
          </span>
        )}
        {turns.length > 0 && (
          <button type="button" className={s.clearButton} disabled={running} onClick={() => setTurns([])} aria-label={t('console.clear')}>
            <RotateCcw size={13} aria-hidden />
            <span className={s.clearLabel}>{t('console.clear')}</span>
          </button>
        )}
      </div>

      <div className={s.body}>
        <aside className={s.sidebar} aria-label={t('console.schema')}>
          <p className={s.sideTitle}>{t('console.tablesTitle')}</p>
          <ul className={s.tables}>
            {tables.map((table) => (
              <li key={table.name}>
                <details>
                  <summary>
                    <Table2 size={13} aria-hidden />
                    <span className={s.tableName}>{table.name}</span>
                    {table.rows !== null && <span className={s.tableRows}>{format.number(table.rows)}</span>}
                  </summary>
                  <ul className={s.columns}>
                    {table.columns.map((column) => (
                      <li key={column}>{column}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          <p className={s.sideTitle}>{t('console.rulesTitle')}</p>
          <ul className={s.sideList}>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className={s.sideTitle}>{t('console.limitsTitle')}</p>
          <ul className={s.sideList}>
            {limits.map((limit) => (
              <li key={limit}>{limit.replace('{count}', String(liveLimit))}</li>
            ))}
          </ul>
        </aside>

        <div className={s.main}>
          <div
            ref={threadRef}
            className={s.thread}
            onScroll={(event) => {
              const el = event.currentTarget
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
            }}
          >
            {turns.length === 0 ? (
              <div className={s.empty}>
                <h3 className={s.emptyTitle}>{t('console.emptyTitle')}</h3>
                <p className={s.emptyBody}>{t('console.emptyBody')}</p>
                <div className={s.groups}>
                  {GROUPS.map((group) => (
                    <div key={group} className={s.group}>
                      <p className={s.groupLabel}>{t(`console.groups.${group}`)}</p>
                      {suggestions.filter((item) => item.group === group).map((item) => suggestionButton(item))}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <ol className={s.turns}>
                {turns.map((turn) => (
                  <li key={turn.key} className={s.turn}>
                    <p className={s.question}>
                      <span className={s.speaker}>{t('console.you')}</span>
                      {turn.question}
                    </p>
                    <div className={s.reply}>
                      <span className={s.speaker}>{t('console.analyst')}</span>
                      {(turn.status === 'starting' || turn.status === 'pending') && (
                        <p className={s.answerStatus} role="status">
                          <span className={s.pulse} aria-hidden />
                          {turn.status === 'pending' ? t('answer.pending') : t('answer.starting')}
                        </p>
                      )}
                      {turn.status === 'live' && turn.run && (
                        <LiveAnswer
                          runId={turn.run.triggerRunId}
                          accessToken={turn.run.publicToken}
                          startedAt={turn.startedAt}
                          onProgress={() => scrollToEnd()}
                          onDone={(phase: AgentPhase) => {
                            patch(turn.key, { done: true })
                            if (phase !== 'streaming') scrollToEnd()
                          }}
                        />
                      )}
                      {turn.status === 'cached' && turn.result && <AnswerBody mode="cached" result={turn.result} answeredAt={turn.answeredAt ?? ''} />}
                      {turn.status === 'limited' && (
                        <div className={s.notice} role="status">
                          <p>{t(`notices.${turn.notice ?? 'unavailable'}`)}</p>
                          {(turn.notice === 'rateLimited' || turn.notice === 'dailyBudget') && (
                            <Link className={s.noticeAction} href={DEMO_CONNECT_HREF}>
                              {t('notices.connect')}
                            </Link>
                          )}
                        </div>
                      )}
                      {turn.status === 'error' && (
                        <div className={`${s.notice} ${s.noticeError}`} role="alert">
                          <p>{t('notices.error')}</p>
                          <button type="button" className={s.noticeAction} disabled={running} onClick={() => void ask(turn.question, turn.key)}>
                            {t('notices.retry')}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={s.composerArea}>
            {turns.length > 0 && remaining.length > 0 && (
              <div className={s.more}>
                <span className={s.moreLabel}>{t('console.more')}</span>
                <div className={s.chips}>{remaining.map((item) => suggestionButton(item, true))}</div>
              </div>
            )}
            <form
              className={s.composer}
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <textarea
                ref={inputRef}
                className={s.input}
                rows={1}
                value={question}
                maxLength={MAX_QUESTION}
                placeholder={configured ? t('console.placeholder') : t('notices.unavailable')}
                aria-label={t('console.placeholder')}
                disabled={!configured}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <button type="submit" className={s.send} disabled={!configured || running || !question.trim()} aria-label={t('console.send')}>
                <ArrowUp size={17} aria-hidden />
              </button>
            </form>
            <p className={s.composerHint}>
              <span>{t('console.hint')}</span>
              <span>
                {question.length}/{MAX_QUESTION}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
