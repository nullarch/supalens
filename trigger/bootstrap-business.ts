import { task, metadata } from '@trigger.dev/sdk'

import './sentry'
import { runBootstrapBusiness } from '@/lib/bootstrap/run'
import type { BootstrapEvent, BootstrapPhase } from '@/lib/bootstrap/events'
import type { KpiCategory } from '@/lib/kpi/types'

export interface BootstrapBusinessPayload {
  orgId: string
  dataSourceId: string
  /** Correlation id; also the context generation's runId + run-row id. */
  runId: string
  /** Created by the BFF before triggering, so a concurrent scan 409s without spending anything. */
  extractionId: string
  tier: 1 | 2
  /** Phases a retry must not redo. */
  skipPhases?: BootstrapPhase[]
  categories?: KpiCategory[]
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
  withDb: boolean
  userId?: string
}

/** push-channel → AsyncIterable bridge (same as trigger/generate-context.ts) for Realtime. */
function createChannel<T>() {
  const buffer: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  return {
    push(v: T) {
      buffer.push(v)
      wake?.()
      wake = null
    },
    close() {
      closed = true
      wake?.()
      wake = null
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (buffer.length) {
            yield buffer.shift() as T
            continue
          }
          if (closed) return
          await new Promise<void>((r) => {
            wake = r
          })
        }
      },
    } as AsyncIterable<T>,
  }
}

/**
 * The onboarding scan: schema sync → SUPALENS.md → KPI proposals, as ONE job.
 *
 * It is orchestration only — `src/lib/bootstrap/run.ts` calls the same functions the standalone
 * `generate-context` and `extract-kpis` tasks call, so there is no second copy of that logic and
 * no second metering seam (each underlying run still increments usage exactly once, inside
 * itself). The standalone tasks remain the maintenance path used from /app/sources and MCP.
 *
 * No retries (the global default): an agent run is not idempotent, and a replay would clone,
 * re-author and re-extract at full cost. A failed scan is resumed explicitly from the setup
 * screen, and resumes from the last phase that actually succeeded.
 */
export const bootstrapBusiness = task({
  id: 'bootstrap-business',
  machine: 'medium-1x', // agent session + claude subprocess + clone scratch disk
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 }, // BFF passes concurrencyKey: dataSourceId
  run: async (payload: BootstrapBusinessPayload) => {
    const ch = createChannel<BootstrapEvent>()
    const streamReady = metadata.stream('agent', ch.iterable)
    try {
      const res = await runBootstrapBusiness({ ...payload, emit: (e) => ch.push(e) })
      ch.close()
      await streamReady.catch(() => {})
      return res
    } catch (err) {
      // runBootstrapBusiness stamps each phase's own terminal state (markContextFailed /
      // failExtraction) before it rethrows, so nothing can stick at 'running'. Rethrow so the
      // global tasks.onFailure Sentry hook fires.
      ch.close()
      await streamReady.catch(() => {})
      throw err
    }
  },
})
