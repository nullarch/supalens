export function inviteResult(value: unknown): { emailSent: boolean; link: string } | null {
  if (!value || typeof value !== 'object') return null
  const response = value as Record<string, unknown>
  if (response.ok !== true || !response.data || typeof response.data !== 'object') return null
  const data = response.data as Record<string, unknown>
  if (typeof data.token !== 'string' || !data.token || typeof data.emailSent !== 'boolean' || typeof data.link !== 'string') return null
  try {
    const url = new URL(data.link)
    if (!['http:', 'https:'].includes(url.protocol) || !/^\/app\/invite\/[^/]+$/.test(url.pathname)) return null
  } catch { return null }
  return { emailSent: data.emailSent, link: data.link }
}
