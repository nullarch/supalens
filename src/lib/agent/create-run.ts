// Shared run-creation core: double-submit guard → insert agent_runs → trigger the worker task.
// Bundle-safe (NO runner imports — only the admin client + Trigger SDK), so the Vercel BFF, the
// Slack events route, and the Slack slash-command route all reuse it without pulling the Agent SDK.
// Callers own auth (before) + the response/reply (after); this owns the mechanics they all repeated.
import { randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'

import { requireAdminClient } from '@/utils/supabase/admin'
import { isMissingColumnError, type RunChannel } from './run-channel'

export type CreateRunResult =
  | { status: 'created'; runId: string; triggerRunId: string }
  | { status: 'duplicate'; runId: string }
  | { status: 'insert_failed' }
  | { status: 'trigger_failed'; runId: string }
  | { status: 'no_worker'; runId: string } // TRIGGER_SECRET_KEY unset (local dev / misconfig)

export interface CreateRunInput {
  orgId: string
  dataSourceId: string
  /** null for a Slack mention/command (no supalens user); the auth'd user id otherwise. */
  userId: string | null
  /** RAW question stored on the row (clean history/display). */
  question: string
  /** Which surface asked. Omitted → 'web' (the historical meaning of a NULL channel). */
  channel?: RunChannel
  /** Trigger task id: taskIdForEngine(...) for web/MCP, 'messenger-answer' for Slack. */
  taskId: string
  /** Extra trigger-payload fields merged onto the standard ones (locale, engine, reply, …). */
  payloadExtra?: Record<string, unknown>
  /** What the task actually sees (e.g. a thread-continuity preamble); defaults to `question`. */
  agentQuestion?: string
  dedupeWindowMs?: number
  /** Trigger queue key; defaults to dataSourceId (per-source serialization). The public demo
   *  overrides this with a hash bucket — one shared demo source must not single-file every
   *  anonymous run behind one key. */
  concurrencyKey?: string
}

/**
 * Create + dispatch an agent run. Idempotent-ish: an identical (org, source, question) already
 * queued/running within the dedupe window returns `duplicate` instead of a second run (a second
 * run would double-bill). On trigger failure the row is marked failed so it never sticks at queued.
 */
export async function createAgentRun(input: CreateRunInput): Promise<CreateRunResult> {
  const admin = requireAdminClient()
  const { orgId, dataSourceId, userId, question } = input
  const windowMs = input.dedupeWindowMs ?? 20_000

  const { data: dup } = await admin
    .from('agent_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('data_source_id', dataSourceId)
    .eq('question', question)
    .in('status', ['queued', 'running'])
    .gte('created_at', new Date(Date.now() - windowMs).toISOString())
    .limit(1)
  if (dup && dup.length > 0) return { status: 'duplicate', runId: (dup[0] as { id: string }).id }

  const runId = randomUUID()
  const baseRow = {
    id: runId,
    org_id: orgId,
    data_source_id: dataSourceId,
    user_id: userId,
    question,
    status: 'queued',
  }
  // `channel` ships in a migration that may not be applied yet. Writing it unconditionally
  // would make EVERY run creation fail with 42703 on a deploy-before-migrate; retry without it
  // instead, so the column is purely additive (same fail-open convention as the incident-ack
  // columns). The retry costs one round-trip and only ever happens pre-migration.
  let insErr = (await admin.from('agent_runs').insert({ ...baseRow, channel: input.channel ?? 'web' })).error
  if (insErr && isMissingColumnError(insErr)) {
    insErr = (await admin.from('agent_runs').insert(baseRow)).error
  }
  if (insErr) {
    // The window SELECT above is a TOCTOU race under concurrent identical submits — the
    // partial unique index agent_runs_inflight_uniq (org, source, md5(question) while
    // queued/running) is the atomic guard. A 23505 here IS the duplicate case: surface the
    // winning run instead of a raw failure so callers keep the same `duplicate` contract.
    if (insErr.code === '23505') {
      const { data: winner } = await admin
        .from('agent_runs')
        .select('id')
        .eq('org_id', orgId)
        .eq('data_source_id', dataSourceId)
        .eq('question', question)
        .in('status', ['queued', 'running'])
        .limit(1)
      if (winner && winner.length > 0) return { status: 'duplicate', runId: (winner[0] as { id: string }).id }
    }
    return { status: 'insert_failed' }
  }

  if (!process.env.TRIGGER_SECRET_KEY) return { status: 'no_worker', runId }

  try {
    const handle = await tasks.trigger(
      input.taskId,
      {
        orgId,
        dataSourceId,
        userId: userId ?? '',
        runId,
        question: input.agentQuestion ?? question,
        ...input.payloadExtra,
      },
      { concurrencyKey: input.concurrencyKey ?? dataSourceId },
    )
    await admin.from('agent_runs').update({ trigger_run_id: handle.id }).eq('id', runId)
    return { status: 'created', runId, triggerRunId: handle.id }
  } catch (err) {
    await admin.from('agent_runs').update({ status: 'failed', error: String(err).slice(0, 300) }).eq('id', runId)
    return { status: 'trigger_failed', runId }
  }
}
