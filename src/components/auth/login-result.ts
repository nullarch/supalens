export type LoginProvider = 'google' | 'kakao' | 'github'
export type LoginMethod = LoginProvider | 'email'

/** Interpret the SDK acknowledgement, never user authentication or inbox delivery. */
export function loginResult(value: unknown, method: LoginMethod) {
  if (!value || typeof value !== 'object') return 'unknown' as const
  const result = value as Record<string, unknown>
  if (result.error && typeof result.error === 'object') {
    const { code } = result.error as { code?: unknown }
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'rateLimited' as const
    if (code === 'email_address_invalid' || code === 'validation_failed') return 'invalidRequest' as const
    if (code === 'provider_disabled' || code === 'email_provider_disabled') return 'unavailable' as const
    return 'unknown' as const
  }
  if (result.error !== null || !result.data || typeof result.data !== 'object') return 'unknown' as const
  const data = result.data as Record<string, unknown>
  if (method === 'email') return data.user === null && data.session === null ? 'acknowledged' as const : 'unknown' as const
  if (data.provider !== method || typeof data.url !== 'string') return 'unknown' as const
  try {
    const url = new URL(data.url)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return 'unknown' as const
    return 'acknowledged' as const
  } catch { return 'unknown' as const }
}
