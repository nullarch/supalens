export type MonitorAction = 'toggle' | 'test' | 'delete'

/** A missing/malformed acknowledgement does not establish whether the action ran. */
export function monitorActionResult(value: unknown, action: MonitorAction) {
  if (!value || typeof value !== 'object') return { kind: 'unknown' as const }
  const result = value as Record<string, unknown>
  if (result.ok === false) return { kind: 'rejected' as const }
  if (result.ok !== true) return { kind: 'unknown' as const }
  if (action !== 'test') return { kind: 'confirmed' as const }
  const data = result.data as Record<string, unknown> | undefined
  if (!data || typeof data.met !== 'boolean' || typeof data.detail !== 'string' || !data.detail.trim()) return { kind: 'unknown' as const }
  return { kind: 'tested' as const, met: data.met, detail: data.detail }
}
