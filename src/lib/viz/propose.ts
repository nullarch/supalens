/**
 * Pure validation core for the in-process `propose_visualization` MCP tool, shared by the SQL
 * and Firestore agents (their handlers in src/lib/agent/tools.ts / src/lib/firestore-agent/tools.ts
 * stay thin). Sibling of src/lib/kpi/propose.ts — same contract: no MCP / agent / DB imports, it
 * reads only the in-process result map the query tools stash by queryId, so it is fully
 * unit-testable and adds NO capability to the locked-down agents. Every error explains how the
 * model can self-repair.
 */
import { VisualizationSpec, referencedColumns } from './spec'
import type { ChartSpec, FirestoreQueryRef, VisualizationSpec as VizSpec } from './spec'
import { percentSanityIssue } from './percent-sanity'

/** Product policy: an answer is 1–2 charts, 3 at most — the agent CHOOSES, it never mass-produces.
 *  Enforced here (the 4th proposal is rejected) and stated in both agents' system prompts. */
export const MAX_CHARTS_PER_RUN = 3

/** A prior successful query result, stashed by the query tools under its queryId. `firestore` is
 *  the structured re-run descriptor, set only by the Firestore document tools. */
export interface StoredQueryResult {
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  firestore?: FirestoreQueryRef
}

export type VizProposalOutcome = { ok: true; spec: VizSpec } | { ok: false; error: string }

/**
 * Validate a chart proposal against the stashed result its queryId references and the per-run
 * chart budget. Returns the server-assembled spec envelope on success, or a self-repair error
 * string. Does NOT count the acceptance — the caller increments its counter only after the sink
 * has taken the spec (mirrors how validateKpiProposal leaves `seenKeys` to the caller).
 */
export function validateVizProposal(
  store: Pick<Map<string, StoredQueryResult>, 'get'>,
  acceptedCount: number,
  input: { queryId: string; chart: ChartSpec },
  opts?: {
    /** tool name(s) the error points the model at for an unknown queryId (default `execute_sql`). */
    queryToolHint?: string
  },
): VizProposalOutcome {
  if (acceptedCount >= MAX_CHARTS_PER_RUN) {
    return {
      ok: false,
      error: `Chart limit reached (${MAX_CHARTS_PER_RUN} charts per answer). Do not propose more charts — finish the answer in text, and if the user asked for more, briefly mention the ${MAX_CHARTS_PER_RUN}-chart limit.`,
    }
  }

  const q = store.get(input.queryId)
  if (!q) {
    return {
      ok: false,
      error: `Unknown queryId "${input.queryId}". Run ${opts?.queryToolHint ?? 'execute_sql'} first and use the queryId it returns.`,
    }
  }

  const missing = referencedColumns(input.chart).filter((c) => !q.columns.includes(c))
  if (missing.length) {
    return {
      ok: false,
      error: `Columns ${JSON.stringify(missing)} are not in this result. Valid columns: ${JSON.stringify(q.columns)}.`,
    }
  }

  const parsed = VisualizationSpec.safeParse({
    v: 1,
    query: { sql: q.sql, queryId: input.queryId, firestore: q.firestore },
    sample: { columns: q.columns, rows: q.rows.slice(0, 200) },
    chart: input.chart,
  })
  if (!parsed.success) {
    return { ok: false, error: `Invalid visualization spec: ${JSON.stringify(parsed.error.flatten())}` }
  }

  const pctIssue = percentSanityIssue(parsed.data.chart, q.rows)
  if (pctIssue) {
    return { ok: false, error: pctIssue }
  }

  return { ok: true, spec: parsed.data }
}
