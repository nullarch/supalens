// NOT `import 'server-only'` — runs on the Trigger.dev host (agent session + claude subprocess,
// and a repo clone for tier-2), same convention as lib/context/generate.ts.
//
// This is the body of the `extract-kpis` task, lifted VERBATIM so the unified onboarding scan
// (`trigger/bootstrap-business.ts`) can run the exact same extraction instead of a second copy of
// it. Both callers are Trigger tasks: the installation token is minted HERE, on the host, and
// lives only in this closure (runCodeAnalysis strips it from the subprocess env).
//
// Metering invariant: `incrementUsage` fires exactly once per extraction, inside this function.
// A caller must NOT meter again around it.
import { runAnalysis } from '@/lib/agent/run-analysis'
import { runCodeAnalysis } from '@/lib/code-agent/run-code-analysis'
import { getInstallationToken } from '@/lib/github-app/installation-token'
import { buildKpiExtractPrompt } from '@/lib/kpi/prompt'
import { upsertProposal, upsertProposals, completeExtraction, failExtraction } from '@/lib/kpi/service'
import { incrementUsage } from '@/lib/plans/usage'
import type { KpiCategory, KpiProposal, KpiSink } from '@/lib/kpi/types'
import { persistableError } from '@/lib/supabase-oauth/errors'
import { resolveOrgLocale } from '@/lib/i18n/resolve-locale'
import { ensureDraftBoard } from '@/lib/kpi/draft-board'
import * as Sentry from '@sentry/node'

export interface RunKpiExtractionArgs {
  orgId: string
  dataSourceId: string
  extractionId: string
  tier: 1 | 2
  /** Major-category scope from the extraction modal; absent = every category. */
  categories?: KpiCategory[]
  // tier-2 only (repo attached):
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
  userId?: string
  model?: string
  maxTurns?: number
  /** Called as each proposal is validated, for live progress. Must never throw. */
  onProposal?: (p: KpiProposal) => void
}

export interface RunKpiExtractionResult {
  ok: boolean
  proposed: number
  error?: string
}

/**
 * Run the KPI-extraction agent for a data source and persist its validated proposals.
 *
 * Two tiers (same split as the SUPALENS.md context generator):
 *   tier 2 — repo attached: mint the installation token HERE on the host (never in the BFF payload
 *     or the subprocess), then runCodeAnalysis with the data source bound so the agent reads BOTH
 *     the code and the live schema (service-specific funnel/custom KPIs — the differentiator).
 *   tier 1 — DB only: runAnalysis with the schema tools; instantiate the template menu.
 * Either way the agent loops get_schema → execute_sql (returns a queryId) → propose_kpi, and the
 * kpiSink collects each validated proposal (the tool itself touches no DB — the lockdown holds).
 *
 * Terminal state is guaranteed: every fault path stamps `failExtraction` so an extraction never
 * sticks at 'running'. Thrown faults are rethrown for the caller's Sentry hook.
 */
export async function runKpiExtraction(args: RunKpiExtractionArgs): Promise<RunKpiExtractionResult> {
  // Collect proposals as the agent registers them, AND persist each one immediately so the review
  // UI's count climbs live during the run (the browser polls kpi_catalog every few seconds). The
  // incremental write is best-effort — the end-of-run batch upsert below is authoritative, so a
  // transient failure here can't drop a proposal.
  const proposals: KpiProposal[] = []
  const kpiSink: KpiSink = {
    onKpi: async (p) => {
      proposals.push(p)
      try {
        args.onProposal?.(p)
      } catch {
        /* progress reporting must never break an extraction */
      }
      try {
        await upsertProposal({
          orgId: args.orgId,
          dataSourceId: args.dataSourceId,
          extractionId: args.extractionId,
          proposal: p,
        })
      } catch {
        /* live-count nicety only; the authoritative upsertProposals batch runs at the end */
      }
    },
  }

  try {
    let result: { ok: boolean; tokensIn: number; tokensOut: number; error?: string }
    if (args.tier === 2) {
      const { installationId, fullName } = args
      if (installationId == null || !fullName) {
        throw new Error('[kpi] tier-2 extraction requires installationId and fullName')
      }
      // Mint the installation token on the host; it lives only in this closure (used for the
      // clone) and is stripped from the subprocess env by runCodeAnalysis.
      const token = await getInstallationToken(installationId)
      result = await runCodeAnalysis({
        runId: args.extractionId,
        fullName,
        token,
        question: buildKpiExtractPrompt({ tier: 2, categories: args.categories }),
        ref: args.ref,
        sparsePaths: args.sparsePaths,
        dataSourceId: args.dataSourceId, // binds read-only SQL tools → code × DB extraction
        kpiSink,
        model: args.model,
        maxTurns: args.maxTurns ?? 40,
      })
    } else {
      result = await runAnalysis({
        orgId: args.orgId,
        dataSourceId: args.dataSourceId,
        // non-BFF system run: no pre-existing agent_runs row, no persistRun — the extractionId
        // is the run identifier (actor.id + cwd only), exactly as alerts/explain.ts does it.
        userId: args.userId ?? 'system',
        runId: args.extractionId,
        question: buildKpiExtractPrompt({ tier: 1, categories: args.categories }),
        kpiSink,
        model: args.model,
        maxTurns: args.maxTurns ?? 40,
      })
    }

    // Run completed but failed (e.g. token budget / agent error): mark failed and return an
    // error result (the graceful path, mirroring runContextGeneration's `!result.ok` branch;
    // the catch below handles thrown faults). STILL meter it — the tokens were spent
    // (persistRun meters failed agent runs the same way); only thrown faults go unmetered.
    if (!result.ok) {
      await failExtraction(args.extractionId, result.error ?? 'extraction run failed')
      await incrementUsage(args.orgId, 1, result.tokensIn + result.tokensOut)
      return { ok: false, error: result.error, proposed: 0 }
    }

    // Persist whatever the run produced. An honest empty catalog (0 proposals) still COMPLETES —
    // a fake failure would be worse. upsertProposals no-ops on an empty batch.
    await upsertProposals({
      orgId: args.orgId,
      dataSourceId: args.dataSourceId,
      extractionId: args.extractionId,
      proposals,
    })
    await completeExtraction(args.extractionId, proposals.length)

    // The AI drafts the dashboard: turn the most important proposals into widgets on the auto-KPI
    // board so the overview shows real charts before review (widgets only — monitors still need
    // approval). Best-effort: a draft fault never fails the extraction that already succeeded.
    try {
      const locale = await resolveOrgLocale(args.orgId).catch(() => undefined)
      await ensureDraftBoard({ orgId: args.orgId, dataSourceId: args.dataSourceId, userId: args.userId ?? null, locale })
    } catch (e) {
      console.warn('[kpi] draft board failed:', e)
      Sentry.captureException(e, { tags: { area: 'kpi_draft_board' } })
    }

    // Meter the LLM run exactly once, post-run — same seam as runContextGeneration (1 query +
    // total tokens) so extraction isn't a free, unmetered path. incrementUsage never throws.
    await incrementUsage(args.orgId, 1, result.tokensIn + result.tokensOut)

    return { ok: true, proposed: proposals.length }
  } catch (err) {
    // token mint / agent / persistence fault: stamp a terminal failed state so the extraction
    // never sticks at 'running', then rethrow so the caller's Sentry hook fires.
    await failExtraction(args.extractionId, persistableError(err, String(err).slice(0, 200)))
    throw err
  }
}
