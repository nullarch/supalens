import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { resolveTaskBackend } from '../backend'
import { cronMatches, isValidCron, minuteKey } from './cron'
import { metadata, runs, task, tasks } from './sdk'
import { state } from './state'

const utc = (iso: string) => new Date(`${iso}Z`)
const settle = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  const s = state()
  s.tasks.clear()
  s.runs.clear()
  s.queue.length = 0
  s.active.clear()
  s.activeTotal = 0
  s.failureHooks.length = 0
  s.loaded = Promise.resolve() // tests register their own tasks; never import ./trigger
})

describe('task backend choice', () => {
  it('the hosted edition never runs tasks in the web server', () => {
    expect(resolveTaskBackend({ NEXT_PUBLIC_SUPALENS_EDITION: 'cloud' })).toBe('trigger')
    expect(resolveTaskBackend({})).toBe('trigger')
    expect(resolveTaskBackend({ NEXT_PUBLIC_SUPALENS_EDITION: 'cloud', SUPALENS_TASK_BACKEND: 'builtin' })).toBe('trigger')
  })

  it('self-hosted is built-in unless the operator brings Trigger.dev', () => {
    expect(resolveTaskBackend({ NEXT_PUBLIC_SUPALENS_EDITION: 'selfhost' })).toBe('builtin')
    expect(resolveTaskBackend({ NEXT_PUBLIC_SUPALENS_EDITION: 'selfhost', SUPALENS_TASK_BACKEND: 'trigger' })).toBe('trigger')
  })

  it('next.config.ts applies the same rule', () => {
    const config = readFileSync(resolve(__dirname, '../../../../next.config.ts'), 'utf8')
    expect(config).toContain('["selfhost", "self-hosted", "selfhosted"].includes(edition)')
    expect(config).toContain('!== "trigger"')
  })
})

describe('cron', () => {
  it('matches the schedules the tasks declare, in UTC', () => {
    expect(cronMatches('*/5 * * * *', utc('2026-11-12T10:15:30'))).toBe(true)
    expect(cronMatches('*/5 * * * *', utc('2026-11-12T10:16:00'))).toBe(false)
    expect(cronMatches('*/15 * * * *', utc('2026-11-12T10:45:00'))).toBe(true)
    expect(cronMatches('20 18 * * *', utc('2026-11-12T18:20:00'))).toBe(true)
    expect(cronMatches('20 18 * * *', utc('2026-11-12T18:21:00'))).toBe(false)
    // 2026-11-09 is a Monday
    expect(cronMatches('0 8 * * 1', utc('2026-11-09T08:00:00'))).toBe(true)
    expect(cronMatches('0 8 * * 1', utc('2026-11-10T08:00:00'))).toBe(false)
  })

  it('supports ranges and lists, and treats 7 as Sunday', () => {
    expect(cronMatches('0 9-17 * * 1-5', utc('2026-11-12T13:00:00'))).toBe(true)
    expect(cronMatches('0 9-17 * * 1-5', utc('2026-11-14T13:00:00'))).toBe(false) // Saturday
    expect(cronMatches('0,30 * * * *', utc('2026-11-12T13:30:00'))).toBe(true)
    expect(cronMatches('0 0 * * 7', utc('2026-11-15T00:00:00'))).toBe(true) // Sunday
  })

  it('rejects malformed expressions and keys by minute', () => {
    expect(isValidCron('*/5 * * * *')).toBe(true)
    expect(isValidCron('every five minutes')).toBe(false)
    expect(isValidCron('* * * *')).toBe(false)
    expect(minuteKey(utc('2026-11-12T10:15:05'))).toBe(minuteKey(utc('2026-11-12T10:15:55')))
  })
})

describe('built-in runner', () => {
  it('runs a task, publishes its stream and reports completion', async () => {
    task({
      id: 'echo',
      run: async (payload: { n: number }) => {
        async function* gen() {
          for (let i = 0; i < payload.n; i++) yield { i }
        }
        await metadata.stream('agent', gen())
      },
    })
    const handle = await tasks.trigger('echo', { n: 3, orgId: 'org-1', userId: 'user-1' })
    await settle()
    const run = state().runs.get(handle.id)!
    expect(run.status).toBe('COMPLETED')
    expect(run.orgId).toBe('org-1')
    expect(run.streams.get('agent')).toEqual({ chunks: [{ i: 0 }, { i: 1 }, { i: 2 }], closed: true })
  })

  it('a failing task ends FAILED and reaches the failure hooks', async () => {
    const seen: string[] = []
    tasks.onFailure(({ task: id }) => seen.push(id))
    task({ id: 'boom', run: async () => { throw new Error('nope') } })
    const handle = await tasks.trigger('boom', {})
    await settle()
    expect(state().runs.get(handle.id)).toMatchObject({ status: 'FAILED', error: 'nope' })
    expect(seen).toEqual(['boom'])
  })

  it('honours the per-key concurrency limit', async () => {
    let running = 0
    let peak = 0
    const release: Array<() => void> = []
    task({
      id: 'slow',
      queue: { concurrencyLimit: 1 },
      run: async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise<void>((r) => release.push(r))
        running--
      },
    })
    await tasks.trigger('slow', {}, { concurrencyKey: 'source-a' })
    await tasks.trigger('slow', {}, { concurrencyKey: 'source-a' })
    await tasks.trigger('slow', {}, { concurrencyKey: 'source-b' })
    await settle()
    expect(running).toBe(2) // one per key; the second source-a run waits
    release.splice(0).forEach((r) => r())
    await settle()
    expect(running).toBe(1)
    release.splice(0).forEach((r) => r())
    await settle()
    expect(peak).toBe(2)
    expect(running).toBe(0)
  })

  it('a cancelled queued run never executes', async () => {
    let ran = 0
    const release: Array<() => void> = []
    task({ id: 'gate', queue: { concurrencyLimit: 1 }, run: async () => { ran++; await new Promise<void>((r) => release.push(r)) } })
    await tasks.trigger('gate', {}, { concurrencyKey: 'k' })
    const second = await tasks.trigger('gate', {}, { concurrencyKey: 'k' })
    await runs.cancel(second.id)
    release.splice(0).forEach((r) => r())
    await settle()
    expect(ran).toBe(1)
    expect(state().runs.get(second.id)?.status).toBe('CANCELED')
  })

  it('refuses an unknown task id', async () => {
    await expect(tasks.trigger('missing', {})).rejects.toThrow('unknown task')
  })
})

describe('task list', () => {
  it('load-tasks.ts imports every task file outside ./trigger/cloud', () => {
    const dir = resolve(__dirname, '../../../../trigger')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'sentry.ts').map((f) => f.replace(/\.ts$/, ''))
    const loader = readFileSync(resolve(__dirname, 'load-tasks.ts'), 'utf8')
    for (const name of files) expect(loader, name).toContain(`trigger/${name}'`)
    expect(loader.split('\n').filter((line) => line.startsWith('import ') && line.includes('trigger/cloud'))).toEqual([])
  })
})
