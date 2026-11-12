// Built-in task backend: a drop-in for the parts of `@trigger.dev/sdk` this codebase uses, running
// tasks inside the web server process. A self-hosted build aliases `@trigger.dev/sdk` to this file
// (see next.config.ts), so the task definitions in ./trigger and every call site stay exactly as
// they are; the hosted service keeps using the real SDK and never loads this.
//
// What it is: an in-memory queue with per-key concurrency, stream buffers, and a cron ticker.
// What it is not: durable. A restart drops queued and running work (stuck rows are reaped at
// boot and by the maintenance job), and there is no per-run container — one process runs
// everything. That is the right trade for a single-tenant install; it is why the hosted service
// does not use it.
import { randomUUID } from 'node:crypto'

import { notify, state, sweepRuns, type LocalRun, type TaskDefinition } from './state'

const MAX_CONCURRENT = Math.max(1, Number(process.env.SUPALENS_MAX_CONCURRENT_TASKS ?? 4) || 4)

interface TriggerOptions {
  concurrencyKey?: string
}

interface TaskConfig {
  id: string
  run: (payload: never, context: { ctx: { run: { id: string } } }) => Promise<unknown>
  queue?: { concurrencyLimit?: number }
  cron?: string
  [key: string]: unknown
}

/** The task modules register themselves on import; this imports them once, on first use. */
export function ensureTasksLoaded(): Promise<void> {
  const s = state()
  if (!s.loaded) {
    s.loaded = import('./load-tasks').then(() => undefined).catch((error) => {
      s.loaded = null
      throw error
    })
  }
  return s.loaded
}

function slotKey(taskId: string, key: string): string {
  return `${taskId}:${key}`
}

function pump(): void {
  const s = state()
  for (let i = 0; i < s.queue.length && s.activeTotal < MAX_CONCURRENT; ) {
    const item = s.queue[i]
    const slot = slotKey(item.task.id, item.key)
    const limit = item.task.concurrencyLimit ?? Infinity
    if ((s.active.get(slot) ?? 0) >= limit) {
      i++
      continue
    }
    s.queue.splice(i, 1)
    if (item.run.status === 'CANCELED') continue
    s.active.set(slot, (s.active.get(slot) ?? 0) + 1)
    s.activeTotal++
    void execute(item.run, item.task, item.payload).finally(() => {
      const left = (s.active.get(slot) ?? 1) - 1
      if (left <= 0) s.active.delete(slot)
      else s.active.set(slot, left)
      s.activeTotal--
      pump()
    })
  }
}

async function execute(run: LocalRun, task: TaskDefinition, payload: unknown): Promise<void> {
  const s = state()
  run.status = 'EXECUTING'
  notify(run)
  try {
    await s.context.run(run, () => task.run(payload, { ctx: { run: { id: run.id } } }))
    if (run.status === 'EXECUTING') run.status = 'COMPLETED'
  } catch (error) {
    if (run.status === 'EXECUTING') run.status = 'FAILED'
    run.error = String(error instanceof Error ? error.message : error).slice(0, 500)
    console.error(`[tasks] ${task.id} failed:`, error)
    for (const hook of s.failureHooks) {
      try {
        hook({ task: task.id, payload, error })
      } catch {
        /* a reporting hook must never mask the task failure */
      }
    }
  } finally {
    run.endedAt = Date.now()
    for (const stream of run.streams.values()) stream.closed = true
    notify(run)
    sweepRuns()
  }
}

function enqueue(taskId: string, payload: unknown, options?: TriggerOptions): { id: string } {
  const s = state()
  const task = s.tasks.get(taskId)
  if (!task) throw new Error(`[tasks] unknown task "${taskId}"`)
  const p = (payload ?? {}) as { orgId?: unknown; userId?: unknown }
  const run: LocalRun = {
    id: `run_${randomUUID()}`,
    taskId,
    status: 'QUEUED',
    createdAt: Date.now(),
    orgId: typeof p.orgId === 'string' ? p.orgId : undefined,
    userId: typeof p.userId === 'string' && p.userId ? p.userId : undefined,
    streams: new Map(),
    listeners: new Set(),
  }
  s.runs.set(run.id, run)
  s.queue.push({ run, task, payload, key: options?.concurrencyKey ?? '' })
  pump()
  return { id: run.id }
}

function define(config: TaskConfig) {
  const definition: TaskDefinition = {
    id: config.id,
    run: config.run as TaskDefinition['run'],
    concurrencyLimit: config.queue?.concurrencyLimit,
    cron: config.cron,
  }
  state().tasks.set(config.id, definition)
  return {
    id: config.id,
    trigger: async (payload: unknown, options?: TriggerOptions) => enqueue(config.id, payload, options),
    batchTrigger: async (items: Array<{ payload: unknown; options?: TriggerOptions }>) => ({
      runs: items.map((item) => enqueue(config.id, item.payload, item.options)),
    }),
  }
}

// ---- the SDK surface the codebase uses -------------------------------------------------

export const task = define

export const schedules = { task: define }

export const tasks = {
  async trigger(taskId: string, payload: unknown, options?: TriggerOptions): Promise<{ id: string }> {
    await ensureTasksLoaded()
    return enqueue(taskId, payload, options)
  },
  onFailure(hook: (info: { task: string; payload: unknown; error: unknown }) => void): void {
    state().failureHooks.push(hook)
  },
}

export const metadata = {
  /** Publish an async stream under `name` for whoever is tailing this run. Resolves when drained. */
  async stream<T>(name: string, iterable: AsyncIterable<T>): Promise<void> {
    const run = state().context.getStore()
    if (!run) {
      for await (const chunk of iterable) void chunk
      return
    }
    const buffer = run.streams.get(name) ?? { chunks: [], closed: false }
    run.streams.set(name, buffer)
    try {
      for await (const chunk of iterable) {
        buffer.chunks.push(chunk)
        notify(run)
      }
    } finally {
      buffer.closed = true
      notify(run)
    }
  },
  set(): void {},
  append(): void {},
}

export const auth = {
  /** Streams are read through /api/tasks/runs/[id]/events with the user's own session, so no
   *  run-scoped token exists; callers still get a non-empty string to hand to the browser. */
  async createPublicToken(): Promise<string> {
    return 'builtin'
  },
}

export const runs = {
  /** Stops delivery and marks the run cancelled. In-process work cannot be killed, so a task
   *  already executing runs to its end; its result is discarded by the run-record cancel guard. */
  async cancel(runId: string): Promise<void> {
    const run = state().runs.get(runId)
    if (!run || run.endedAt) return
    run.status = 'CANCELED'
    run.endedAt = Date.now()
    for (const stream of run.streams.values()) stream.closed = true
    notify(run)
  },
}
