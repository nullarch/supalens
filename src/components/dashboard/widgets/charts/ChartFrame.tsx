'use client'

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ResponsiveContainer } from 'recharts'
import { ANIM_MS } from '../theme'

/** Honors prefers-reduced-motion; charts read this to clamp Recharts animation. */
export function useChartAnim(): { isAnimationActive: boolean; animationDuration: number } {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return { isAnimationActive: !reduced, animationDuration: ANIM_MS }
}

/**
 * Sizing wrapper for every Recharts chart. ResponsiveContainer measures the DOM,
 * so chart widgets are loaded with next/dynamic({ssr:false}); the explicit height
 * keeps layout stable (no CLS) while the chart hydrates.
 */
export function ChartFrame({ height = 240, children }: { height?: number | `${number}%`; children: ReactElement }) {
  // debounce coalesces the ResizeObserver storm during a live drag-resize into one
  // reflow per ~80ms (cheap now; essential once the dashboard grid resizes cards).
  return (
    <ResponsiveContainer width="100%" height={height} debounce={80}>
      {children}
    </ResponsiveContainer>
  )
}
