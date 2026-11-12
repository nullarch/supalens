'use client'

import { useEffect } from 'react'

import { track } from '@/utils/analytics'

/**
 * Fire one product-analytics event when a server-rendered page mounts. `oncePerSessionKey`
 * dedupes across re-renders/refreshes within a tab (sessionStorage) — used for funnel
 * milestones like `setup_started` / `setup_completed` that must not inflate on every refresh.
 */
export function TrackOnMount({
  event,
  params,
  oncePerSessionKey,
}: {
  event: string
  params?: Record<string, string | number | boolean>
  oncePerSessionKey?: string
}) {
  useEffect(() => {
    if (oncePerSessionKey) {
      try {
        if (sessionStorage.getItem(oncePerSessionKey)) return
        sessionStorage.setItem(oncePerSessionKey, '1')
      } catch {
        /* sessionStorage unavailable — fire anyway */
      }
    }
    track(event, params)
    // Fire exactly once per mount; params are static for the page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
