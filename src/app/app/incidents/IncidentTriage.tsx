'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

import type { AckKind, CauseFeedback } from '@/lib/alerts/incidents'
import { formatInOrgTz } from '@/lib/org/timezone'
import { setIncidentAck, setIncidentFeedback, snoozeIncidentMonitor } from './actions'
import s from './incidents.module.css'

export interface IncidentTriageIO {
  ack: typeof setIncidentAck
  feedback: typeof setIncidentFeedback
  snooze: typeof snoozeIncidentMonitor
  refresh: () => void
}

/**
 * Incident triage controls. Rendered ONLY when `*_incident_ack.sql` is applied (the server probes)
 * and the viewer is member+ — so this component never has to reason about either.
 *
 * Every action is a server action that revalidates the page; local state only carries the
 * in-flight/error notice and the correction draft.
 */
export function IncidentTriage({
  eventId,
  ack,
  feedback,
  hasExplanation,
  snoozedUntil,
  timezone,
  actions,
}: {
  eventId: string
  ack: { at: string; by: string | null; kind: AckKind } | null
  feedback: { value: CauseFeedback; correction: string | null } | null
  hasExplanation: boolean
  snoozedUntil: string | null
  /** the org's declared display zone — the mute-until label reads in it, not raw UTC */
  timezone: string
  actions?: IncidentTriageIO
}) {
  const t = useTranslations('appIncidents')
  const locale = useLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [correction, setCorrection] = useState(feedback?.correction ?? '')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const io = actions ?? { ack: setIncidentAck, feedback: setIncidentFeedback, snooze: snoozeIncidentMonitor, refresh: () => router.refresh() }

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    if (locked.current) return
    locked.current = true
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (!mounted.current) return
        if (res.ok) {
          setNotice({ text: t('feedback.saved'), error: false })
          try { io.refresh() } catch { /* Saved feedback remains visible if refresh fails. */ }
        } else {
          setNotice({ text: res.message ?? t('actions.unconfirmed'), error: true })
        }
      } catch {
        if (mounted.current) setNotice({ text: t('actions.unconfirmed'), error: true })
      } finally {
        locked.current = false
      }
    })
  }

  const snoozeActive = snoozedUntil !== null && Date.parse(snoozedUntil) > Date.now()

  return (
    <div className={s.triage}>
      <div className={s.triageBlock}>
        <div className={s.actions}>
          {ack ? (
            <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={pending} onClick={() => run(() => io.ack(eventId, null))}>
              {t('actions.unack')}
            </button>
          ) : (
            <>
              <button type="button" className={`dx-btn ${s.control}`} disabled={pending} onClick={() => run(() => io.ack(eventId, 'ack'))}>
                {t('actions.ack')}
              </button>
              <button
                type="button"
                className={`dx-btn-ghost ${s.control}`}
                disabled={pending}
                onClick={() => run(() => io.ack(eventId, 'expected'))}
              >
                {t('actions.expected')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={s.triageBlock}>
        <span className={s.triageLabel} data-active={snoozeActive}>
          {snoozeActive
            ? t('actions.snoozedUntil', {
                when: formatInOrgTz(snoozedUntil, timezone, intlLocale, { dateStyle: 'medium', timeStyle: 'short' }),
              })
            : t('actions.snooze')}
        </span>
        <div className={s.actions}>
          {snoozeActive ? (
            <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={pending} onClick={() => run(() => io.snooze(eventId, 0))}>
              {t('actions.unsnooze')}
            </button>
          ) : (
            <>
              <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={pending} onClick={() => run(() => io.snooze(eventId, 1))}>
                {t('actions.snooze1h')}
              </button>
              <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={pending} onClick={() => run(() => io.snooze(eventId, 24))}>
                {t('actions.snooze24h')}
              </button>
            </>
          )}
        </div>
      </div>

      {hasExplanation && (
        <div className={s.triageBlock}>
          <span className={s.feedbackHead}>{t('feedback.title')}</span>
          <span className={s.feedbackHint}>{t('feedback.hint')}</span>
          <div className={`dx-segmented ${s.choices}`}>
            {(['correct', 'partial', 'wrong'] as CauseFeedback[]).map((v) => (
              <button
                key={v}
                type="button"
                className={s.choice}
                disabled={pending}
                aria-pressed={feedback?.value === v}
                onClick={() => run(() => io.feedback(eventId, v, correction))}
              >
                {t(`feedback.${v}`)}
              </button>
            ))}
          </div>
          {feedback && (
            <>
              <label className={s.correctionLabel}>
                {t('feedback.correctionLabel')}
                <textarea
                className={s.correction}
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder={t('feedback.correctionPlaceholder')}
                aria-label={t('feedback.correctionLabel')}
                disabled={pending}
                maxLength={2000}
                />
              </label>
              <div className={s.actions}>
                <button
                  type="button"
                  className={`dx-btn-ghost ${s.control}`}
                  disabled={pending}
                  onClick={() => run(() => io.feedback(eventId, feedback.value, correction))}
                >
                  {t('feedback.save')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(pending || notice) && (
        <p className={s.notice} role={notice?.error && !pending ? 'alert' : 'status'} data-error={notice?.error ? 'true' : 'false'}>
          {pending ? t('actions.saving') : notice?.text}
        </p>
      )}
    </div>
  )
}
