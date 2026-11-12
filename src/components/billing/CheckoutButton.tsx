'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { initializePaddle, type InitializePaddleOptions, type Paddle, type PaddleEventData } from '@paddle/paddle-js'

import { startCheckout, confirmCheckout } from '@/lib/paddle/actions'
import type { BillingInterval } from '@/lib/paddle/config'
import { track } from '@/utils/analytics'
import { billingErrorLabel } from './error-label'
import s from './CheckoutButton.module.css'

const PADDLE_LOCALES = new Set(['en', 'ko', 'ja'])
export interface CheckoutIO {
  start: typeof startCheckout
  confirm: typeof confirmCheckout
  initialize: (options: InitializePaddleOptions) => Promise<{ Checkout: Pick<Paddle['Checkout'], 'open'> } | undefined>
  refresh: () => void
  track: typeof track
}
type Phase = 'idle' | 'opening' | 'open' | 'confirming' | 'confirmed' | 'unconfirmed' | 'failure' | 'closed'

/** Paddle owns payment entry. An overlay completion event is not proof that the
 * organization's plan was updated: only the server-confirmation result is.
 * Local adapters exercise these states without loading the payment provider. */
export function CheckoutButton({ plan, interval = 'month', children, className, actions,
  disabled = false, acquire, release,
}: {
  plan: string
  interval?: BillingInterval
  children: ReactNode
  className?: string
  actions?: CheckoutIO
  disabled?: boolean
  acquire?: () => boolean
  release?: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const currentPhase = useRef<Phase>('idle')
  const mounted = useRef(true)
  const confirming = useRef(false)
  const completed = useRef(false)
  const attempt = useRef(0)
  const billingLink = useRef<HTMLAnchorElement>(null)
  const router = useRouter()
  const t = useTranslations('appBilling')
  const locale = useLocale()
  const feedbackId = useId()
  const io: CheckoutIO = actions ?? { start: startCheckout, confirm: confirmCheckout, initialize: initializePaddle, refresh: () => router.refresh(), track }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  function move(next: Phase) {
    currentPhase.current = next
    setPhase(next)
  }

  async function confirm(id: string, restoreFocus = false) {
    if (confirming.current) return
    confirming.current = true
    move('confirming')
    setError(null)
    let confirmed = false
    try {
      const result = await io.confirm(id)
      if (!mounted.current) return
      if (result.ok) {
        confirmed = true
        move('confirmed')
      } else {
        setError(billingErrorLabel(t, result.error))
        move('unconfirmed')
      }
    } catch {
      if (mounted.current) { setError(t('errors.sync_failed')); move('unconfirmed') }
    } finally {
      confirming.current = false
      if (restoreFocus) requestAnimationFrame(() => {
        // Retry disappears while confirming. Restore only abandoned focus, never
        // override a user who has already moved to another control.
        if (mounted.current && document.activeElement === document.body) billingLink.current?.focus()
      })
    }
    // Navigation failure must not rewrite a confirmed server result as payment failure.
    if (confirmed) {
      try { io.refresh() } catch { /* Confirmed state and the billing link remain available. */ }
    }
  }

  async function onClick() {
    if (disabled || !['idle', 'failure', 'closed'].includes(currentPhase.current)) return
    if (acquire && !acquire()) return
    const epoch = ++attempt.current
    const active = () => mounted.current && epoch === attempt.current
    move('opening')
    setError(null)
    setTransactionId(null)
    completed.current = false
    try {
      try { io.track('upgrade_click', { plan, interval }) } catch { /* telemetry is non-blocking */ }
      const result = await io.start(plan, interval)
      if (!active()) return
      if (!result.ok) {
        setError(billingErrorLabel(t, result.error))
        move('failure')
        release?.()
        return
      }
      const { priceId, email, orgId, clientToken, environment } = result.data
      const eventCallback = (event: PaddleEventData) => {
        if (!active()) return
        const name = String(event.name)
        if (name === 'checkout.completed' && !completed.current) {
          completed.current = true
          const id = event.data?.transaction_id
          if (!id || !/^txn_[a-zA-Z0-9]+$/.test(id)) {
            setError(t('errors.invalid_transaction_id'))
            move('unconfirmed')
            return
          }
          setTransactionId(id)
          try { io.track('upgrade_success', { plan, interval }) } catch { /* telemetry is non-blocking */ }
          void confirm(id)
        } else if (name === 'checkout.closed' && !completed.current) {
          // After an SDK error, closing must not invite a second purchase.
          if (currentPhase.current === 'unconfirmed') return
          move('closed')
          release?.()
        } else if (['checkout.error', 'checkout.failed'].includes(name) && !completed.current) {
          setError(t('checkoutOpenFailed'))
          move('unconfirmed')
        }
      }
      const paddle = await io.initialize({ environment, token: clientToken, eventCallback })
      if (!active()) return
      if (!paddle) {
        setError(t('checkoutInitFailed'))
        move('failure')
        release?.()
        return
      }
      move('open')
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: email ? { email } : undefined,
        customData: { org_id: orgId },
        settings: {
          displayMode: 'overlay',
          theme: document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          locale: PADDLE_LOCALES.has(locale) ? locale : 'en',
        },
      })
    } catch {
      if (!active() || completed.current) return
      setError(t('checkoutOpenFailed'))
      // An open exception may happen after the hosted window appeared.
      if (currentPhase.current === 'open' || currentPhase.current === 'unconfirmed') move('unconfirmed')
      else { move('failure'); release?.() }
    }
  }

  const locked = !['idle', 'failure', 'closed'].includes(phase)
  const status = phase === 'opening' ? t('opening') : phase === 'open' ? t('checkoutState.open')
    : phase === 'confirming' ? t('confirming') : phase === 'confirmed' ? t('upgraded')
      : phase === 'unconfirmed' ? t('checkoutState.unconfirmed') : phase === 'closed' ? t('checkoutState.closed') : null
  const buttonLabel = phase === 'opening' ? t('opening') : phase === 'open' ? t('checkoutState.openLabel')
    : phase === 'confirming' ? t('confirming') : phase === 'confirmed' ? t('checkoutState.confirmedLabel')
      : phase === 'unconfirmed' ? t('checkoutState.unconfirmedLabel') : children

  return <>
    <button type="button" onClick={onClick} disabled={disabled || locked} className={className}
      aria-describedby={phase === 'idle' ? undefined : feedbackId}>
      {buttonLabel}
    </button>
    {phase !== 'idle' && <div id={feedbackId} data-checkout-phase={phase}
      className={[s.feedback, phase === 'failure' ? s.failure : phase === 'unconfirmed' ? s.unconfirmed : phase === 'confirmed' ? s.confirmed : ''].join(' ')}>
      <div role={error ? 'alert' : 'status'}>{status && <p>{status}</p>}{error && <p>{error}</p>}</div>
      {(phase === 'unconfirmed' || phase === 'confirmed' || phase === 'closed') && <div className={s.recovery}>
        {phase === 'unconfirmed' && transactionId && <button type="button" onClick={() => void confirm(transactionId, true)}>{t('checkoutState.retryConfirmation')}</button>}
        {/* A full GET reruns billing reconciliation instead of reusing a cached current route. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a ref={billingLink} href="/app/settings/billing">{t('checkoutState.reviewBilling')}</a>
      </div>}
    </div>}
  </>
}
