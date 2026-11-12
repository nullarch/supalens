import { task } from '@trigger.dev/sdk'

import './sentry'
import { runKpiExtraction, type RunKpiExtractionArgs } from '@/lib/kpi/run-extraction'
import type { KpiCategory } from '@/lib/kpi/types'

export interface ExtractKpisPayload {
  orgId: string
  dataSourceId: string
  extractionId: string
  tier: 1 | 2
  /** Major-category scope from the extraction modal; absent = every category. */
  categories?: KpiCategory[]
  // tier-2 only (repo attached):
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
  userId?: string
  model?: string
  maxTurns?: number
}

/**
 * Run the KPI-extraction agent for a data source and persist its validated proposals. Mirrors
 * trigger/generate-context.ts: `import './sentry'` (global tasks.onFailure captures any rethrow),
 * same machine / maxDuration / concurrency, and the global no-retry default (an agent run is not
 * idempotent — a KPI extraction should not auto-replay).
 *
 * The extraction itself lives in `src/lib/kpi/run-extraction.ts` so the unified onboarding scan
 * (`trigger/bootstrap-business.ts`) runs the identical code path rather than a second copy of it.
 * This task remains the standalone entry point used by /api/data-sources/[id]/kpis/extract and MCP.
 */
export const extractKpis = task({
  id: 'extract-kpis',
  machine: 'medium-1x', // agent session + claude subprocess (+ clone scratch disk for tier-2)
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 }, // BFF passes concurrencyKey: repoId ?? dataSourceId
  run: async (payload: ExtractKpisPayload) => {
    return runKpiExtraction(payload satisfies RunKpiExtractionArgs)
  },
})
