import { mkdirSync } from 'fs'

import { query } from '@/lib/llm/agent-sdk'

import type { Actor } from '@/lib/secrets/service'
import type { KpiSink } from '@/lib/kpi/types'
import { buildDefaultTableSpec } from '@/lib/viz/spec'
import type { VisualizationSpec } from '@/lib/viz/spec'
import { getSourceContext, renderSourceContextSection } from '@/lib/context/service'
import { languageDirective } from '@/lib/i18n/agent-locale'
import { buildChildEnv, LOCKDOWN_DISALLOWED_TOOLS, makeToolGate } from './lockdown'
import { ANALYSIS_MODEL } from './models'
import { SYSTEM_PROMPT } from './system-prompt'
import { buildSqlTools } from './tools'
import { MONITOR_DRAFT_PROMPT, type MonitorDraft } from '@/lib/alerts/draft'

export type AnalysisChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'visualization'; spec: VisualizationSpec }
  | { type: 'monitor_draft'; draft: MonitorDraft }
  | { type: 'status'; status: string }

export interface AnalysisResult {
  ok: boolean
  text: string
  turns: number
  costUsd: number
  tokensIn: number
  tokensOut: number
  /** charts the agent chose for its query results (in proposal order). */
  visualizations: VisualizationSpec[]
  /** goal → monitor drafting runs: the accepted draft (the last one proposed wins). */
  monitorDraft?: MonitorDraft
  error?: string
}

export interface RunAnalysisArgs {
  orgId: string
  dataSourceId: string
  userId: string
  runId: string
  question: string
  model?: string
  maxTurns?: number
  /** hard cap on cumulative tokens (input + output); abort if exceeded. Input dominates
   *  agent-loop cost because the whole transcript (incl. tool results) is re-sent each turn. */
  maxTotalTokens?: number
  /** when set, expose propose_kpi and collect validated KPI proposals (extraction runs). */
  kpiSink?: KpiSink
  /** goal → monitor drafting run: expose propose_monitor and collect the draft. `goal` is the
   *  operator's words (bound here, never taken from the model); `timezone` the org's zone. */
  monitorDraft?: { goal: string; timezone: string }
  /** stream sink (Trigger metadata.stream, SSE, etc.). */
  emit?: (chunk: AnalysisChunk) => void | Promise<void>
  /** originating user's locale — the model answers in this language (prose only). */
  locale?: string
}

export const ALLOWED_TOOLS = ['mcp__supalens__execute_sql', 'mcp__supalens__get_schema', 'mcp__supalens__propose_visualization']

// minimal shapes for the SDK message bits we read (avoids coupling to @anthropic-ai/sdk types)
interface AssistantBlock {
  type: string
  text?: string
  name?: string
  input?: unknown
}

/**
 * Run one read-only analysis pass with the Claude Agent SDK, locked to exactly two SQL
 * tools, no built-ins, headless permissions, and a hard token budget. Streams chunks via
 * `emit`. Framework-agnostic — the Trigger.dev task wraps this.
 */
export async function runAnalysis(args: RunAnalysisArgs): Promise<AnalysisResult> {
  const actor: Actor = { kind: 'system', id: args.runId }
  const emit = args.emit ?? (() => {})
  const cwd = `/tmp/agent-run-${args.runId}`
  try {
    mkdirSync(cwd, { recursive: true })
  } catch {
    /* best-effort */
  }

  const abort = new AbortController()
  const maxTotalTokens = args.maxTotalTokens ?? 500_000
  const result: AnalysisResult = { ok: false, text: '', turns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0, visualizations: [] }

  // track the last query so we can synthesize a default table if the model proposes no chart
  let queryRan = false
  let lastSql = ''
  let lastColumns: string[] = []
  let lastRows: Record<string, unknown>[] = []

  const sqlServer = buildSqlTools(
    args.dataSourceId,
    actor,
    {
      onVisualization: (spec) => {
        result.visualizations.push(spec)
        void emit({ type: 'visualization', spec })
      },
      onQueryResult: (q) => {
        queryRan = true
        lastSql = q.sql
        lastColumns = q.columns
        lastRows = q.rows
      },
    },
    args.kpiSink,
    args.monitorDraft
      ? {
          goal: args.monitorDraft.goal,
          timezone: args.monitorDraft.timezone,
          onDraft: (draft) => {
            result.monitorDraft = draft
            void emit({ type: 'monitor_draft', draft })
          },
        }
      : undefined,
  )

  // propose_kpi is allowed only for extraction runs and propose_monitor only for drafting runs;
  // mirrors how propose_visualization sits in the base list (the allow-list is BOTH the SDK
  // allowedTools and the canUseTool defense-in-depth gate).
  const allowedTools = [
    ...ALLOWED_TOOLS,
    ...(args.kpiSink ? ['mcp__supalens__propose_kpi'] : []),
    ...(args.monitorDraft ? ['mcp__supalens__propose_monitor'] : []),
  ]

  // Inject the per-source context doc (SUPALENS.md) as a TRUSTED prompt section, if one is
  // available. Best-effort: a missing/failed context never blocks the run.
  let systemPrompt = SYSTEM_PROMPT
  try {
    const ctx = await getSourceContext(args.dataSourceId)
    if (ctx) systemPrompt += renderSourceContextSection(ctx)
  } catch (e) {
    console.error(`[agent] context load failed for ${args.dataSourceId}:`, e)
  }
  if (args.monitorDraft) systemPrompt += MONITOR_DRAFT_PROMPT
  systemPrompt += languageDirective(args.locale)

  const q = query({
    prompt: args.question,
    options: {
      model: args.model ?? ANALYSIS_MODEL,
      systemPrompt,
      mcpServers: { supalens: sqlServer },
      allowedTools,
      tools: [], // drop all built-in harness tools from the model's context
      disallowedTools: [...LOCKDOWN_DISALLOWED_TOOLS],
      settingSources: [], // ignore .mcp.json / user / project settings
      strictMcpConfig: true,
      permissionMode: 'dontAsk', // headless: anything not explicitly allowed is denied
      maxTurns: args.maxTurns ?? 25,
      includePartialMessages: true,
      abortController: abort,
      cwd,
      // REPLACE the subprocess env (env is not merged): no DB/KMS creds reach the claude
      // subprocess; only PATH/HOME/ANTHROPIC_API_KEY (+ optional non-secret proxy/TLS vars).
      env: buildChildEnv(),
      // The effective deny-by-default gate is allowedTools (exactly these two) + permissionMode
      // 'dontAsk' (anything not pre-approved is auto-denied) + disallowedTools + tools:[].
      // canUseTool is a defense-in-depth allow-list that engages under ask/default modes
      // (under 'dontAsk' the SDK auto-denies without invoking it) — keep it consistent.
      canUseTool: makeToolGate(allowedTools),
    },
  })

  try {
    for await (const msg of q) {
      if (msg.type === 'stream_event') {
        const ev = (msg as unknown as { event?: { type?: string; delta?: { text?: string } } }).event
        if (ev?.type === 'content_block_delta' && ev.delta?.text) {
          await emit({ type: 'text', text: ev.delta.text })
        }
      } else if (msg.type === 'assistant') {
        const m = (msg as unknown as {
          message?: { content?: AssistantBlock[]; usage?: { input_tokens?: number; output_tokens?: number } }
        }).message
        for (const block of m?.content ?? []) {
          if (block.type === 'tool_use') {
            await emit({ type: 'tool_use', tool: block.name ?? '?', input: block.input })
          }
        }
        result.tokensIn += m?.usage?.input_tokens ?? 0
        result.tokensOut += m?.usage?.output_tokens ?? 0
        if (result.tokensIn + result.tokensOut > maxTotalTokens) {
          await emit({ type: 'status', status: 'budget_exceeded' })
          await q.interrupt().catch(() => {})
          abort.abort()
          result.error = 'token budget exceeded'
          break
        }
      } else if (msg.type === 'result') {
        const r = msg as unknown as {
          is_error: boolean
          subtype: string
          result?: string
          num_turns: number
          total_cost_usd: number
        }
        result.ok = !r.is_error
        result.text = r.subtype === 'success' ? r.result ?? '' : result.text
        result.turns = r.num_turns
        result.costUsd = r.total_cost_usd
        if (r.is_error && !result.error) result.error = `agent ended with ${r.subtype}`
      }
    }
  } catch (e) {
    result.error = result.error ?? String(e).slice(0, 500)
  }

  // always render SOMETHING when structured data exists but the model proposed no chart — except in
  // a drafting run, whose product is the monitor draft, not a chart
  if (!args.monitorDraft && result.visualizations.length === 0 && queryRan && lastColumns.length > 0) {
    const fallback = buildDefaultTableSpec(lastColumns, lastSql, undefined, lastRows)
    result.visualizations.push(fallback)
    await emit({ type: 'visualization', spec: fallback })
  }

  await emit({ type: 'status', status: result.ok ? 'done' : 'failed' })
  return result
}
