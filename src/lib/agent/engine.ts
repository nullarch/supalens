// PURE engine→dispatch mapping. Deliberately imports NO runners so the Vercel BFF / MCP can
// import taskIdForEngine WITHOUT pulling the Claude Agent SDK into their bundle (the whole reason
// the agent runs on Trigger, not Vercel). The in-process runner mapping lives in ./run-by-engine
// (which DOES import the runners) — imported only by the SSE route + messenger-answer task.
import { isDocumentEngine, isSqlEngine } from '@/lib/data-sources/engines'

export type AgentTaskId = 'analyze' | 'analyze-firestore'

/**
 * Trigger task id for a data source engine. THE single place engine→task-id is decided
 * (BFF `/api/agent/analyze`, MCP `ask` dispatch cross-process by id). A new engine family adds
 * its branch here + a runner branch in ./run-by-engine — nowhere else. Whitelist, not blacklist:
 * an engine neither SQL nor document THROWS instead of silently running down the SQL path.
 * null/undefined stays on the SQL task (rows predating the engine column / demo sources).
 */
export function taskIdForEngine(engine: string | null | undefined): AgentTaskId {
  if (isDocumentEngine(engine)) return 'analyze-firestore'
  if (engine == null || isSqlEngine(engine)) return 'analyze'
  throw new Error(`no analysis task registered for engine "${engine}" — add it to taskIdForEngine + runByEngine`)
}
