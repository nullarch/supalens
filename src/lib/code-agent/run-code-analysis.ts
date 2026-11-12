// NOT `import 'server-only'` — runs in the Trigger.dev runtime.
//
// Sibling of agent/run-analysis.ts. Same lockdown (tools:[], disallowedTools, settingSources:[],
// strictMcpConfig, permissionMode:'dontAsk', canUseTool deny-gate, env-stripped subprocess,
// token budget) — only the tool profile + prompt differ. The clone is done HERE in the parent
// process (cloneRepo), so the installation token lives in this closure and never reaches the
// claude subprocess (buildChildEnv strips it, like the SQL agent strips DB/KMS creds).
//
// If `dataSourceId` is bound (code × DB cross-analysis), the read-only SQL tools are added
// alongside the file tools — both lenses, both read-only. The BFF asserts same org_id, so a
// combined run is still exactly one tenant (invariant #1).
import { query } from '@/lib/llm/agent-sdk'

import { buildChildEnv, LOCKDOWN_DISALLOWED_TOOLS, makeToolGate } from '@/lib/agent/lockdown'
import { ANALYSIS_MODEL } from '@/lib/agent/models'
import { languageDirective } from '@/lib/i18n/agent-locale'
import { buildSqlTools } from '@/lib/agent/tools'
import type { KpiSink } from '@/lib/kpi/types'
import type { Actor } from '@/lib/secrets/service'
import { cloneRepo } from '@/lib/repo/clone'
import { buildCodeTools } from './tools'
import { CODE_SYSTEM_PROMPT, CROSS_DB_ADDENDUM } from './system-prompt'

export type CodeChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'status'; status: string }

export interface CodeAnalysisResult {
  ok: boolean
  text: string
  turns: number
  costUsd: number
  tokensIn: number
  tokensOut: number
  error?: string
}

export interface RunCodeAnalysisArgs {
  runId: string
  /** "owner/repo" */
  fullName: string
  /** installation access token (~1h), used only for the clone. Omitted for a public repo (X-ray). */
  token?: string
  question: string
  ref?: string
  sparsePaths?: string[]
  /** when set, also expose read-only execute_sql/get_schema for this data source. */
  dataSourceId?: string
  /** when set together with dataSourceId, expose propose_kpi and collect KPI proposals (tier-2 extraction). */
  kpiSink?: KpiSink
  model?: string
  maxTurns?: number
  maxTotalTokens?: number
  emit?: (chunk: CodeChunk) => void | Promise<void>
  /** originating user's locale — the model answers in this language (prose only). */
  locale?: string
  /** replaces CODE_SYSTEM_PROMPT (the language directive is still appended). The X-ray uses it. */
  systemPrompt?: string
  /** extra in-process tool servers built over the clone (e.g. the X-ray's note/submit tools).
   *  Their tool names join the allow-list; the lockdown is otherwise unchanged. */
  extraServers?: (cloneDir: string) => { name: string; server: ReturnType<typeof buildCodeTools>; tools: readonly string[] }[]
  /** called once the clone exists, before the agent starts (host-side, never the subprocess). */
  onCloned?: (cloneDir: string) => void | Promise<void>
}

export const CODE_TOOLS = [
  'mcp__supalens_code__list_files',
  'mcp__supalens_code__read_file',
  'mcp__supalens_code__grep_code',
  'mcp__supalens_code__get_diff',
]
export const DB_TOOLS = ['mcp__supalens__execute_sql', 'mcp__supalens__get_schema']

interface AssistantBlock {
  type: string
  text?: string
  name?: string
  input?: unknown
}

/**
 * Clone the repo (host-side) and run one read-only code-analysis pass with the Claude Agent
 * SDK, locked to the jailed file tools (+ read-only SQL tools when a data source is bound).
 * Streams chunks via `emit`. Always cleans up the clone.
 */
export async function runCodeAnalysis(args: RunCodeAnalysisArgs): Promise<CodeAnalysisResult> {
  const emit = args.emit ?? (() => {})
  const result: CodeAnalysisResult = { ok: false, text: '', turns: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 }

  await emit({ type: 'status', status: 'cloning' })
  let clone: { dir: string; cleanup: () => Promise<void> }
  try {
    clone = await cloneRepo({
      fullName: args.fullName,
      token: args.token,
      runId: args.runId,
      ref: args.ref,
      sparsePaths: args.sparsePaths,
    })
  } catch (e) {
    result.error = String(e).slice(0, 300)
    await emit({ type: 'status', status: 'failed' })
    return result
  }
  // token is no longer needed past the clone; analysis reads local files (+ live DB) only.

  const abort = new AbortController()
  const maxTotalTokens = args.maxTotalTokens ?? 800_000
  const actor: Actor = { kind: 'system', id: args.runId }

  const withDb = !!args.dataSourceId
  // propose_kpi rides the same in-process supalens server as the DB tools; add it only when a
  // KpiSink is supplied AND a data source is bound (KPI extraction needs execute_sql → queryId).
  const dbTools = args.kpiSink ? [...DB_TOOLS, 'mcp__supalens__propose_kpi'] : DB_TOOLS
  const extras = args.extraServers?.(clone.dir) ?? []
  const allowed = [...(withDb ? [...CODE_TOOLS, ...dbTools] : CODE_TOOLS), ...extras.flatMap((e) => e.tools)]
  const mcpServers: Record<string, ReturnType<typeof buildCodeTools>> = {
    supalens_code: buildCodeTools(clone.dir),
  }
  if (withDb) mcpServers.supalens = buildSqlTools(args.dataSourceId as string, actor, undefined, args.kpiSink)
  for (const extra of extras) mcpServers[extra.name] = extra.server
  const basePrompt = args.systemPrompt ?? (withDb ? CODE_SYSTEM_PROMPT + CROSS_DB_ADDENDUM : CODE_SYSTEM_PROMPT)
  const systemPrompt = basePrompt + languageDirective(args.locale)

  try {
    await args.onCloned?.(clone.dir)
    await emit({ type: 'status', status: 'analyzing' })
    const q = query({
      prompt: args.question,
      options: {
        model: args.model ?? ANALYSIS_MODEL,
        systemPrompt,
        mcpServers,
        allowedTools: allowed,
        tools: [], // drop all built-in harness tools
        disallowedTools: [...LOCKDOWN_DISALLOWED_TOOLS],
        settingSources: [], // ignore a repo-planted .mcp.json / .claude/ / CLAUDE.md
        strictMcpConfig: true,
        permissionMode: 'dontAsk',
        maxTurns: args.maxTurns ?? 40,
        includePartialMessages: true,
        abortController: abort,
        cwd: clone.dir,
        env: buildChildEnv(), // no GitHub token / DB / KMS creds reach the subprocess
        canUseTool: makeToolGate(allowed),
      },
    })

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
  } finally {
    await clone.cleanup()
  }

  await emit({ type: 'status', status: result.ok ? 'done' : 'failed' })
  return result
}
