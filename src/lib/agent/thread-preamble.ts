// Shared thread-continuity preamble for multi-turn asks. Used by BOTH transports — the BFF
// (/api/agent/analyze → Trigger payload) and the local-dev SSE route — so a follow-up turn
// behaves identically whichever path executes it. English on purpose: prompt scaffolding is
// LLM-facing and never translated (i18n bucket #2); only the ANSWER language follows the user
// locale via languageDirective.
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_PRIOR_TURNS = 6
const MAX_ANSWER_CHARS = 800

export interface PriorTurn {
  question: string
  answerText: string
}

/**
 * Load the prior Q&A turns referenced by a follow-up. Priors are bound to the SAME org AND
 * data source: the preamble asserts "the same data source", and a client that switched sources
 * mid-thread must never leak another source's Q&A into this run.
 */
export async function loadPriorTurns(
  admin: SupabaseClient,
  args: { orgId: string; dataSourceId: string; priorRunIds: string[] },
): Promise<PriorTurn[]> {
  const ids = args.priorRunIds.filter((x) => typeof x === 'string' && x.length > 0).slice(-MAX_PRIOR_TURNS)
  if (ids.length === 0) return []
  const { data } = await admin
    .from('agent_runs')
    .select('id, question, result, created_at')
    .in('id', ids)
    .eq('org_id', args.orgId)
    .eq('data_source_id', args.dataSourceId)
    .order('created_at', { ascending: true })
  return ((data ?? []) as Array<{ question: string; result: { text?: string } | null }>).map((t) => ({
    question: t.question,
    answerText: (t.result?.text ?? '').trim().slice(0, MAX_ANSWER_CHARS),
  }))
}

/** Prepend the prior conversation to a follow-up question. No priors → the raw question. */
export function buildThreadPreamble(turns: PriorTurn[], question: string): string {
  if (turns.length === 0) return question
  const history = turns
    .map(
      (t, i) =>
        `Previous question ${i + 1}: ${t.question}\nPrevious answer ${i + 1}: ${t.answerText || '(in progress)'}`,
    )
    .join('\n\n')
  return `The following is the prior conversation about the SAME data source. Continue from that context when answering the new question.\n\n${history}\n\n[New question]\n${question}`
}
