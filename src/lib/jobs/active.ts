import 'server-only'

import type { createClient } from '@/utils/supabase/server'

/**
 * Org-wide "what is running right now" aggregation for the sidebar indicator.
 *
 * Every async job in this repo already persists a status row (agent_runs /
 * code_analysis_runs / kpi_extractions / data_source_context) — those rows are the
 * single source of truth that survives a closed browser, regardless of transport
 * (Trigger.dev, inline SSE, MCP, Slack). This module only READS them, through the
 * caller's user-JWT client, so RLS does the scoping and no new privilege appears.
 *
 * Staleness: a job stuck in a running state past its kind's threshold is flagged
 * (not hidden) — mirrors the kpi_extractions "<15min counts as running" rule.
 */

export type ActiveJobKind = 'analysis' | 'code' | 'kpi' | 'context'

export interface ActiveJob {
  /** row id (data_source_id for context rows — that table's PK) */
  id: string
  kind: ActiveJobKind
  /** extra context for the row label: question snippet (analysis) or source name */
  detail: string | null
  /** ISO timestamp the job started */
  startedAt: string
  /** running longer than the kind's threshold — render greyed, not hidden */
  stale: boolean
  /** where "view" should land for this job */
  href: string
}

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>

/** fetch window + stale threshold (minutes) per kind */
const WINDOWS: Record<ActiveJobKind, { fetchMin: number; staleMin: number }> = {
  analysis: { fetchMin: 30, staleMin: 15 },
  code: { fetchMin: 60, staleMin: 30 },
  kpi: { fetchMin: 20, staleMin: 15 }, // matches the existing "<15min = still running" rule
  context: { fetchMin: 20, staleMin: 15 },
}

const isoAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const isStale = (kind: ActiveJobKind, startedAt: string) =>
  Date.now() - new Date(startedAt).getTime() > WINDOWS[kind].staleMin * 60_000

/** Active (queued/running/generating) jobs for one org, newest first. */
export async function getActiveJobs(supabase: Supabase, orgId: string): Promise<ActiveJob[]> {
  const [agent, code, kpi, context] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id, question, created_at, data_source_id')
      .eq('org_id', orgId)
      .in('status', ['queued', 'running'])
      .gte('created_at', isoAgo(WINDOWS.analysis.fetchMin))
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('code_analysis_runs')
      .select('id, kind, created_at')
      .eq('org_id', orgId)
      .in('status', ['queued', 'running'])
      // kind='context' rows are daily-cap accounting for context generation, which already
      // surfaces below via data_source_context status='generating' — don't list it twice.
      .neq('kind', 'context')
      .gte('created_at', isoAgo(WINDOWS.code.fetchMin))
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('kpi_extractions')
      .select('id, data_source_id, created_at')
      .eq('org_id', orgId)
      .eq('status', 'running')
      .gte('created_at', isoAgo(WINDOWS.kpi.fetchMin))
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('data_source_context')
      .select('data_source_id, updated_at')
      .eq('org_id', orgId)
      .eq('status', 'generating')
      .gte('updated_at', isoAgo(WINDOWS.context.fetchMin))
      .limit(10),
  ])

  // one name lookup for every data-source-bound row
  const dsIds = new Set<string>()
  for (const r of kpi.data ?? []) if (r.data_source_id) dsIds.add(r.data_source_id)
  for (const r of context.data ?? []) if (r.data_source_id) dsIds.add(r.data_source_id)
  let dsName = new Map<string, string>()
  if (dsIds.size > 0) {
    const { data: sources } = await supabase.from('data_sources').select('id, name').in('id', [...dsIds])
    dsName = new Map((sources ?? []).map((s) => [s.id, s.name]))
  }

  const jobs: ActiveJob[] = [
    ...(agent.data ?? []).map((r) => ({
      id: r.id,
      kind: 'analysis' as const,
      detail: r.question ? r.question.slice(0, 60) : null,
      startedAt: r.created_at,
      stale: isStale('analysis', r.created_at),
      href: '/app/ask',
    })),
    ...(code.data ?? []).map((r) => ({
      id: r.id,
      kind: 'code' as const,
      detail: null,
      startedAt: r.created_at,
      stale: isStale('code', r.created_at),
      href: '/app/settings/integrations',
    })),
    ...(kpi.data ?? []).map((r) => ({
      id: r.id,
      kind: 'kpi' as const,
      detail: dsName.get(r.data_source_id) ?? null,
      startedAt: r.created_at,
      stale: isStale('kpi', r.created_at),
      href: `/app/sources/${r.data_source_id}/kpis`,
    })),
    ...(context.data ?? []).map((r) => ({
      id: r.data_source_id,
      kind: 'context' as const,
      detail: dsName.get(r.data_source_id) ?? null,
      startedAt: r.updated_at,
      stale: isStale('context', r.updated_at),
      href: '/app/sources',
    })),
  ]

  return jobs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}
