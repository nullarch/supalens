/** Channel success is aggregated: it cannot establish that every destination received a message. */
export function notificationTestResult(value: unknown): { channels: boolean; email: boolean } | null {
  if (!value || typeof value !== 'object') return null
  const response = value as Record<string, unknown>
  if (response.ok !== true || !response.data || typeof response.data !== 'object') return null
  const data = response.data as Record<string, unknown>
  return typeof data.channels === 'boolean' && typeof data.email === 'boolean'
    ? { channels: data.channels, email: data.email } : null
}
