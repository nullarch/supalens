'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { initializePaddle, type InitializePaddleOptions, type Paddle } from '@paddle/paddle-js'
import LogoMark from '@/components/brand/LogoMark'
import type { PaddleEnv } from '@/lib/paddle/config'
import s from './checkout.module.css'

export type ProxyCheckoutIO = {
  initialize: (options: InitializePaddleOptions) => Promise<{ Checkout: Pick<Paddle['Checkout'], 'open'> } | undefined>
  navigate: (url: string) => void
}
type Props = {
  transactionId: string
  partnerName: string
  customerEmail: string | null
  successUrl: string
  failUrl: string
  clientToken: string
  environment: PaddleEnv
  io?: ProxyCheckoutIO
}
type Phase = 'loading' | 'opening' | 'open' | 'closed' | 'completed' | 'error'

/** Opens only the existing transaction. The completion redirect is UX, never
 * fulfillment authority; webhook relay / pull API remains the source of truth. */
export function ProxyCheckoutClient(props: Props) {
  return <CheckoutController key={props.transactionId} {...props} />
}

function CheckoutController({ transactionId, partnerName, customerEmail, successUrl, failUrl, clientToken, environment, io }: Props) {
  const t = useTranslations('proxyCheckout')
  const locale = useLocale()
  const paddleRef = useRef<Awaited<ReturnType<ProxyCheckoutIO['initialize']>>>(undefined)
  const completedRef = useRef(false)
  const currentPhase = useRef<Phase>('loading')
  const active = useRef(false)
  const noticeRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  const [phase, setPhase] = useState<Phase>('loading')
  const [navigationFailed, setNavigationFailed] = useState(false)
  useEffect(() => {
    if (restoreFocus.current && document.activeElement === document.body) noticeRef.current?.focus()
    restoreFocus.current = false
  }, [phase])
  function move(next: Phase) { currentPhase.current = next; setPhase(next) }
  function navigate(url: string) {
    try { if (io) io.navigate(url); else window.location.assign(url) }
    catch { if (active.current) setNavigationFailed(true) }
  }
  function openCheckout() {
    if (!paddleRef.current || completedRef.current || !['loading', 'closed'].includes(currentPhase.current)) return
    move('opening')
    try {
      paddleRef.current.Checkout.open({
        transactionId,
        customer: customerEmail ? { email: customerEmail } : undefined,
        settings: {
          displayMode: 'overlay',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          locale: ['en', 'ko', 'ja'].includes(locale) ? locale : 'en',
        },
      })
    } catch { if (!completedRef.current) move('error') }
  }
  useEffect(() => {
    let cancelled = false
    active.current = true
    const initialize = io?.initialize ?? initializePaddle
    void (async () => {
      try {
        const paddle = await initialize({
          environment, token: clientToken,
          eventCallback: event => {
            if (cancelled || completedRef.current) return
            const data = event.data
            if (data && 'transaction_id' in data && data.transaction_id && data.transaction_id !== transactionId) return
            const name = String(event.name)
            if (name === 'checkout.completed') {
              completedRef.current = true
              move('completed')
              navigate(successUrl)
            } else if (name === 'checkout.closed') move('closed')
            else if (name === 'checkout.loaded' && currentPhase.current === 'opening') move('open')
            else if (name === 'checkout.error') move('error')
          },
        })
        if (cancelled) return
        if (!paddle) { move('error'); return }
        paddleRef.current = paddle
        openCheckout()
      } catch { if (!cancelled && !completedRef.current) move('error') }
    })()
    return () => { cancelled = true; active.current = false }
    // Initialize once for this transaction. Locale/theme changes must not reopen a payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const partner = partnerName.trim() || t('partnerFallback')
  return <main className={s.shell} data-checkout-host data-phase={phase}>
    <div className={s.content}>
      <div className={s.brand}><LogoMark size={30} /><span>supalens <small>Pay</small></span></div>
      <section className={s.card} aria-labelledby="checkout-title">
        <p className={s.eyebrow}>{t('eyebrow')}</p>
        <h1 id="checkout-title">{t('title', { partner })}</h1>
        <p className={s.description}>{t('description')}</p>
        <div ref={noticeRef} tabIndex={-1} className={s.notice} role={phase === 'error' ? 'alert' : 'status'} data-kind={phase === 'error' ? 'error' : phase === 'completed' ? 'completed' : 'neutral'}>
          <strong>{t(`states.${phase}.title`)}</strong>
          <p>{t(`states.${phase}.body`, { partner })}</p>
        </div>
        {navigationFailed && <p className={s.warning} role="alert">{t('navigationFailed')}</p>}
        {['closed', 'error', 'completed'].includes(phase) && <div className={s.actions}>
          {phase === 'closed' && <button type="button" onClick={() => { restoreFocus.current = true; openCheckout() }}>{t('reopen')}</button>}
          <a className={phase === 'closed' ? s.secondary : ''} href={phase === 'completed' ? successUrl : failUrl} onClick={event => {
            if (io) { event.preventDefault(); navigate(phase === 'completed' ? successUrl : failUrl) }
          }}>{t('return', { partner })}</a>
        </div>}
        <p className={s.help}>{t('fulfillment')}</p>
      </section>
    </div>
  </main>
}
