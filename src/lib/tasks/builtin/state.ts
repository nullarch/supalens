// In-process task runner state for the built-in backend (a self-hosted install without
// Trigger.dev). Everything lives on globalThis: the Next.js server builds route handlers, the
// instrumentation hook and server actions as separate bundles, and each would otherwise get its
// own copy of a module-level Map.
import { AsyncLocalStorage } from 'node:async_hooks'

export type RunStatus = 'QUEUED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELED'

export interface TaskDefinition {
  id: string
  run: (payload: unknown, context: { ctx: { run: { id: string } } }) => Promise<unknown>
  /** Max concurrent runs per concurrency key (the task's `queue.concurrencyLimit`). */
  concurrencyLimit?: number
  cron?: string
}

export interface StreamBuffer {
  chunks: unknown[]
  closed: boolean
}

export interface LocalRun {
  id: string
  taskId: string
  status: RunStatus
  createdAt: number
  endedAt?: number
  error?: string
  /** Who may read this run's streams (taken from the payload when present). */
  orgId?: string
  userId?: string
  streams: Map<string, StreamBuffer>
  listeners: Set<() => void>
}

interface QueuedRun {
  run: LocalRun
  task: TaskDefinition
  payload: unknown
  key: string
}

interface State {
  tasks: Map<string, TaskDefinition>
  runs: Map<string, LocalRun>
  queue: QueuedRun[]
  /** Running count per `${taskId}:${concurrencyKey}`. */
  active: Map<string, number>
  activeTotal: number
  failureHooks: Array<(info: { task: string; payload: unknown; error: unknown }) => void>
  loaded: Promise<void> | null
  schedulerStarted: boolean
  lastCronMinute: Map<string, number>
  context: AsyncLocalStorage<LocalRun>
}

const KEY = Symbol.for('supalens.builtin-tasks')

export function state(): State {
  const g = globalThis as unknown as Record<symbol, State | undefined>
  if (!g[KEY]) {
    g[KEY] = {
      tasks: new Map(),
      runs: new Map(),
      queue: [],
      active: new Map(),
      activeTotal: 0,
      failureHooks: [],
      loaded: null,
      schedulerStarted: false,
      lastCronMinute: new Map(),
      context: new AsyncLocalStorage<LocalRun>(),
    }
  }
  return g[KEY]!
}

/** Wake everyone tailing this run's streams or status. */
export function notify(run: LocalRun): void {
  for (const listener of [...run.listeners]) listener()
}

/** Finished runs stay readable for a while (a browser may connect late), then are dropped. */
const RETAIN_MS = 15 * 60_000
const MAX_RUNS = 500

export function sweepRuns(now = Date.now()): void {
  const s = state()
  for (const [id, run] of s.runs) {
    if (run.endedAt && now - run.endedAt > RETAIN_MS) s.runs.delete(id)
  }
  if (s.runs.size > MAX_RUNS) {
    const finished = [...s.runs.values()].filter((r) => r.endedAt).sort((a, b) => a.endedAt! - b.endedAt!)
    for (const run of finished.slice(0, s.runs.size - MAX_RUNS)) s.runs.delete(run.id)
  }
}
