'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import s from './ActiveJobsIndicator.module.css'
import type { ActiveJob, ActiveJobKind } from '@/lib/jobs/active'

/**
 * Topbar "진행 중" indicator (activity center v0) for org-wide async jobs (analysis / code / KPI / context).
 *
 * Polls GET /api/jobs/active — 5s while something is running, 30s when idle — and
 * pauses entirely while the tab is hidden (immediate refetch on return). Jobs that
 * disappear between polls surface for ~30s under a recent-activity section with a link,
 * so a user who left during a long KPI extraction still sees where it landed.
 * Renders nothing when there is nothing to show.
 */

const ACTIVE_MS = 5_000
const IDLE_MS = 30_000
const FINISHED_TTL_MS = 30_000

interface FinishedJob extends ActiveJob {
  finishedAt: number
}

const KIND_LABEL_KEY: Record<ActiveJobKind, string> = {
  analysis: 'jobs.kindAnalysis',
  code: 'jobs.kindCode',
  kpi: 'jobs.kindKpi',
  context: 'jobs.kindContext',
}

function elapsedLabel(startedAt: string, t: ReturnType<typeof useTranslations>): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60_000)
  if (m < 1) return t('jobs.justStarted')
  return t('jobs.minutesElapsed', { count: m })
}

export default function ActiveJobsIndicator({ placement = 'bar' }: { placement?: 'rail' | 'bar' }) {
  const t = useTranslations('appChrome')
  const [jobs, setJobs] = useState<ActiveJob[]>([])
  const [finished, setFinished] = useState<FinishedJob[]>([])
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // refs so the polling loop reads fresh state without re-arming on every render
  const jobsRef = useRef<ActiveJob[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/active', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { jobs?: ActiveJob[] }
      const next = body.jobs ?? []
      const nextIds = new Set(next.map((j) => j.id))
      const now = Date.now()
      // No longer in this response is not proof of success or even completion:
      // the API's time windows/limits can also remove a row. Keep recent activity ~30s.
      const ended = jobsRef.current.filter((j) => !nextIds.has(j.id)).map((j) => ({ ...j, finishedAt: now }))
      if (ended.length > 0) {
        setFinished((prev) =>
          [...ended, ...prev.filter((f) => now - f.finishedAt < FINISHED_TTL_MS)].slice(0, 5),
        )
      } else {
        setFinished((prev) => prev.filter((f) => now - f.finishedAt < FINISHED_TTL_MS))
      }
      jobsRef.current = next
      setJobs(next)
    } catch {
      /* transient network failure — next tick retries */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') await poll()
      if (cancelled) return
      timerRef.current = setTimeout(tick, jobsRef.current.length > 0 ? ACTIVE_MS : IDLE_MS)
    }
    void tick()
    const onVisible = () => {
      // returning to the tab: refetch immediately instead of waiting out the idle timer
      if (document.visibilityState === 'visible') {
        if (timerRef.current) clearTimeout(timerRef.current)
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  useEffect(() => {
    if (jobs.length === 0 && finished.length === 0) setOpen(false)
  }, [jobs.length, finished.length])

  useEffect(() => {
    if (!open) return
    popoverRef.current?.querySelector<HTMLAnchorElement>('a')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (jobs.length === 0 && finished.length === 0) return null

  return (
    <div ref={wrapRef} className={s.jobsWrap} data-jobs data-placement={placement}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}>
      {open && (
        <div id={popoverId} ref={popoverRef} className={s.jobsPop} role="dialog" aria-label={t(jobs.length > 0 ? 'jobs.title' : 'jobs.justEnded')}>
          {jobs.length > 0 && (
            <>
              <span className={s.jobsPopHead}>{t('jobs.title')}</span>
              {jobs.map((j) => (
                <Link key={j.id} href={j.href} className={s.jobsRow} data-stale={j.stale} onClick={() => setOpen(false)}>
                  <span className={s.jobsDot} data-stale={j.stale} aria-hidden />
                  <span className={s.jobsRowMain}>
                    <span className={s.jobsRowKind}>
                      {t(KIND_LABEL_KEY[j.kind])}
                      {j.stale && <em className={s.jobsStale}>{t('jobs.stale')}</em>}
                    </span>
                    {j.detail && <span className={s.jobsRowDetail}>{j.detail}</span>}
                  </span>
                  <span className={s.jobsRowTime} suppressHydrationWarning>
                    {elapsedLabel(j.startedAt, t)}
                  </span>
                </Link>
              ))}
            </>
          )}
          {finished.length > 0 && (
            <>
              <span className={s.jobsPopHead}>{t('jobs.justEnded')}</span>
              {finished.map((j) => (
                <Link key={`f-${j.id}`} href={j.href} className={s.jobsRow} data-done onClick={() => setOpen(false)}>
                  <span className={s.jobsDoneMark} aria-hidden>
                    ·
                  </span>
                  <span className={s.jobsRowMain}>
                    <span className={s.jobsRowKind}>{t(KIND_LABEL_KEY[j.kind])}</span>
                    {j.detail && <span className={s.jobsRowDetail}>{j.detail}</span>}
                  </span>
                  <span className={s.jobsRowTime}>{t('jobs.view')}</span>
                </Link>
              ))}
            </>
          )}
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={s.jobsBtn}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        aria-label={jobs.length > 0 ? t('jobs.running', { count: jobs.length }) : t('jobs.justEnded')}
        onClick={() => setOpen((v) => !v)}
      >
        {jobs.length > 0 ? <span className={s.jobsPulse} aria-hidden /> : <span className={s.jobsDoneMark} aria-hidden>·</span>}
        <span className={s.jobsCompact} aria-hidden>{jobs.length > 0 ? jobs.length : '◷'}</span>
        <span className={s.jobsBtnLabel}>
          {jobs.length > 0 ? t('jobs.running', { count: jobs.length }) : t('jobs.justEnded')}
        </span>
      </button>
    </div>
  )
}
