import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { channelOf, isMissingColumnError } from '@/lib/agent/run-channel'
import { HistoryView } from '@/components/agent/HistoryView'
import type { HistoryRun as RunRow } from '@/components/agent/saved-analysis'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

const SELECT_BASE = 'id, question, status, created_at, ended_at, user_id, data_source_id, data_sources(name)'

/** Past analysis runs for the caller's org (RLS `agent_runs_sel`), grouped into conversations. */
export default async function AskHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; origin?: string }>
}) {
  const { page: pageParam, origin: originParam } = await searchParams
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1)
  const investigationsOnly = originParam === 'incident'
  const t = await getTranslations('appAsk')
  const supabase = await createClient()
  if (!supabase) return <main style={{ padding: 40 }}>{t('supabaseNotConfigured')}</main>
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/ask/history')

  // Fetch one row past the page to know whether a next page exists (no COUNT round-trip).
  const offset = (page - 1) * PAGE_SIZE

  // `channel` ships in a migration that may not be applied yet. Ask for it, and on 42703 fall
  // back to the pre-migration query + the old "no user id means Slack" heuristic, so the page
  // never 500s on an unmigrated database (same fail-open convention as the incident-ack columns).
  let channelAvailable = true
  let query = supabase
    .from('agent_runs')
    .select(`${SELECT_BASE}, channel`)
    .order('created_at', { ascending: false })
  if (investigationsOnly) query = query.eq('channel', 'incident')
  const withChannel = await query.range(offset, offset + PAGE_SIZE)
  let data: unknown = withChannel.data
  let loadError = !!withChannel.error
  if (withChannel.error && isMissingColumnError(withChannel.error)) {
    channelAvailable = false
    const legacy = await supabase
      .from('agent_runs')
      .select(SELECT_BASE)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)
    data = legacy.data
    loadError = !!legacy.error
  }

  const raw = ((data ?? []) as unknown) as RunRow[]
  // Pre-migration the only distinguishable origin is "no supalens user" → Slack, which is what
  // this page showed before the column existed. The origin filter degrades with it: without the
  // column the fallback query cannot filter, so a hand-typed ?origin= must read as "all" rather
  // than silently labelling every run an investigation.
  const filtered = channelAvailable && investigationsOnly
  const rows: RunRow[] = channelAvailable
    ? raw
    : raw.map((r) => ({ ...r, channel: r.user_id === null ? 'slack' : 'web' }))
  const hasNext = rows.length > PAGE_SIZE
  const pageRows = rows.slice(0, PAGE_SIZE)

  // Investigations link to the incident they explain. One extra indexed read over the runs on
  // this page — skipped entirely when none of them is an investigation.
  const investigationIds = pageRows.filter((r) => channelOf(r.channel) === 'incident').map((r) => r.id)
  const incidentByRun = new Map<string, string>()
  if (investigationIds.length > 0) {
    const { data: events } = await supabase
      .from('alert_events')
      .select('id, explanation_run_id')
      .in('explanation_run_id', investigationIds)
    for (const e of (events ?? []) as { id: string; explanation_run_id: string | null }[]) {
      if (e.explanation_run_id) incidentByRun.set(e.explanation_run_id, e.id)
    }
  }

  return <HistoryView rows={pageRows} page={page} hasNext={hasNext} channelAvailable={channelAvailable}
    filtered={filtered} incidentByRun={Object.fromEntries(incidentByRun)} loadError={loadError} />
}
