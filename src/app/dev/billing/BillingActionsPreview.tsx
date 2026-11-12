'use client'

import { useMemo, useRef, useState } from 'react'
import type { PaddleEventData } from '@paddle/paddle-js'
import { PlanCards } from '@/components/billing/PlanCards'
import { PlanActions } from '@/components/billing/PlanActions'
import type { CheckoutIO } from '@/components/billing/CheckoutButton'
import type { BillingPortalIO } from '@/components/billing/use-billing-portal'
import { BaseModal } from '@/components/modals/base-modal'
import { ModalButton } from '@/components/modals/controls'
import billingStyles from '@/app/app/settings/billing/billing.module.css'

export function BillingActionsPreview({ mode }: { mode: string }) {
  const [calls, setCalls] = useState<Array<{ name: string; value?: unknown }>>([])
  const [open, setOpen] = useState(false)
  const callback = useRef<((event: PaddleEventData) => void) | undefined>(undefined)
  const previousCallback = useRef<typeof callback.current>(undefined)
  const restored = useRef(false)
  const actions = useMemo<{ checkout: CheckoutIO; portal: BillingPortalIO }>(() => {
    const record = (name: string, value?: unknown) => setCalls(old => [...old, { name, value }])
    const delay = () => new Promise(resolve => setTimeout(resolve, 500))
    return {
      checkout: {
        start: async (plan, interval) => {
          record('start', { plan, interval }); await delay()
          if (!restored.current && mode === 'start-throw') throw new Error('Sample request failure')
          if (!restored.current && mode === 'start-failure') return { ok: false, error: 'forbidden' }
          return { ok: true, data: { priceId: 'pri_sample', email: 'sample@example.invalid', orgId: 'org_sample', clientToken: 'not-a-real-token', environment: 'sandbox' } }
        },
        initialize: async options => {
          record('initialize', { environment: options.environment }); await delay()
          if (!restored.current && mode === 'init-throw') throw new Error('Sample initialization failure')
          if (!restored.current && mode === 'init-failure') return undefined
          previousCallback.current = callback.current
          callback.current = options.eventCallback
          return { Checkout: { open: params => {
            record('open', params)
            if (!restored.current && mode === 'open-throw') throw new Error('Sample open failure')
            setOpen(true)
          } } }
        },
        confirm: async id => {
          record('confirm', id); await delay()
          if (!restored.current && mode === 'confirm-throw') throw new Error('Sample confirmation failure')
          return { ok: restored.current || !['confirm-failure', 'pending'].includes(mode), error: mode === 'pending' ? 'transaction_ready' : 'sync_failed' }
        },
        refresh: () => { record('refresh'); if (mode === 'refresh-throw') throw new Error('Sample refresh failure') },
        track: (name, value) => { record(name, value); if (mode === 'telemetry-throw') throw new Error('Sample telemetry failure') },
      },
      portal: {
        open: async () => {
          record('portal'); await delay()
          if (!restored.current && mode === 'portal-throw') throw new Error('Sample portal failure')
          if (!restored.current && mode === 'portal-failure') return { ok: false, error: 'forbidden' }
          return { ok: true, url: !restored.current && mode === 'portal-invalid' ? 'javascript:invalid' : 'https://example.invalid/billing' }
        },
        navigate: url => record('navigate', url),
      },
    }
  }, [mode])
  function emit(name: string, id?: string) {
    callback.current?.({ name, data: id ? { transaction_id: id } : undefined } as PaddleEventData)
  }
  function close() { setOpen(false); emit('checkout.closed') }
  function complete() {
    emit('checkout.completed', mode === 'missing-transaction' ? undefined : 'txn_sample123')
    // Duplicate SDK deliveries and a subsequent close must not create extra confirmations.
    emit('checkout.completed', 'txn_sample123')
    close()
  }
  const paid = mode.startsWith('portal-')
  return <>
    {paid && <section data-portal-banner className={billingStyles.banner} style={{ marginTop: 24, paddingBottom: 28 }}>
      <PlanActions plan="basic" hasBilling actions={actions.portal} />
    </section>}
    <PlanCards currentPlan={paid ? 'basic' : 'free'} billingConfigured yearlyAvailable actions={actions} />
    <aside style={{ marginTop: 24, fontSize: 12, overflowWrap: 'anywhere', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="dx-btn-ghost" onClick={() => { restored.current = true }}>Restore sample responses</button>
      <button className="dx-btn-ghost" onClick={() => previousCallback.current?.({ name: 'checkout.completed', data: { transaction_id: 'txn_old' } } as PaddleEventData)}>Emit old checkout callback</button>
      <pre data-billing-calls style={{ whiteSpace: 'pre-wrap', font: 'inherit', marginTop: 12 }}>{JSON.stringify(calls)}</pre>
    </aside>
    <BaseModal open={open} onClose={close} title="Sample checkout event controls"
      description="Local simulation only. This is not the Paddle checkout UI and does not collect payment information."
      footer={<><ModalButton variant="ghost" onClick={close}>Close sample checkout</ModalButton><ModalButton onClick={complete}>Complete sample checkout</ModalButton></>}>
      <ModalButton variant="ghost" onClick={() => { emit('checkout.error'); close() }}>Simulate checkout error</ModalButton>
    </BaseModal>
  </>
}
