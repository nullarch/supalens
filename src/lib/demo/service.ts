// DB io for the anonymous /demo surface (docs/public-demo-plan.md). BFF-only today, but kept
// free of `server-only` like its sibling public-demo.ts. All queries run through the untyped
// service-role client — demo rows belong to the member-less demo org, which no user JWT can see.
import { createAdminClient } from '@/utils/supabase/admin'
import { demoCacheCutoff } from './public-demo'

export interface CachedDemoAnswer {
  runId: string
  result: { text?: string; visualizations?: unknown[] } | null
  answeredAt: string
}

/**
 * agent_runs IS the cache: the most recent succeeded run in the demo org with the same
 * normalized question since demoCacheCutoff (TTL, current data week and dataset). Chips send canonical strings, so after their first live
 * run they are always served from here (zero LLM) — the path that absorbs a launch spike.
 */
export async function findCachedDemoAnswer(orgId: string, question: string): Promise<CachedDemoAnswer | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const cutoff = demoCacheCutoff(new Date()).toISOString()
  const { data } = await admin
    .from('agent_runs')
    .select('id, result, created_at')
    .eq('org_id', orgId)
    .eq('question', question)
    .eq('status', 'succeeded')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5)
  const rows = (data ?? []) as { id: string; result: CachedDemoAnswer['result']; created_at: string }[]
  const row = rows.find((r) => isServableDemoAnswer(r.result))
  if (!row) return null
  return { runId: row.id, result: row.result, answeredAt: row.created_at }
}

/**
 * A "succeeded" run can still be a non-answer (e.g. the agent explaining that a tool failed).
 * Every demo question is a data question, so only answers that produced a chart are replayed
 * to other visitors; anything else asks live again.
 */
export function isServableDemoAnswer(result: CachedDemoAnswer['result']): boolean {
  return Array.isArray(result?.visualizations) && result.visualizations.length > 0 && Boolean(result.text?.trim())
}

/**
 * Sliding-window visitor count over BOTH keys (max wins): clearing cookies doesn't reset the
 * IP window, and a shared IP (office NAT) can still be ridden past via the per-cookie count —
 * taking the max means whichever key the abuser can't rotate is the one that binds.
 * Returns null on any error → the caller FAILS CLOSED (anonymous LLM endpoint).
 */
export async function countVisitorRunsSince(ipHash: string, cookieId: string, sinceIso: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [byIp, byCookie] = await Promise.all([
    admin.from('demo_requests').select('*', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', sinceIso),
    admin.from('demo_requests').select('*', { count: 'exact', head: true }).eq('cookie_id', cookieId).gte('created_at', sinceIso),
  ])
  if (byIp.error || byCookie.error) {
    console.error('[demo] visitor count failed:', (byIp.error ?? byCookie.error)?.message)
    return null
  }
  return Math.max(byIp.count ?? 0, byCookie.count ?? 0)
}

/** Global live-run count in the window (the DEMO_MAX_RUNS_PER_DAY budget). null → fail closed. */
export async function countDemoRunsSince(sinceIso: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { count, error } = await admin
    .from('demo_requests')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sinceIso)
  if (error) {
    console.error('[demo] global count failed:', error.message)
    return null
  }
  return count ?? 0
}

/** Concurrent live demo runs. null → fail closed (treated as busy). */
export async function countInFlightDemoRuns(orgId: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { count, error } = await admin
    .from('agent_runs')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', ['queued', 'running'])
  if (error) {
    console.error('[demo] in-flight count failed:', error.message)
    return null
  }
  return count ?? 0
}

/** Ledger write for a LIVE run (cache hits and duplicate-joins insert nothing). Best-effort —
 *  the run is already dispatched; a failed ledger write must not fail the visitor's answer. */
export async function recordDemoRequest(input: {
  ipHash: string
  cookieId: string
  question: string
  runId: string
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin.from('demo_requests').insert({
    ip_hash: input.ipHash,
    cookie_id: input.cookieId,
    question: input.question,
    run_id: input.runId,
  })
  if (error) console.error('[demo] request ledger insert failed:', error.message)
}

/** trigger_run_id lookup for the duplicate-run case: a second visitor asking the identical
 *  question while it's in flight streams the SAME run instead of getting an error. */
export async function triggerRunIdFor(runId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('agent_runs').select('trigger_run_id').eq('id', runId).limit(1)
  return ((data?.[0] as { trigger_run_id: string | null } | undefined)?.trigger_run_id) ?? null
}
