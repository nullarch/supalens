'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { onboardingModalAllowedOn, onboardingModalDismissKey } from '@/lib/onboarding/logic'
import OnboardingModal from './OnboardingModal'

/**
 * The onboarding modal's gate: per-browser dismissal + the route decide whether it opens. It
 * waits for the dismissal read before opening, so a returning browser never sees the dialog flash.
 *
 * NOT mounted by the /app shell any more. Onboarding is one non-blocking checklist on the home
 * screen (app/overview/SetupChecklist) — an overlay here competed with it and suppressed it.
 * This component survives for the /dev/onboarding-modal design preview only.
 */
export function OnboardingModalGate({ orgId, fontClassName }: { orgId: string; fontClassName: string }) {
  const pathname = usePathname() ?? ''
  const key = onboardingModalDismissKey(orgId)
  const [state, setState] = useState<'reading' | 'show' | 'dismissed'>('reading')

  useEffect(() => {
    try {
      setState(localStorage.getItem(key) ? 'dismissed' : 'show')
    } catch {
      setState('show') // storage blocked: show it once for this page view
    }
  }, [key])

  if (state !== 'show' || !onboardingModalAllowedOn(pathname)) return null
  return (
    <OnboardingModal
      mode="live"
      fontClassName={fontClassName}
      onExit={() => {
        try {
          localStorage.setItem(key, new Date().toISOString())
        } catch {
          /* per-view only when storage is blocked */
        }
        setState('dismissed')
      }}
    />
  )
}
