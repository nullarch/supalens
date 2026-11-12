import type { KpiState } from './SourcesClient'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** A malformed read must not erase the last known catalog or imply that extraction finished. */
export function parseKpiRead(payload: unknown): KpiState | null {
  const data = record(payload)
  if (!data || !Array.isArray(data.kpis) || !Object.hasOwn(data, 'extraction')) return null
  const counts = { proposed: 0, accepted: 0, stale: 0 }
  for (const item of data.kpis) {
    const row = record(item)
    if (!row || !['proposed', 'accepted', 'stale', 'dismissed'].includes(String(row.status))) return null
    if (row.status === 'proposed' || row.status === 'accepted' || row.status === 'stale') counts[row.status]++
  }
  if (data.extraction === null) return { extractionStatus: null, extractionAt: null, ...counts }
  const extraction = record(data.extraction)
  if (!extraction || !['running', 'completed', 'failed'].includes(String(extraction.status))) return null
  if (typeof extraction.createdAt !== 'string' || !Number.isFinite(Date.parse(extraction.createdAt))) return null
  return { extractionStatus: extraction.status as KpiState['extractionStatus'], extractionAt: extraction.createdAt, ...counts }
}
