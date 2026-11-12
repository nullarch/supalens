import { task, metadata } from '@trigger.dev/sdk'

import './sentry'
import type { AnalysisChunk } from '@/lib/agent/run-analysis'
import { markRunning, persistRun, persistFailedRun } from '@/lib/agent/run-record'
import { runFirestoreAnalysis } from '@/lib/firestore-agent/run-firestore-analysis'

interface AnalyzeFirestorePayload {
  orgId: string
  dataSourceId: string
  userId: string
  runId: string
  question: string
  model?: string
  maxTurns?: number
  locale?: string
}

/** Minimal push-channel → AsyncIterable bridge so runFirestoreAnalysis's emit() callback can feed
 *  Trigger's Realtime stream, which the browser subscribes to with a scoped public token. */
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

/** Firestore analysis task — mirror of `analyze`, routed to by the BFF/MCP when the data source's
 *  engine is 'firestore'. Same Realtime stream ('agent') + agent_runs lifecycle, so the browser's
 *  AgentStream and the run record are identical to the SQL path. */
export const analyzeFirestore = task({
  id: 'analyze-firestore',
  machine: 'medium-1x',
  maxDuration: 3600,
  // per-data-source concurrency (BFF passes concurrencyKey: dataSourceId) — caps Firestore reads
  // (billed per document) from a burst of agent runs.
  queue: { concurrencyLimit: 2 },
  run: async (payload: AnalyzeFirestorePayload) => {
    const ch = createChannel<AnalysisChunk>()
    const streamReady = metadata.stream('agent', ch.iterable)

    try {
      // claim failed → cancelled/reaped before start; don't burn LLM budget on an unpersistable run.
      if (!(await markRunning(payload.runId))) {
        ch.close()
        await streamReady.catch(() => {})
        return { ok: false, skipped: 'not_claimable' }
      }
      const result = await runFirestoreAnalysis({
        orgId: payload.orgId,
        dataSourceId: payload.dataSourceId,
        userId: payload.userId,
        runId: payload.runId,
        question: payload.question,
        model: payload.model,
        maxTurns: payload.maxTurns,
        locale: payload.locale,
        emit: (c) => ch.push(c),
      })
      ch.close()
      await streamReady.catch(() => {})
      await persistRun(payload.runId, result)
      return result
    } catch (err) {
      ch.close()
      await streamReady.catch(() => {})
      await persistFailedRun(payload.runId, err)
      throw err
    }
  },
})
