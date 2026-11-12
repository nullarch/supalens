// PURE progress model for the unified onboarding scan — no io, no React, no server imports, so
// the Trigger task (producer) and the setup UI (consumer) agree on one shape.
//
// The rule this module exists to enforce: a counter is NEVER interpolated. Every number the user
// sees arrives as an event carrying a real count, and until such an event lands the count is
// `null` ("not known yet"), not 0 and not a rising fake. Phases that can only report at the end
// (entities/rules are counted by parsing the finished SUPALENS.md) emit `phase_done` with the
// count attached; phases that discover incrementally (KPI proposals) emit `item` as they go.

/** The three real units of work, in execution order — KPI extraction needs the context doc. */
export const BOOTSTRAP_PHASES = ['schema', 'context', 'kpi'] as const
export type BootstrapPhase = (typeof BOOTSTRAP_PHASES)[number]

/** Counters shown to the user. `tables` comes from the introspection cache, `entities`/`rules`
 *  from parsing the generated doc, `kpis` from validated proposals. */
export const BOOTSTRAP_METRICS = ['tables', 'entities', 'rules', 'kpis'] as const
export type BootstrapMetric = (typeof BOOTSTRAP_METRICS)[number]

export type PhaseState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface BootstrapEvent {
  /** Discriminator: this stream is shared with the agent's own CodeChunk frames. */
  type: 'bootstrap'
  phase: BootstrapPhase
  kind: 'phase_start' | 'phase_done' | 'phase_failed' | 'phase_skipped' | 'count' | 'item'
  /** `count` / `phase_done`: which counter this number belongs to. */
  metric?: BootstrapMetric
  count?: number
  /** `item`: the name of a single thing that was just found (an entity, a rule, a KPI). */
  label?: string
  error?: string
  /** epoch ms — the only clock the SLO measurement trusts. */
  at: number
}

export interface BootstrapProgress {
  phases: Record<BootstrapPhase, PhaseState>
  /** null = not measured yet. Never guess a number into this record. */
  counts: Record<BootstrapMetric, number | null>
  /** Names revealed so far, in arrival order (capped — this is a progress strip, not a list view). */
  items: Record<'entities' | 'rules' | 'kpis', string[]>
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

/** How many discovered names each strip keeps. Beyond this the count keeps climbing but the
 *  name list stops growing, so a 200-table schema can't push the page around. */
export const MAX_ITEMS_PER_METRIC = 12

export const INITIAL_PROGRESS: BootstrapProgress = {
  phases: { schema: 'pending', context: 'pending', kpi: 'pending' },
  counts: { tables: null, entities: null, rules: null, kpis: null },
  items: { entities: [], rules: [], kpis: [] },
  error: null,
  startedAt: null,
  finishedAt: null,
}

function itemBucket(metric: BootstrapMetric | undefined): 'entities' | 'rules' | 'kpis' | null {
  return metric === 'entities' || metric === 'rules' || metric === 'kpis' ? metric : null
}

/** Fold one event into the progress state. Pure and total: an unknown event shape is ignored
 *  rather than throwing, because this runs against a stream we do not control end-to-end. */
export function reduceBootstrap(state: BootstrapProgress, event: BootstrapEvent): BootstrapProgress {
  if (event.type !== 'bootstrap' || !BOOTSTRAP_PHASES.includes(event.phase)) return state

  const phases = { ...state.phases }
  const counts = { ...state.counts }
  const items = { entities: [...state.items.entities], rules: [...state.items.rules], kpis: [...state.items.kpis] }
  let { error, startedAt, finishedAt } = state

  switch (event.kind) {
    case 'phase_start':
      phases[event.phase] = 'running'
      if (startedAt == null) startedAt = event.at
      break
    case 'phase_done':
      phases[event.phase] = 'done'
      if (event.metric && typeof event.count === 'number') counts[event.metric] = event.count
      if (event.phase === 'kpi') finishedAt = event.at
      break
    case 'phase_skipped':
      // A resumed retry skips whatever already succeeded; it must not look like fresh work.
      phases[event.phase] = 'skipped'
      break
    case 'phase_failed':
      phases[event.phase] = 'failed'
      error = event.error ?? 'failed'
      finishedAt = event.at
      break
    case 'count':
      if (event.metric && typeof event.count === 'number') counts[event.metric] = event.count
      break
    case 'item': {
      const bucket = itemBucket(event.metric)
      if (bucket && event.label) {
        if (items[bucket].length < MAX_ITEMS_PER_METRIC) items[bucket].push(event.label)
        // An `item` implies at least this many exist, so the counter may lead the name list.
        counts[event.metric as BootstrapMetric] = (counts[event.metric as BootstrapMetric] ?? 0) + 1
      }
      break
    }
  }

  return { phases, counts, items, error, startedAt, finishedAt }
}

export function reduceAll(events: BootstrapEvent[], from: BootstrapProgress = INITIAL_PROGRESS): BootstrapProgress {
  return events.reduce(reduceBootstrap, from)
}

/** Wall-clock of the scan so far, for the 5-minute Golden Path SLO. null until it has started. */
export function bootstrapDurationMs(state: BootstrapProgress, now = Date.now()): number | null {
  if (state.startedAt == null) return null
  return (state.finishedAt ?? now) - state.startedAt
}

export function isTerminal(state: BootstrapProgress): boolean {
  if (state.phases.kpi === 'done') return true
  return BOOTSTRAP_PHASES.some((p) => state.phases[p] === 'failed')
}

/**
 * Which phase a RETRY should start from: the first one that is not already finished. A run whose
 * context succeeded and whose KPI extraction failed retries the KPI half only — re-cloning the
 * repo and re-running the authoring agent would burn a second LLM run for a doc we already have.
 * Returns null when there is nothing left to do.
 */
export function nextPhaseToRun(state: BootstrapProgress): BootstrapPhase | null {
  return BOOTSTRAP_PHASES.find((p) => state.phases[p] !== 'done' && state.phases[p] !== 'skipped') ?? null
}
