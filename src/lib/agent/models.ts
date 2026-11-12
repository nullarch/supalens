// NOT `import 'server-only'` — imported by the runners, which run in the Trigger.dev runtime.
//
// Single source of truth for which Claude model each surface uses. The three analysis runners
// (SQL / code / Firestore), KPI extraction, and SUPALENS.md generation all share ANALYSIS_MODEL,
// so the model never drifts across copies; background summarization (weekly digest, alert
// root-cause) uses the cheaper SYSTEM tier.
//
// Two tiers:
//   ANALYSIS — the interactive hero path + repo/schema reasoning (NL→SQL/code/Firestore, KPI
//              extraction, context authoring). Quality-first: the newest Sonnet.
//   SYSTEM   — background one-shot summarization (digest, alert explanation). A cheaper model
//              here cuts COGS with negligible product impact; Haiku is the current cheap tier.
//
// Env overrides (both runtimes): ANALYSIS_MODEL / SYSTEM_RUN_MODEL. Set them to retarget without
// a code change + redeploy — e.g. pin an older model, or promote SYSTEM to Sonnet 5.
//
// The defaults above are for the anthropic provider. With LLM_PROVIDER=openai the tiers come from
// LLM_MODEL / LLM_MODEL_SMALL (see src/lib/llm/provider.ts::resolveModels).
import { resolveModels } from '@/lib/llm/provider'

const models = resolveModels()
export const ANALYSIS_MODEL = models.analysis
export const SYSTEM_RUN_MODEL = models.system
