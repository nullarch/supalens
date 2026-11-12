import { channelOf, type RunChannel } from '@/lib/agent/run-channel'

export interface HistoryRun {
  id: string
  question: string
  status: string
  created_at: string
  ended_at: string | null
  user_id: string | null
  data_source_id: string | null
  channel: string | null
  data_sources: { name: string | null } | null
}

/** Groups are inferred from adjacent runs, not persisted conversation IDs. */
export function groupHistory(runs: HistoryRun[]): { runs: HistoryRun[]; origin: RunChannel }[] {
  const groups: { runs: HistoryRun[]; origin: RunChannel }[] = []
  for (const run of runs) {
    const origin = channelOf(run.channel)
    const last = groups.at(-1)
    const previous = last?.runs.at(-1)
    const gap = previous ? Date.parse(previous.created_at) - Date.parse(run.created_at) : NaN
    if (origin !== 'incident' && last && previous && last.origin === origin &&
      previous.user_id === run.user_id && previous.data_source_id === run.data_source_id &&
      Number.isFinite(gap) && gap >= 0 && gap <= 30 * 60 * 1000) last.runs.push(run)
    else groups.push({ runs: [run], origin })
  }
  return groups
}

export function elapsedMs(run: Pick<HistoryRun, 'created_at' | 'ended_at'>): number | null {
  if (!run.ended_at) return null
  const value = Date.parse(run.ended_at) - Date.parse(run.created_at)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function statusKey(status: string) {
  return ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status) ? status : 'unknown'
}

export function isStatSpec(value: unknown): boolean {
  const spec = value as { chart?: { type?: string }; type?: string } | null
  return ['kpi', 'bignumber'].includes(spec?.chart?.type ?? spec?.type ?? '')
}

export interface SavedResult { text?: string; visualizations?: unknown[] }
