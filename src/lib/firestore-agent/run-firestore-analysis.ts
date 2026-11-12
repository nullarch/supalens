// NOT `import 'server-only'` — runs in the Trigger.dev runtime. Sibling of agent/run-analysis.ts:
// SAME lockdown (tools:[], disallowedTools, settingSources:[], strictMcpConfig, dontAsk,
// canUseTool deny-gate, env-stripped subprocess, token budget) — only the tool profile (Firestore
// document tools) and system prompt differ. Reuses the AnalysisChunk / AnalysisResult contract so
// the Trigger task, run-record persistence, and the AgentStream UI are unchanged.
import { mkdirSync } from 'fs'

import { query } from '@/lib/llm/agent-sdk'

import { buildChildEnv, LOCKDOWN_DISALLOWED_TOOLS, makeToolGate } from '@/lib/agent/lockdown'
import { ANALYSIS_MODEL } from '@/lib/agent/models'
import type { AnalysisChunk, AnalysisResult } from '@/lib/agent/run-analysis'
import type { Actor } from '@/lib/secrets/service'
import { buildDefaultTableSpec } from '@/lib/viz/spec'
import type { FirestoreQueryRef } from '@/lib/viz/spec'
import { getSourceContext, renderSourceContextSection } from '@/lib/context/service'
import { languageDirective } from '@/lib/i18n/agent-locale'

import { FIRESTORE_SYSTEM_PROMPT } from './system-prompt'
import { buildFirestoreTools } from './tools'

export interface RunFirestoreAnalysisArgs {
  orgId: string
  dataSourceId: string
  userId: string
  runId: string
  question: string
  model?: string
  maxTurns?: number
  maxTotalTokens?: number
  emit?: (chunk: AnalysisChunk) => void | Promise<void>
  /** originating user's locale — the model answers in this language (prose only). */
  locale?: string
}

export const ALLOWED_TOOLS = [
  'mcp__supalens_firestore__list_collections',
  'mcp__supalens_firestore__get_collection_schema',
  'mcp__supalens_firestore__query_documents',
  'mcp__supalens_firestore__aggregate',
  'mcp__supalens_firestore__propose_visualization',
]

interface AssistantBlock {
  type: string
  text?: string
  name?: string
  input?: unknown
}

/**
 * Run one read-only Firestore analysis pass with the Claude Agent SDK, locked to the document
 * tools (+ propose_visualization), no built-ins, headless permissions, and a hard token budget.
 * The decrypted service-account key lives only in this parent process (the tool handlers'
 * data-access closure) and is stripped from the subprocess env. Streams chunks via `emit`.
 */
export async function runFirestoreAnalysis(args: RunFirestoreAnalysisArgs): Promise<AnalysisResult> {
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

  // track the last result so we can synthesize a default table if the model proposes no chart
  let queryRan = false
  let lastSql = ''
  let lastColumns: string[] = []
  let lastRows: Record<string, unknown>[] = []
  let lastFirestore: FirestoreQueryRef | undefined

  const fsServer = buildFirestoreTools(args.dataSourceId, actor, {
    onVisualization: (spec) => {
      result.visualizations.push(spec)
      void emit({ type: 'visualization', spec })
    },
    onQueryResult: (q) => {
      queryRan = true
      lastSql = q.sql
      lastColumns = q.columns
      lastRows = q.rows
      lastFirestore = q.firestore
    },
  })

  // Inject the per-source context doc (SUPALENS.md) as a TRUSTED prompt section, if available.
  let systemPrompt = FIRESTORE_SYSTEM_PROMPT
  try {
    const ctx = await getSourceContext(args.dataSourceId)
    if (ctx) systemPrompt += renderSourceContextSection(ctx)
  } catch (e) {
    console.error(`[firestore-agent] context load failed for ${args.dataSourceId}:`, e)
  }
  systemPrompt += languageDirective(args.locale)

  const q = query({
    prompt: args.question,
    options: {
      model: args.model ?? ANALYSIS_MODEL,
      systemPrompt,
      mcpServers: { supalens_firestore: fsServer },
      allowedTools: ALLOWED_TOOLS,
      tools: [], // drop all built-in harness tools from the model's context
      disallowedTools: [...LOCKDOWN_DISALLOWED_TOOLS],
      settingSources: [], // ignore .mcp.json / user / project settings
      strictMcpConfig: true,
      permissionMode: 'dontAsk', // headless: anything not explicitly allowed is denied
      maxTurns: args.maxTurns ?? 25,
      includePartialMessages: true,
      abortController: abort,
      cwd,
      env: buildChildEnv(), // no service-account / KMS / service_role creds reach the subprocess
      canUseTool: makeToolGate(ALLOWED_TOOLS),
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

  // always render SOMETHING when structured data exists but the model proposed no chart
  // (the firestore descriptor keeps the fallback table live-refreshable when saved)
  if (result.visualizations.length === 0 && queryRan && lastColumns.length > 0) {
    const fallback = buildDefaultTableSpec(lastColumns, lastSql, lastFirestore, lastRows)
    result.visualizations.push(fallback)
    await emit({ type: 'visualization', spec: fallback })
  }

  await emit({ type: 'status', status: result.ok ? 'done' : 'failed' })
  return result
}
