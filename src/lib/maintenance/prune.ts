// NOTE: intentionally NOT `import 'server-only'` — this module is the body of the
// Trigger.dev maintenance task (plain Node bundle), same convention as
// utils/supabase/admin.ts.
import { requireAdminClient } from '@/utils/supabase/admin'
import { publicDemoOrgId } from '@/lib/demo/public-demo'
import type { Database } from '@/utils/supabase/schema.type'

/**
 * Nightly housekeeping. Two jobs:
 *
 * 1. RETENTION — growth tables (webhook receipts, run records, audit trails) have
 *    no consumer past their operational window and would otherwise grow forever.
 *    Deletion windows are deliberately conservative; `agent_runs` keeps 180 days so
 *    the /app/ask history and dashboards provenance stay useful.
 *
 * 2. STUCK-RUN REAPER — a run left at queued/running past 2h is dead (the Trigger
 *    task maxDuration is far shorter; the local-dev SSE path can strand `queued`
 *    rows when the browser never connects). Mark them failed so the UI and the
 *    daily abuse cap (which counts recent runs) reflect reality.
 */

const DAY_MS = 86_400_000

// `column` is pinned to the table's GENERATED Row type: a wrong column name is a compile
// error, not a nightly PostgREST 42703 that lands in report.errors while the table grows
// forever (audit_log/secret_access_log use `at`, paddle uses `received_at` — all three
// silently failed to prune until the 2026-07-13 audit).
type PublicTables = Database['public']['Tables']
type RetentionRule = {
  [T in keyof PublicTables]: { table: T; column: keyof PublicTables[T]['Row'] & string; days: number }
}[keyof PublicTables]

const RETENTION: RetentionRule[] = [
  { table: 'paddle_webhook_events', column: 'received_at', days: 90 },
  { table: 'github_webhook_events', column: 'created_at', days: 90 },
  { table: 'slack_events', column: 'created_at', days: 90 },
  // auth codes live 10 minutes (consumeAuthCode only flips consumed_at, never deletes) — without
  // this rule the table grows one row per OAuth grant forever. 7 days keeps a short debug trail.
  { table: 'oauth_auth_codes', column: 'expires_at', days: 7 },
  // anonymous /demo rate-limit ledger — the sliding window is 24h, 7d keeps a debug trail
  { table: 'demo_requests', column: 'created_at', days: 7 },
  { table: 'alert_events', column: 'created_at', days: 180 },
  { table: 'agent_runs', column: 'created_at', days: 180 },
  { table: 'code_analysis_runs', column: 'created_at', days: 180 },
  { table: 'secret_access_log', column: 'at', days: 180 },
  { table: 'audit_log', column: 'at', days: 365 },
  { table: 'lifecycle_email_log', column: 'sent_at', days: 365 },
  // tracked-link click ledger — campaign stats read a trailing window, and the cap bounds the
  // growth of a public endpoint.
  { table: 'outreach_clicks', column: 'created_at', days: 180 },
  // done/failed outbox rows are historical once completed; pending rows are never touched
]

export interface PruneReport {
  pruned: Record<string, number>
  reaped: number
  errors: string[]
}

export async function runMaintenance(now = Date.now()): Promise<PruneReport> {
  const admin = requireAdminClient()
  const report: PruneReport = { pruned: {}, reaped: 0, errors: [] }

  for (const r of RETENTION) {
    try {
      const cutoff = new Date(now - r.days * DAY_MS).toISOString()
      const { count, error } = await admin
        .from(r.table)
        .delete({ count: 'exact' })
        .lt(r.column, cutoff)
      if (error) throw error
      report.pruned[r.table] = count ?? 0
    } catch (e) {
      report.errors.push(`${r.table}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // completed revocation outbox rows (pending ones stay until drained)
  try {
    const cutoff = new Date(now - 90 * DAY_MS).toISOString()
    const { count, error } = await admin
      .from('credential_revocations')
      .delete({ count: 'exact' })
      .in('status', ['done', 'failed'])
      .lt('created_at', cutoff)
    if (error) throw error
    report.pruned['credential_revocations'] = count ?? 0
  } catch (e) {
    report.errors.push(`credential_revocations: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Public-demo run retention (env-gated: needs PUBLIC_DEMO_ORG_ID on the Trigger host; without
  // it demo rows just fall under the global 180d agent_runs rule). Anonymous surface — keep the
  // demo org's runs 30d (the answer-cache TTL is 7d; a pruned chip answer simply re-runs live
  // once). The demo_requests ledger itself is a plain RETENTION rule above.
  const demoOrg = publicDemoOrgId()
  if (demoOrg) {
    try {
      const cutoff = new Date(now - 30 * DAY_MS).toISOString()
      const { count, error } = await admin
        .from('agent_runs')
        .delete({ count: 'exact' })
        .eq('org_id', demoOrg)
        .lt('created_at', cutoff)
      if (error) throw error
      report.pruned['agent_runs_demo'] = count ?? 0
    } catch (e) {
      report.errors.push(`agent_runs_demo: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // stuck-run reaper (both run tables share the status enum + created_at)
  const stuckCutoff = new Date(now - 2 * 60 * 60 * 1000).toISOString()
  for (const table of ['agent_runs', 'code_analysis_runs']) {
    try {
      const { count, error } = await admin
        .from(table)
        .update(
          { status: 'failed', error: 'timed out (reaped by maintenance)', ended_at: new Date(now).toISOString() },
          { count: 'exact' },
        )
        .in('status', ['queued', 'running'])
        .lt('created_at', stuckCutoff)
      if (error) throw error
      report.reaped += count ?? 0
    } catch (e) {
      report.errors.push(`reap ${table}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return report
}
