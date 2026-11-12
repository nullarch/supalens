'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { oauthFeedbackPhase, oauthReturnContext, parseOAuthSnapshot } from '@/lib/supabase-oauth/return-feedback'
import s from './OAuthReturnFeedback.module.css'

export function OAuthReturnFeedback() {
  const params = useSearchParams()
  const pathname = usePathname()
  const query = params.toString()
  const context = useMemo(() => oauthReturnContext(new URLSearchParams(query)), [query])
  if (!context) return null
  return <ReturnCard key={`${pathname}:${context.connectionId}:${context.recovery}:${context.importing}:${context.selecting}`} context={context} />
}

function ReturnCard({ context }: { context: NonNullable<ReturnType<typeof oauthReturnContext>> }) {
  const t = useTranslations('appRecovery')
  const router = useRouter()
  const pathname = usePathname()
  const failure = context.recovery && context.recovery !== 'authorized' ? context.recovery : null
  const [phase, setPhase] = useState<string>(failure ?? 'checking')
  const [attempt, setAttempt] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [])
  useEffect(() => {
    if (failure || dismissed) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let checks = 0
    setPhase('checking')
    async function check() {
      if (!context.connectionId) { setPhase('unconfirmed'); return }
      try {
        const response = await fetch(`/api/connect-supabase/status?connectionId=${encodeURIComponent(context.connectionId)}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
        const snapshot = response.ok ? parseOAuthSnapshot(await response.json()) : null
        if (controller.signal.aborted) return
        const next = oauthFeedbackPhase(context, snapshot)
        checks += 1
        if (next === 'pending' || next === 'importing') {
          setPhase(checks >= 20 ? 'delayed' : next)
          if (checks < 20) timer = setTimeout(check, 3000)
        } else {
          setPhase(next)
          if (next === 'connected' || next === 'authorized' || next === 'select') router.refresh()
        }
      } catch {
        if (!controller.signal.aborted) setPhase('unconfirmed')
      }
    }
    void check()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [context, failure, attempt, router, dismissed])
  if (dismissed) return null
  const success = ['authorized', 'connected', 'select'].includes(phase)
  const busy = ['checking', 'pending', 'importing'].includes(phase)
  const verifyHref = pathname.startsWith('/app/monitors') ? '#recovery' : '/app/monitors#recovery'
  const tone = success ? 'success' : busy ? 'progress' : 'warning'
  return <section ref={panel} tabIndex={-1} className={`dx-announce ${s.card}`} data-tone={tone} data-oauth-phase={phase} data-recovery-return={context.recovery ?? undefined} aria-label={t('feedback.label')}>
    <span className={s.dot} aria-hidden />
    <div className={s.content} role="status" aria-live="polite" aria-atomic="true">
      <h2 className={s.title}>{t(`feedback.${success || busy || phase === 'delayed' ? phase : 'unconfirmed'}Title`)}</h2>
      <p className={s.body}>{failure ? t(`returns.${failure}`) : t(`feedback.${phase}Body`)}</p>
      {success && context.planLimited && <p className={s.body}>{t('feedback.planLimited')}</p>}
      <div className={s.actions}>
        {phase === 'authorized' && <Link className="dx-btn dx-btn-sm" href={verifyHref}>{t('feedback.verify')}</Link>}
        {phase === 'select' && <Link className="dx-btn dx-btn-sm" href="/app/setup">{t('feedback.select')}</Link>}
        {phase === 'connected' && <Link className="dx-btn dx-btn-sm" href="/app/sources">{t('feedback.sources')}</Link>}
        {success && context.planLimited && <Link className="dx-btn-ghost dx-btn-sm" href="/app/settings/billing">{t('feedback.billing')}</Link>}
        {!success && !busy && <>
          {!failure && <button className="dx-btn dx-btn-sm" type="button" onClick={() => setAttempt(n => n + 1)}>{t('feedback.retry')}</button>}
          <Link className={`${failure ? 'dx-btn' : 'dx-btn-ghost'} dx-btn-sm`} href="/app/settings/integrations">{t('inspectConnection')}</Link>
        </>}
      </div>
    </div>
    <button type="button" className={s.close} onClick={() => setDismissed(true)} aria-label={t('feedback.dismiss')}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    </button>
  </section>
}
