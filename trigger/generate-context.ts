import { task, metadata } from '@trigger.dev/sdk'

import './sentry'
import { runContextGeneration } from '@/lib/context/generate'
import { markContextFailed } from '@/lib/context/service'
import { openContextRunRow, closeContextRunRow } from '@/lib/context/run-record'
import { getInstallationToken } from '@/lib/github-app/installation-token'
import type { CodeChunk } from '@/lib/code-agent/run-code-analysis'
import { persistableError } from '@/lib/supabase-oauth/errors'

interface GenerateContextPayload {
  orgId: string
  dataSourceId: string
  repoId: string
  installationId: number
  fullName: string
  runId: string
  ref?: string
  sparsePaths?: string[]
  withDb: boolean
  userId?: string
  model?: string
  maxTurns?: number
}

/** push-channel → AsyncIterable bridge (same as trigger/analyze-code.ts) for Realtime streaming. */
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
 * Generate a code-aware (tier-2) context doc for a data source from its attached repo. Mints the
 * installation token HERE on the host (never in the BFF payload / subprocess), clones + runs the
 * code × DB agent, and persists the SUPALENS.md. Streams progress via metadata.stream('agent').
 */
export const generateContext = task({
  id: 'generate-context',
  machine: 'medium-1x', // agent session + claude subprocess + clone scratch disk
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 }, // bound per repo (BFF passes concurrencyKey: repoId)
  run: async (payload: GenerateContextPayload) => {
    const ch = createChannel<CodeChunk>()
    const streamReady = metadata.stream('agent', ch.iterable)

    // Daily-cap accounting (see lib/context/run-record.ts for why this row exists).
    await openContextRunRow({
      runId: payload.runId,
      orgId: payload.orgId,
      repoId: payload.repoId,
      dataSourceId: payload.dataSourceId,
      userId: payload.userId,
      ref: payload.ref,
    })

    try {
      const token = await getInstallationToken(payload.installationId)
      const res = await runContextGeneration({
        dataSourceId: payload.dataSourceId,
        orgId: payload.orgId,
        runId: payload.runId,
        repoId: payload.repoId,
        fullName: payload.fullName,
        token,
        ref: payload.ref,
        sparsePaths: payload.sparsePaths,
        withDb: payload.withDb,
        userId: payload.userId,
        model: payload.model,
        maxTurns: payload.maxTurns,
        emit: (c) => ch.push(c),
      })
      ch.close()
      await streamReady.catch(() => {})
      await closeContextRunRow(payload.runId, res.ok, res.error)
      return res
    } catch (err) {
      ch.close()
      await streamReady.catch(() => {})
      // token mint / unexpected failure before runContextGeneration persisted a status
      await markContextFailed(payload.dataSourceId, payload.orgId, persistableError(err, String(err).slice(0, 200)))
      await closeContextRunRow(payload.runId, false, String(err))
      throw err
    }
  },
})
