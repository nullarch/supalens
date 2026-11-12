/**
 * Draft a goal monitor locally against the DEMO database — no Supabase app DB, no Trigger.dev, no
 * vault. Same model contract as the real drafting run (SYSTEM_PROMPT + MONITOR_DRAFT_PROMPT, the
 * execute_sql → queryId stash, and `propose_monitor` through validateMonitorProposal), but the SQL
 * tools talk to DEMO_DATABASE_URL directly inside a READ ONLY transaction. Useful for prompt work:
 * it prints every tool call, the validator's replies, and the accepted draft with its backtest.
 *
 * Usage (needs ANTHROPIC_API_KEY + DEMO_DATABASE_URL):
 *   npx tsx --env-file=.env.local scripts/goal-draft-local.ts "tell me when daily signups dip" [--locale ko] [--tz Asia/Seoul]
 */
import { mkdirSync } from 'fs'

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { Client } from 'pg'
import { z } from 'zod'

import { assertReadOnly } from '@/lib/query/guard'
import { buildChildEnv, LOCKDOWN_DISALLOWED_TOOLS, makeToolGate } from '@/lib/agent/lockdown'
import { ANALYSIS_MODEL } from '@/lib/agent/models'
import { SYSTEM_PROMPT } from '@/lib/agent/system-prompt'
import { languageDirective } from '@/lib/i18n/agent-locale'
import {
  buildMonitorDraftQuestion,
  MONITOR_DRAFT_PROMPT,
  ProposeMonitorInput,
  validateMonitorProposal,
  type MonitorDraft,
  type StashedQuery,
} from '@/lib/alerts/draft'
import { checkGoalSeries } from '@/lib/alerts/goal-series'

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const goal = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  if (!goal) {
    console.error('usage: scripts/goal-draft-local.ts "<goal>" [--locale ko] [--tz Asia/Seoul]')
    process.exit(2)
  }
  const locale = flag('--locale') ?? 'en'
  const timezone = flag('--tz') ?? 'UTC'
  const url = process.env.DEMO_DATABASE_URL
  if (!url) throw new Error('DEMO_DATABASE_URL is not set')

  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const run = async (sql: string) => {
    assertReadOnly(sql)
    await db.query('begin read only')
    try {
      await db.query("set local statement_timeout = '20s'")
      const r = await db.query(sql)
      return { columns: r.fields.map((f) => f.name), rows: (r.rows as Record<string, unknown>[]).slice(0, 1000), truncated: r.rows.length > 1000 }
    } finally {
      await db.query('rollback')
    }
  }

  const store = new Map<string, StashedQuery>()
  let seq = 0
  let draft: MonitorDraft | null = null
  const started = Date.now()
  const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`

  const server = createSdkMcpServer({
    name: 'supalens',
    tools: [
      tool('execute_sql', 'Run a READ-ONLY SQL (SELECT/WITH) query. Returns {queryId, columns, rows, rowCount, truncated}.', { sql: z.string() }, async ({ sql }) => {
        try {
          const r = await run(sql)
          const queryId = `q${++seq}`
          store.set(queryId, { sql, columns: r.columns, rows: r.rows })
          console.log(`${stamp()}  execute_sql ${queryId}: ${r.rows.length} rows [${r.columns.join(', ')}]`)
          return { content: [{ type: 'text' as const, text: JSON.stringify({ queryId, ...r, rowCount: r.rows.length }) }] }
        } catch (e) {
          console.log(`${stamp()}  execute_sql rejected: ${String(e).slice(0, 160)}`)
          return { content: [{ type: 'text' as const, text: `Query rejected or failed: ${String(e).slice(0, 300)}` }], isError: true }
        }
      }),
      tool('get_schema', 'List tables and columns of the connected database.', { schema: z.string().optional() }, async ({ schema }) => {
        const r = await run(
          `select table_schema, table_name, column_name, data_type from information_schema.columns
           where table_schema not in ('pg_catalog','information_schema') ${schema ? `and table_schema = '${schema.replace(/'/g, '')}'` : ''}
           order by table_schema, table_name, ordinal_position`,
        )
        console.log(`${stamp()}  get_schema: ${r.rows.length} columns`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(r.rows) }] }
      }),
      tool('propose_visualization', 'Not used in drafting runs.', { queryId: z.string() }, async () => ({
        content: [{ type: 'text' as const, text: 'Drafting runs do not chart — call propose_monitor.' }],
        isError: true,
      })),
      tool('propose_monitor', 'Register the monitor draft for the user goal.', ProposeMonitorInput, async (input) => {
        const res = validateMonitorProposal(store, { goal, timezone }, input, Date.now())
        console.log(`${stamp()}  propose_monitor → ${res.ok ? res.summary : 'REJECTED: ' + res.error}`)
        if (!res.ok) return { content: [{ type: 'text' as const, text: res.error }], isError: true }
        draft = res.draft
        return { content: [{ type: 'text' as const, text: res.summary }] }
      }),
    ],
  })

  const allowed = ['execute_sql', 'get_schema', 'propose_visualization', 'propose_monitor'].map((n) => `mcp__supalens__${n}`)
  const cwd = `/tmp/goal-draft-${Date.now()}`
  mkdirSync(cwd, { recursive: true })
  const q = query({
    prompt: buildMonitorDraftQuestion(goal),
    options: {
      model: ANALYSIS_MODEL,
      systemPrompt: SYSTEM_PROMPT + MONITOR_DRAFT_PROMPT + languageDirective(locale),
      mcpServers: { supalens: server },
      allowedTools: allowed,
      tools: [],
      disallowedTools: [...LOCKDOWN_DISALLOWED_TOOLS],
      settingSources: [],
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
      maxTurns: 25,
      cwd,
      env: buildChildEnv(),
      canUseTool: makeToolGate(allowed),
    },
  })
  let tokens = 0
  for await (const msg of q) {
    if (msg.type === 'assistant') {
      const m = (msg as unknown as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message
      tokens += (m?.usage?.input_tokens ?? 0) + (m?.usage?.output_tokens ?? 0)
    } else if (msg.type === 'result') {
      const r = msg as unknown as { result?: string; num_turns: number; total_cost_usd: number }
      console.log(`${stamp()}  done: ${r.num_turns} turns · $${r.total_cost_usd?.toFixed(3)} · ${tokens} tokens`)
      if (r.result) console.log(`\n${r.result}\n`)
    }
  }
  await db.end()

  if (!draft) {
    console.log('NO DRAFT')
    process.exit(1)
  }
  const d = draft as MonitorDraft
  const check = checkGoalSeries(d.sample.columns, d.sample.rows, d.condition, Date.now(), timezone)
  console.log(JSON.stringify({ name: d.name, goal: d.goal, condition: d.condition, rationale: d.rationale, format: d.format }, null, 2))
  console.log(d.metricSql)
  if (check.ok) {
    const { points, current, backtest } = check.check
    console.log(
      `days=${points.length} latest=${points.at(-1)?.bucket}:${current.latest} lower=${current.lower} upper=${current.upper} met=${current.met} fires=${backtest.fires} on ${backtest.firedIndices.map((i) => points[i]?.bucket).join(', ')}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
