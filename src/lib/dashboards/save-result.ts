import type { DashboardSummary } from './types'

type Rejection = { kind: 'rejected'; reason: string; message?: string }
type Result<T> = { kind: 'confirmed'; data: T } | Rejection | { kind: 'unknown' }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)

function rejection(value: unknown): Rejection | null {
  if (!record(value) || value.ok !== false || typeof value.reason !== 'string'
    || !['unconfigured', 'unauthorized', 'not_found', 'error'].includes(value.reason)) return null
  return { kind: 'rejected', reason: value.reason, message: typeof value.message === 'string' && value.message.trim() ? value.message : undefined }
}

/** Rename/pin/delete actions acknowledge without returning a record. */
export function reportChangeResult(value: unknown): Result<void> {
  const failed = rejection(value)
  if (failed) return failed
  return record(value) && value.ok === true ? { kind: 'confirmed', data: undefined } : { kind: 'unknown' }
}

/** A successful transport is not enough: creation needs a usable destination. */
export function reportCreationResult(value: unknown): Result<{ id: string; slug: string }> {
  const failed = rejection(value)
  if (failed) return failed
  if (record(value) && value.ok === true && record(value.data) && identifier(value.data.id) && slug(value.data.slug)) {
    return { kind: 'confirmed', data: { id: value.data.id, slug: value.data.slug } }
  }
  return { kind: 'unknown' }
}

export function reportWidgetResult(value: unknown): Result<{ id: string }> {
  const failed = rejection(value)
  if (failed) return failed
  if (record(value) && value.ok === true && record(value.data) && identifier(value.data.id)) return { kind: 'confirmed', data: { id: value.data.id } }
  return { kind: 'unknown' }
}

/** Reject malformed reads rather than presenting them as an empty report list. */
export function reportPickerRows(value: unknown): DashboardSummary[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  for (const row of value) {
    if (!record(row) || !identifier(row.id) || !slug(row.slug) || typeof row.name !== 'string'
      || typeof row.pinned !== 'boolean' || typeof row.position !== 'number' || !Number.isFinite(row.position) || ids.has(row.id)) return null
    ids.add(row.id)
  }
  return value as DashboardSummary[]
}

/** Visualization specs are JSON payloads. Equal payloads survive parent rerenders;
 * a different source or visualization starts a separate save session. */
export function reportSaveScope(spec: unknown, source?: string | null): string {
  try { return JSON.stringify([source ?? null, spec]) }
  catch { return JSON.stringify([source ?? null, 'invalid-spec']) }
}
