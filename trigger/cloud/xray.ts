import { metadata, task } from '@trigger.dev/sdk'

import '../sentry'
import { runCodeAnalysis, type CodeChunk } from '@/lib/code-agent/run-code-analysis'
import { cloneInfo } from '@/lib/xray/clone-info'
import { XRAY_MAX_TOTAL_TOKENS, XRAY_MAX_TURNS } from '@/lib/xray/config'
import type { XrayEvent } from '@/lib/xray/events'
import { xrayQuestion, XRAY_SYSTEM_PROMPT } from '@/lib/xray/prompt'
import { finalizeReport } from '@/lib/xray/schema'
import { completeScan, failScan, markScanRunning, recordCloneInfo } from '@/lib/xray/service'
import { buildXrayTools, createXraySink, XRAY_TOOLS } from '@/lib/xray/tools'

interface XrayPayload {
  reportId: string
  /** display casing "Owner/Repo" — validated by the BFF (parseRepoInput + GitHub lookup) */
  fullName: string
  defaultBranch: string
  locale: string
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

/** Code-agent chunks → the scan page's events. Tool inputs are model-written: trimmed, shown as text only. */
function toEvent(chunk: CodeChunk): XrayEvent | null {
  if (chunk.type !== 'tool_use') return null
  const input = (chunk.input ?? {}) as Record<string, unknown>
  const name = chunk.tool.replace(/^mcp__[a-z_]+__/, '')
  if (name === 'read_file' && typeof input.path === 'string') return { type: 'read', path: input.path.slice(0, 200) }
  if (name === 'grep_code' && typeof input.pattern === 'string') return { type: 'search', pattern: input.pattern.slice(0, 120) }
  if (name === 'note' && typeof input.text === 'string') {
    const kind = input.kind === 'entity' || input.kind === 'rule' || input.kind === 'kpi' || input.kind === 'trap' ? input.kind : 'rule'
    const count = typeof input.count === 'number' && Number.isFinite(input.count) ? Math.max(1, Math.min(50, Math.floor(input.count))) : undefined
    return { type: 'note', kind, text: input.text.slice(0, 160), count }
  }
  if (name === 'submit_xray') return { type: 'writing' }
  return null
}

/**
 * One public X-ray: anonymous shallow clone → the locked-down code agent (read-only file tools +
 * note/submit_xray) → a verified, graded report. Reuses runCodeAnalysis VERBATIM for the
 * lockdown (env-stripped subprocess, tools:[], deny-gate, token budget); only the prompt and the
 * two report tools differ. Retries OFF (global config): a retry would pay for the scan twice.
 */
export const xrayScan = task({
  id: 'xray-scan',
  machine: 'medium-1x', // agent session + claude subprocess + clone scratch disk
  maxDuration: 900,
  queue: { concurrencyLimit: 4 }, // matches XRAY_MAX_INFLIGHT; the BFF refuses beyond it
  run: async (payload: XrayPayload) => {
    const ch = createChannel<XrayEvent>()
    const streamReady = metadata.stream('xray', ch.iterable)
    const sink = createXraySink()
    let filesTotal: number | null = null

    try {
      await markScanRunning(payload.reportId)
      const result = await runCodeAnalysis({
        runId: payload.reportId,
        fullName: payload.fullName,
        ref: payload.defaultBranch,
        question: xrayQuestion(payload.fullName),
        systemPrompt: XRAY_SYSTEM_PROMPT,
        locale: payload.locale,
        maxTurns: XRAY_MAX_TURNS,
        maxTotalTokens: XRAY_MAX_TOTAL_TOKENS,
        extraServers: (dir) => [{ name: 'supalens_xray', server: buildXrayTools(dir, sink), tools: XRAY_TOOLS }],
        onCloned: async (dir) => {
          const info = await cloneInfo(dir)
          filesTotal = info.fileCount
          ch.push({ type: 'cloned', files: info.fileCount })
          await recordCloneInfo(payload.reportId, info)
        },
        emit: (chunk) => {
          const event = toEvent(chunk)
          if (event) ch.push(event)
        },
      })

      const usage = { costUsd: result.costUsd, tokensIn: result.tokensIn, tokensOut: result.tokensOut }
      if (sink.report) {
        await completeScan(payload.reportId, { report: finalizeReport(sink.report, filesTotal), ...usage })
        ch.push({ type: 'done', ok: true })
      } else {
        const code = result.error?.includes('git clone failed') ? 'clone_failed' : result.error?.includes('budget') ? 'budget' : 'no_report'
        await failScan(payload.reportId, code, usage)
        ch.push({ type: 'done', ok: false })
      }
      ch.close()
      await streamReady.catch(() => {})
      return { ok: Boolean(sink.report), turns: result.turns, costUsd: result.costUsd }
    } catch (err) {
      await failScan(payload.reportId, 'task_error').catch(() => {})
      ch.push({ type: 'done', ok: false })
      ch.close()
      await streamReady.catch(() => {})
      throw err
    }
  },
})
