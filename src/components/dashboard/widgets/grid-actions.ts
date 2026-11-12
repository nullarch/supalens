export type GridResult = 'confirmed' | 'rejected' | 'unknown'

/** A resolved promise alone is not an acknowledgement of a saved report change. */
export function gridResult(value: unknown): GridResult {
  if (!value || typeof value !== 'object') return 'unknown'
  const ok = (value as Record<string, unknown>).ok
  return ok === true ? 'confirmed' : ok === false ? 'rejected' : 'unknown'
}

export function moveGridItem(order: string[], id: string, delta: number): string[] {
  const from = order.indexOf(id)
  if (from < 0) return order
  const to = Math.max(0, Math.min(order.length - 1, from + delta))
  if (from === to) return order
  const next = order.filter(value => value !== id)
  next.splice(to, 0, id)
  return next
}

/** Visual floor only; applying this on read must never trigger persistence. */
export function minimumGridRows(type: string, monitored = false): number {
  return ['kpi', 'bignumber', 'table'].includes(type) ? (monitored ? 4 : 3) : 5
}

export function fitGridSize(size: { w: number; h: number }, minHeight = 3) {
  return {
    w: Math.max(3, Math.min(12, Number.isFinite(size.w) ? size.w : 6)),
    h: Math.max(minHeight, Math.min(12, Number.isFinite(size.h) ? size.h : minHeight)),
  }
}

export function resizeGridItem(size: { w: number; h: number }, key: string, minHeight = 3) {
  return {
    w: Math.max(3, Math.min(12, size.w + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0))),
    h: Math.max(minHeight, Math.min(12, size.h + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0))),
  }
}
