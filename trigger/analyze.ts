import { task, metadata } from '@trigger.dev/sdk'

import './sentry'
import { runAnalysis, type AnalysisChunk } from '@/lib/agent/run-analysis'
import { markRunning, persistRun, persistFailedRun } from '@/lib/agent/run-record'
import { readOrgTimezone } from '@/lib/org/timezone'
import { requireAdminClient } from '@/utils/supabase/admin'

interface AnalyzePayload {
  orgId: string
  dataSourceId: string
  userId: string
  runId: string
  question: string
  model?: string
  maxTurns?: number
  locale?: string
  /** 'monitor' = goal → monitor drafting run (the BFF's `intent`); absent = a normal question */
  intent?: 'monitor'
  /** drafting runs: the operator's goal, verbatim (the agent question is the framed version) */
  goal?: string
}

/** Minimal push-channel → AsyncIterable bridge so runAnalysis's emit() callback can feed
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

export const analyze = task({
  id: 'analyze',
  machine: 'medium-1x', // ~2GiB — agent session + claude subprocess. tune after measuring.
  maxDuration: 3600,
  // bound concurrency PER data source (the BFF passes concurrencyKey: dataSourceId):
  // protects the tenant DB + the connection pool from a burst of agent runs.
  queue: { concurrencyLimit: 2 },
  run: async (payload: AnalyzePayload) => {
    const ch = createChannel<AnalysisChunk>()
    // register the Realtime stream (consumed concurrently as we push). Don't await yet.
    const streamReady = metadata.stream('agent', ch.iterable)

    try {
      // claim failed → the run was cancelled/reaped (or already claimed) before we started;
      // running the agent anyway would burn LLM budget on a run whose result can never persist.
      if (!(await markRunning(payload.runId))) {
        ch.close()
        await streamReady.catch(() => {})
        return { ok: false, skipped: 'not_claimable' }
      }
      // drafting runs validate the series against the org's day boundary (in-progress day skipped)
      const monitorDraft =
        payload.intent === 'monitor' && payload.goal
          ? { goal: payload.goal, timezone: (await readOrgTimezone(requireAdminClient(), payload.orgId)).timezone }
          : undefined
      const result = await runAnalysis({
        orgId: payload.orgId,
        dataSourceId: payload.dataSourceId,
        userId: payload.userId,
        runId: payload.runId,
        question: payload.question,
        model: payload.model,
        maxTurns: payload.maxTurns,
        locale: payload.locale,
        monitorDraft,
        emit: (c) => ch.push(c),
      })
      ch.close()
      await streamReady.catch(() => {})
      await persistRun(payload.runId, result)
      return result
    } catch (err) {
      // persist a terminal failed state so the row never sticks at 'running'
      ch.close()
      await streamReady.catch(() => {})
      await persistFailedRun(payload.runId, err)
      throw err
    }
  },
})
