'use client'

import { useEffect, useRef, useState } from 'react'
import { LoginForm } from '@/components/auth/LoginForm'
import type { LoginMethod } from '@/components/auth/login-result'

/** Complete local adapter: no SDK client, OAuth navigation, email or auth writes. */
export function LoginPreview({ mode }: { mode: string }) {
  const [ready, setReady] = useState(false)
  const [next, setNext] = useState('/app/settings/billing?plan=basic')
  const [calls, setCalls] = useState<unknown[]>([])
  const attempts = useRef(0)
  useEffect(() => { setReady(true) }, [])
  async function run(method: LoginMethod, redirectTo: string, email?: string) {
    setCalls(previous => [...previous, { method, redirectTo, ...(email ? { email } : {}) }])
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 1000 : 60))
    if (mode === 'throw') throw new Error('Private simulated auth failure')
    if (mode === 'malformed') return { error: null, data: {} }
    if (mode === 'failure' || (mode === 'retry' && attempts.current++ === 0)) return { error: { message: 'Private simulated auth failure' } }
    if (mode === 'rate-limit') return { error: { code: 'over_request_rate_limit' } }
    if (mode === 'invalid') return { error: { code: 'validation_failed' } }
    if (mode === 'unavailable') return { error: { code: 'provider_disabled' } }
    return { error: null, data: method === 'email' ? { user: null, session: null } : { provider: method, url: 'https://auth.example.invalid/authorize' } }
  }
  return <div data-entry-ready={ready}>
    <button type="button" onClick={() => setNext('/app/overview')} style={{ fontSize: 13, marginBottom: 20 }}>Change sample destination</button>
    <LoginForm next={next} io={{ configured: mode !== 'unconfigured', social: (provider, redirect) => run(provider, redirect), email: (email, redirect) => run('email', redirect, email) }} />
    <details style={{ marginTop: 24 }}><summary>Local fixture calls</summary><output data-login-calls style={{ overflowWrap: 'anywhere' }}>{JSON.stringify(calls)}</output></details>
  </div>
}
