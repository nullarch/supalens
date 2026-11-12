import type { KpiState, SourceView } from '@/app/app/sources/SourcesClient'

export const extractSource: SourceView = {
  id: 'fixture-extract-source', name: 'Northstar / international subscription analytics', engine: 'postgres', provider: 'postgres',
  status: 'active', isOAuth: false, tableCount: 24, lastSyncedLabel: 'Sep 8, 2026 · 09:00 UTC', syncStatus: 'fresh',
  attachedRepoId: null, attachedRepoFullName: null, contextStatus: 'fresh', contextFromRepo: false,
  isDemo: false, monitorCount: 0, slackChannel: null,
  kpiExtractionStatus: null, kpiExtractionAt: null, kpiProposed: 0, kpiAccepted: 0, kpiStale: 0,
}
export const extractState: KpiState = { extractionStatus: null, extractionAt: null, proposed: 0, accepted: 0, stale: 0 }
export const EXTRACT_MODES = ['picker', 'repo', 'pending', 'quota', 'rejected', 'unknown', 'throw', 'completed', 'partial', 'failed', 'missing-status', 'controller']
