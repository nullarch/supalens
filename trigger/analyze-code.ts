import { task, metadata } from '@trigger.dev/sdk'

import './sentry'
import { runCodeAnalysis, type CodeChunk } from '@/lib/code-agent/run-code-analysis'
import { markCodeRunning, persistCodeRun } from '@/lib/code-agent/run-record'
import { getInstallationToken } from '@/lib/github-app/installation-token'

interface AnalyzeCodePayload {
  orgId: string
  repoId: string
  installationId: number
  fullName: string
  runId: string
  question: string
  ref?: string
  beforeSha?: string
  afterSha?: string
  dataSourceId?: string
  sparsePaths?: string[]
  model?: string
  maxTurns?: number
  locale?: string
}

/** push-channel → AsyncIterable bridge (same as trigger/analyze.ts) for Realtime streaming. */
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

export const analyzeCode = task({
  id: 'analyze-code',
  machine: 'medium-1x', // agent session + claude subprocess + clone scratch disk
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 }, // bound per repo (BFF/webhook pass concurrencyKey: repoId)
  run: async (payload: AnalyzeCodePayload) => {
    const ch = createChannel<CodeChunk>()
    const streamReady = metadata.stream('agent', ch.iterable)

    try {
      await markCodeRunning(payload.runId)
      // Mint the installation token HERE on the host — never in the BFF payload, never in the
      // subprocess env. It is used only for the clone inside runCodeAnalysis.
      const token = await getInstallationToken(payload.installationId)
      const result = await runCodeAnalysis({
        runId: payload.runId,
        fullName: payload.fullName,
        token,
        question: payload.question,
        ref: payload.ref,
        dataSourceId: payload.dataSourceId,
        sparsePaths: payload.sparsePaths,
        model: payload.model,
        maxTurns: payload.maxTurns,
        locale: payload.locale,
        emit: (c) => ch.push(c),
      })
      ch.close()
      await streamReady.catch(() => {})
      await persistCodeRun(payload.runId, result)
      return result
    } catch (err) {
      ch.close()
      await streamReady.catch(() => {})
      await persistCodeRun(payload.runId, {
        ok: false,
        text: '',
        turns: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        error: String(err).slice(0, 300),
      })
      throw err
    }
  },
})
