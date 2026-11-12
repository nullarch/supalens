// Cron ticker for the built-in backend: once a minute, enqueue every scheduled task whose
// expression matches the current UTC minute. Started once per process from instrumentation.ts.
import { cronMatches, isValidCron, minuteKey } from './cron'
import { ensureTasksLoaded, tasks } from './sdk'
import { reapInterruptedRuns } from './reap'
import { state } from './state'

async function tick(now = new Date()): Promise<void> {
  const s = state()
  const minute = minuteKey(now)
  for (const task of s.tasks.values()) {
    if (!task.cron || !isValidCron(task.cron)) continue
    if (s.lastCronMinute.get(task.id) === minute) continue
    if (!cronMatches(task.cron, now)) continue
    s.lastCronMinute.set(task.id, minute)
    try {
      await tasks.trigger(task.id, { timestamp: now, timezone: 'UTC' })
    } catch (error) {
      console.error(`[tasks] could not schedule ${task.id}:`, error)
    }
  }
}

/**
 * Start the scheduler (idempotent). On boot it also fails every run a previous process left
 * queued or running — with an in-memory queue those can never finish.
 */
export async function startScheduler(): Promise<void> {
  const s = state()
  if (s.schedulerStarted) return
  s.schedulerStarted = true
  try {
    await ensureTasksLoaded()
  } catch (error) {
    s.schedulerStarted = false
    console.error('[tasks] built-in backend failed to load its tasks:', error)
    return
  }
  const scheduled = [...s.tasks.values()].filter((t) => t.cron)
  console.log(`[tasks] built-in backend ready: ${s.tasks.size} tasks, ${scheduled.length} scheduled`)

  const timer = setInterval(() => void tick().catch((e) => console.error('[tasks] scheduler tick failed:', e)), 20_000)
  timer.unref?.()

  // a moment later: in the bundled stack the gateway in front of the database starts after us
  const reap = setTimeout(() => void reapInterruptedRuns().catch((e) => console.error('[tasks] boot reap failed:', e)), 8_000)
  reap.unref?.()
}
