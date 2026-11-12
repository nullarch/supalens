import type { ApiKeySummary } from '@/lib/mcp/keys'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Treat malformed or failed reads as unknown, never as an empty key list. */
export function readKeyList(value: unknown): ApiKeySummary[] | null {
  if (!record(value) || !Array.isArray(value.keys)) return null
  const nullableString = (v: unknown) => v === null || typeof v === 'string'
  const ids = new Set<string>()
  for (const key of value.keys) {
    if (!record(key) || typeof key.id !== 'string' || !key.id || ids.has(key.id)
      || typeof key.prefix !== 'string' || !nullableString(key.lastFour)
      || !Array.isArray(key.scopes) || !key.scopes.every(v => typeof v === 'string')
      || typeof key.createdAt !== 'string' || !nullableString(key.lastUsedAt)
      || !nullableString(key.revokedAt)) return null
    ids.add(key.id)
  }
  return value.keys as ApiKeySummary[]
}

export function readMintedToken(value: unknown): string | null {
  if (!record(value) || typeof value.token !== 'string' || !value.token.trim()) return null
  return value.token
}

export function isRevoked(value: unknown): boolean {
  return record(value) && value.revoked === true
}

export function keyLastUsed(value: string | null, locale: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(value))
}
