/**
 * The 감시 screen has ONE route, /app/monitors, and two URL-driven views: the monitors list
 * (default) and the incidents queue (`?view=incidents`). A monitor and an incident are the same
 * object in two states, so they share a route instead of owning two sidebar rows.
 *
 * Pure (no React, no server imports) so the page, the view components, the /app/incidents redirect
 * and the pin test all build the same links from one place.
 */

export type MonitorsView = 'monitors' | 'incidents'

/** Switch order = the order an operator reads them in: what is watched, then what it caught. */
export const MONITORS_VIEWS: MonitorsView[] = ['monitors', 'incidents']

/** Anything that is not the incidents view falls back to the monitors list (the default view). */
export function parseMonitorsView(value: string | null | undefined): MonitorsView {
  return value === 'incidents' ? 'incidents' : 'monitors'
}

/**
 * A link into the 감시 screen. `status` is the incidents queue's own filter and only rides along on
 * that view; its default ('openish', what `parseFilter` falls back to) is left out so the queue's
 * resting URL stays clean. The path is fixed, so an unvalidated `status` is only ever a query value
 * the target re-validates — never a redirect target.
 */
export function monitorsViewHref(view: MonitorsView, status?: string | null): string {
  if (view !== 'incidents') return '/app/monitors'
  const params = new URLSearchParams({ view: 'incidents' })
  if (status && status !== 'openish') params.set('status', status)
  return `/app/monitors?${params.toString()}`
}
