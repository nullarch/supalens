'use client'

import { useEffect, useRef, useState } from 'react'

/** Only the mounted report/workspace may handle its action response. The ref
 * closes the gap before React renders disabled controls after the first click. */
export function useReportOperation() {
  const mounted = useRef(false)
  const locked = useRef(false)
  const stopped = useRef(false)
  const [pending, setPending] = useState(false)
  const [paused, setPaused] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return {
    pending, paused,
    current: () => mounted.current,
    begin: () => {
      if (!mounted.current || locked.current || stopped.current) return false
      locked.current = true; setPending(true); return true
    },
    finish: () => { if (mounted.current) { locked.current = false; setPending(false) } },
    pause: () => { stopped.current = true; setPaused(true) },
    canClose: () => !locked.current,
  }
}
