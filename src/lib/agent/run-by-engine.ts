// In-process engine→runner mapping. Imports BOTH runners (Claude Agent SDK), so it must only be
// imported by contexts that already run the agent in-process: the local-dev SSE route and the
// messenger-answer Trigger task. NEVER import this from the Vercel BFF / MCP — use ./engine's
// taskIdForEngine there (which triggers the task cross-process and stays SDK-free).
// NOT `import 'server-only'` — reached by the Trigger runtime.
import { isDocumentEngine, isSqlEngine } from '@/lib/data-sources/engines'
import { runAnalysis, type RunAnalysisArgs, type AnalysisResult } from './run-analysis'
import { runFirestoreAnalysis } from '@/lib/firestore-agent/run-firestore-analysis'

/**
 * Run the analysis for a data source engine in-process. SINGLE place engine→runner is decided.
 * `RunAnalysisArgs` is a superset of the Firestore runner's args (extra fields optional), so the
 * same args object feeds either runner. Whitelist (mirrors taskIdForEngine): an unknown engine
 * throws instead of silently running the SQL runner against a source it cannot query.
 */
export function runByEngine(engine: string | null | undefined, args: RunAnalysisArgs): Promise<AnalysisResult> {
  if (isDocumentEngine(engine)) return runFirestoreAnalysis(args)
  if (engine == null || isSqlEngine(engine)) return runAnalysis(args)
  throw new Error(`no analysis runner registered for engine "${engine}" — add it to runByEngine + taskIdForEngine`)
}
