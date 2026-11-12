import { healthOf, type MonitorHealth } from '@/lib/alerts/health'
import { isConnectionErrorCode } from '@/lib/supabase-oauth/errors'

export type DisplayHealth = MonitorHealth | 'pending'

/** Only stored, recognized faults on enabled monitors justify the recovery notice. */
export function reconnectMonitorCount(monitors: readonly { enabled: boolean; lastError: string | null }[]): number {
  return monitors.filter(monitor => monitor.enabled && isConnectionErrorCode(monitor.lastError)).length
}

/** A normal initial status is not evidence of a successful first evaluation. */
export function monitorDisplayHealth(a: Parameters<typeof healthOf>[0] & { lastCheckedAt: string | null }): DisplayHealth {
  const health = healthOf(a)
  return health === 'healthy' && !a.lastCheckedAt ? 'pending' : health
}

export function monitorSummary(counts: Record<DisplayHealth | 'all', number>): DisplayHealth | 'empty' {
  if (!counts.all) return 'empty'
  for (const status of ['incident', 'error', 'pending', 'healthy', 'paused'] as const) {
    if (counts[status] > 0) return status
  }
  return 'empty'
}
