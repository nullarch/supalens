'use client'

import { useRef, useState } from 'react'
import type { InitializePaddleOptions, PaddleEventData } from '@paddle/paddle-js'
import { ProxyCheckoutClient, type ProxyCheckoutIO } from '@/app/proxy/checkout/checkout-client'

export function CheckoutHostPreview({ mode }: { mode: string }) {
  const [target, setTarget] = useState('A')
  const [calls, setCalls] = useState<unknown[]>([])
  const callbacks = useRef<Record<string, InitializePaddleOptions['eventCallback']>>({})
  const record = (value: unknown) => setCalls(previous => [...previous, value])
  const emit = (name: string, key = target, transaction = `txn_sample${key}`) => callbacks.current[key]?.({ name, data: { transaction_id: transaction } } as PaddleEventData)
  const io: ProxyCheckoutIO = {
    initialize: async options => {
      callbacks.current[target] = options.eventCallback
      if (mode === 'loading') return new Promise(() => {})
      if (mode === 'error') throw new Error('PRIVATE_PROVIDER_ERROR')
      if (mode === 'undefined') return undefined
      return { Checkout: { open: settings => {
        record({ action: 'open', settings })
        if (mode === 'open-throw') throw new Error('PRIVATE_OPEN_ERROR')
        if (mode === 'opening') return
        queueMicrotask(() => {
          emit('checkout.loaded')
          if (mode === 'closed') emit('checkout.closed')
          if (mode === 'completed' || mode === 'navigation-failed') emit('checkout.completed')
        })
      } } }
    },
    navigate: url => {
      record({ action: 'navigate', url })
      if (mode === 'navigation-failed') throw new Error('PRIVATE_NAVIGATION_ERROR')
    },
  }
  return <>
    <aside style={{ padding: 16, fontSize: 13, color: 'var(--ink-2)' }}>
      <p>LOCAL FIXTURE · No payment provider, real transaction, subscription or partner navigation.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
        <button onClick={() => emit('checkout.closed')}>Close sample</button>
        <button onClick={() => emit('checkout.completed')}>Complete sample</button>
        <button onClick={() => emit('checkout.error')}>Error sample</button>
        <button onClick={() => emit('checkout.completed', target, 'txn_unrelated')}>Unrelated sample</button>
        <button onClick={() => setTarget('B')}>Change transaction</button>
        <button onClick={() => emit('checkout.completed', 'A')}>Old sample callback</button>
      </div>
      <details><summary>Local calls</summary><pre data-checkout-calls style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(calls)}</pre></details>
    </aside>
    <ProxyCheckoutClient transactionId={`txn_sample${target}`} partnerName={mode === 'long' ? 'Northstar国際サービス글로벌'.repeat(18) : 'Northstar'} customerEmail="sample@example.invalid"
      successUrl={`https://partner.example.invalid/success?sample=${target}`} failUrl={`https://partner.example.invalid/canceled?sample=${target}`}
      clientToken="sample-only" environment="sandbox" io={io} />
  </>
}
