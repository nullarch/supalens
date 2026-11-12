// The surface that produced an agent run (`agent_runs.channel`).
//
// Deliberately dependency-free: the run-creation core (which pulls the Trigger SDK),
// the alerts host runtime, and a server-rendered history page all need these, and none
// of them should drag the others' imports in. NOT `import 'server-only'` — reached from
// the Trigger.dev bundle through alerts/explain.ts.

/** Historical rows predate the column and read as `web`. `monitor` = a goal → monitor drafting run
 *  (/app/monitors composer, migration 20260927110005). */
export const RUN_CHANNELS = ['web', 'slack', 'mcp', 'incident', 'digest', 'system', 'monitor'] as const

export type RunChannel = (typeof RUN_CHANNELS)[number]

export function isRunChannel(v: unknown): v is RunChannel {
  return typeof v === 'string' && (RUN_CHANNELS as readonly string[]).includes(v)
}

/** NULL (pre-migration rows, and rows written before this column existed) means `web`. */
export function channelOf(v: unknown): RunChannel {
  return isRunChannel(v) ? v : 'web'
}

/**
 * Postgres `undefined_column`. The column ships in a migration that may not be applied
 * yet, so every reader and writer degrades on exactly this code instead of failing the
 * request — the same fail-open convention the incident-ack columns use.
 */
export const UNDEFINED_COLUMN = '42703'

export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === UNDEFINED_COLUMN) return true
  // PostgREST sometimes surfaces the schema-cache miss instead of the raw SQLSTATE.
  return typeof e.message === 'string' && /column .*channel.* does not exist/i.test(e.message)
}
