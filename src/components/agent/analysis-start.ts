export type AnalysisRun =
  | { mode: 'trigger'; triggerRunId: string; publicToken: string; dataSourceId: string }
  | { mode: 'local'; runId: string; dataSourceId: string; priorRunIds: string[] }

/** Never subscribe or append thread history from an incomplete start response. */
export function parseAnalysisStart(value: unknown, dataSourceId: string, priorRunIds: string[]): { runId: string; run: AnalysisRun } | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (typeof data.runId !== 'string' || !data.runId.trim()) return null
  if (data.mode === 'local') return { runId: data.runId, run: { mode: 'local', runId: data.runId, dataSourceId, priorRunIds } }
  if (data.mode === 'trigger' && typeof data.triggerRunId === 'string' && data.triggerRunId.trim() && typeof data.publicToken === 'string' && data.publicToken.trim()) {
    return { runId: data.runId, run: { mode: 'trigger', triggerRunId: data.triggerRunId, publicToken: data.publicToken, dataSourceId } }
  }
  return null
}
