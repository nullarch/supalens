// NOT `import 'server-only'` — runs on the Trigger.dev host (clone + agent subprocess), same
// convention as lib/context/generate.ts and lib/kpi/run-extraction.ts.
//
// The unified onboarding scan: schema → understanding → KPIs, as ONE job. This module is pure
// ORCHESTRATION. It calls `syncSchemaCache`, `generateBaselineContext` / `runContextGeneration`
// and `runKpiExtraction` exactly as the standalone paths do — no forked logic, and in particular
// no metering of its own: each underlying run still increments usage exactly once, inside itself.
//
// Every number it reports is measured, never interpolated: the table count is what the
// introspection cache actually wrote, entities/rules come from parsing the finished SUPALENS.md,
// and each KPI is announced as the agent validates it.
import { generateBaselineContext } from '@/lib/context/baseline'
import { runContextGeneration } from '@/lib/context/generate'
import { closeContextRunRow, openContextRunRow } from '@/lib/context/run-record'
import { getSourceContext, markContextFailed } from '@/lib/context/service'
import { parseSupalensMd, summarizeContext } from '@/lib/context/parse'
import { syncSchemaCache } from '@/lib/data-sources/introspect-cache'
import { getInstallationToken } from '@/lib/github-app/installation-token'
import { runKpiExtraction } from '@/lib/kpi/run-extraction'
import type { KpiCategory } from '@/lib/kpi/types'
import { BOOTSTRAP_PHASES, MAX_ITEMS_PER_METRIC, type BootstrapEvent, type BootstrapPhase } from './events'
import { persistableError } from '@/lib/supabase-oauth/errors'

export interface RunBootstrapArgs {
  orgId: string
  dataSourceId: string
  /** Correlation id; doubles as the context generation's runId (and its run-row id). */
  runId: string
  /** Pre-created by the BFF so it can 409 on a concurrent scan before spending anything. */
  extractionId: string
  tier: 1 | 2
  /** Phases a retry must not redo (already succeeded). */
  skipPhases?: BootstrapPhase[]
  categories?: KpiCategory[]
  // tier-2 only:
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
  /** SQL engines get the read-only DB tools during context authoring; Firestore runs code-only. */
  withDb: boolean
  userId?: string
  emit: (e: BootstrapEvent) => void
}

export interface RunBootstrapResult {
  ok: boolean
  failedPhase?: BootstrapPhase
  error?: string
  counts: { tables: number | null; entities: number | null; rules: number | null; kpis: number | null }
}

export async function runBootstrapBusiness(args: RunBootstrapArgs): Promise<RunBootstrapResult> {
  const skip = new Set<BootstrapPhase>(args.skipPhases ?? [])
  const counts: RunBootstrapResult['counts'] = { tables: null, entities: null, rules: null, kpis: null }
  const emit = (e: Omit<BootstrapEvent, 'type' | 'at'>) => {
    try {
      args.emit({ type: 'bootstrap', at: Date.now(), ...e })
    } catch {
      /* a broken stream must never fail the scan */
    }
  }

  for (const phase of BOOTSTRAP_PHASES) {
    if (skip.has(phase)) emit({ phase, kind: 'phase_skipped' })
  }

  // ── 1. schema ───────────────────────────────────────────────────────────────────────────
  // Fatal on failure: an unreachable database makes the next two phases meaningless, and a
  // "0 tables" doc would be worse than an honest stop.
  if (!skip.has('schema')) {
    emit({ phase: 'schema', kind: 'phase_start' })
    try {
      const { objectCount } = await syncSchemaCache(args.dataSourceId)
      counts.tables = objectCount
      emit({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: objectCount })
    } catch (err) {
      const error = String(err).slice(0, 200)
      emit({ phase: 'schema', kind: 'phase_failed', error })
      return { ok: false, failedPhase: 'schema', error, counts }
    }
  }

  // ── 2. understanding (SUPALENS.md) ──────────────────────────────────────────────────────
  if (!skip.has('context')) {
    emit({ phase: 'context', kind: 'phase_start' })
    try {
      if (args.tier === 2) {
        const { installationId, fullName, repoId } = args
        if (installationId == null || !fullName || !repoId) {
          throw new Error('[bootstrap] tier-2 scan requires repoId, installationId and fullName')
        }
        // Daily-cap accounting, identical to the standalone generate-context task.
        await openContextRunRow({
          runId: args.runId,
          orgId: args.orgId,
          repoId,
          dataSourceId: args.dataSourceId,
          userId: args.userId,
          ref: args.ref,
        })
        let res: { ok: boolean; error?: string }
        try {
          // Mint the installation token HERE on the host; it lives only in this closure.
          const token = await getInstallationToken(installationId)
          res = await runContextGeneration({
            dataSourceId: args.dataSourceId,
            orgId: args.orgId,
            runId: args.runId,
            repoId,
            fullName,
            token,
            ref: args.ref,
            sparsePaths: args.sparsePaths,
            withDb: args.withDb,
            userId: args.userId,
          })
        } catch (err) {
          await markContextFailed(args.dataSourceId, args.orgId, persistableError(err, String(err).slice(0, 200)))
          await closeContextRunRow(args.runId, false, String(err))
          throw err
        }
        await closeContextRunRow(args.runId, res.ok, res.error)
        if (!res.ok) {
          const error = res.error ?? 'context generation failed'
          emit({ phase: 'context', kind: 'phase_failed', error })
          return { ok: false, failedPhase: 'context', error, counts }
        }
      } else {
        // tier-1: deterministic schema digest — no clone, no LLM, nothing to meter.
        await generateBaselineContext(args.dataSourceId)
      }

      // Counts are only knowable once the doc exists, so they are reported here, at the end.
      // Names go out first (so the UI can show WHAT was found, not just how many), then the
      // authoritative total — `count` overwrites the item tally, so a capped name list cannot
      // understate a large doc.
      const ctx = await getSourceContext(args.dataSourceId)
      if (ctx?.contentMd) {
        const parsed = parseSupalensMd(ctx.contentMd)
        const summary = summarizeContext(parsed)
        counts.entities = summary.entities
        counts.rules = summary.rules
        for (const e of parsed.entities.slice(0, MAX_ITEMS_PER_METRIC)) {
          emit({ phase: 'context', kind: 'item', metric: 'entities', label: e.name })
        }
        emit({ phase: 'context', kind: 'count', metric: 'entities', count: summary.entities })
        for (const r of parsed.rules.slice(0, MAX_ITEMS_PER_METRIC)) {
          emit({ phase: 'context', kind: 'item', metric: 'rules', label: r.text })
        }
        emit({ phase: 'context', kind: 'count', metric: 'rules', count: summary.rules })
      }
      emit({ phase: 'context', kind: 'phase_done' })
    } catch (err) {
      const error = String(err).slice(0, 200)
      emit({ phase: 'context', kind: 'phase_failed', error })
      return { ok: false, failedPhase: 'context', error, counts }
    }
  }

  // ── 3. KPI proposals ────────────────────────────────────────────────────────────────────
  if (!skip.has('kpi')) {
    emit({ phase: 'kpi', kind: 'phase_start' })
    try {
      const res = await runKpiExtraction({
        orgId: args.orgId,
        dataSourceId: args.dataSourceId,
        extractionId: args.extractionId,
        tier: args.tier,
        categories: args.categories,
        repoId: args.repoId,
        installationId: args.installationId,
        fullName: args.fullName,
        ref: args.ref,
        sparsePaths: args.sparsePaths,
        userId: args.userId,
        // Each validated proposal is announced the moment the agent registers it.
        onProposal: (p) => emit({ phase: 'kpi', kind: 'item', metric: 'kpis', label: p.title }),
      })
      counts.kpis = res.proposed
      if (!res.ok) {
        const error = res.error ?? 'kpi extraction failed'
        emit({ phase: 'kpi', kind: 'phase_failed', error })
        return { ok: false, failedPhase: 'kpi', error, counts }
      }
      emit({ phase: 'kpi', kind: 'phase_done', metric: 'kpis', count: res.proposed })
    } catch (err) {
      // runKpiExtraction has already stamped failExtraction; report and stop.
      const error = String(err).slice(0, 200)
      emit({ phase: 'kpi', kind: 'phase_failed', error })
      return { ok: false, failedPhase: 'kpi', error, counts }
    }
  }

  return { ok: true, counts }
}
