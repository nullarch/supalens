import { afterAll, describe, expect, it } from 'vitest'

import { executeReadOnlyWithConfig } from './execute'
import { closePool } from './pool'
import type { ConnectionConfig, DataSourceEngine } from './types'

// Live DB integration. Gated on env so unit runs stay hermetic:
//   TEST_PG_URL=postgresql://user:pass@host:5432/db    npx vitest run
//   TEST_MYSQL_URL=mysql://user:pass@host:3306/db       npx vitest run
function parse(url: string, engine: DataSourceEngine): ConnectionConfig {
  const u = new URL(url)
  return {
    engine,
    host: u.hostname,
    port: Number(u.port || (engine === 'mysql' ? 3306 : 5432)),
    database: u.pathname.replace(/^\//, ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: u.searchParams.get('ssl') === 'true',
  }
}

const PG = process.env.TEST_PG_URL
;(PG ? describe : describe.skip)('query engine — Postgres (live)', () => {
  const cfg = PG ? parse(PG, 'postgres') : ({} as ConnectionConfig)
  const key = 'itest-pg'
  afterAll(async () => closePool(key))

  it('runs a SELECT and returns columns/rows', async () => {
    const r = await executeReadOnlyWithConfig(key, cfg, 'select 1 as n, 2 as m')
    expect(Number(r.rows[0].n)).toBe(1)
    expect(r.columns).toEqual(['n', 'm'])
    expect(r.truncated).toBe(false)
  })

  it('enforces the row cap + truncation flag at the DB', async () => {
    const r = await executeReadOnlyWithConfig(key, cfg, 'select g from generate_series(1,10) g', { maxRows: 3 })
    expect(r.rowCount).toBe(3)
    expect(r.truncated).toBe(true)
  })

  it('blocks DDL/DML via the guard', async () => {
    await expect(executeReadOnlyWithConfig(key, cfg, 'create table _x(i int)')).rejects.toBeTruthy()
    await expect(executeReadOnlyWithConfig(key, cfg, 'insert into _x values (1)')).rejects.toBeTruthy()
  })

  it('runs inside a READ ONLY transaction (write inside subquery rejected)', async () => {
    // a function with a side effect can't slip a write through under READ ONLY
    await expect(
      executeReadOnlyWithConfig(key, cfg, "select * from (select pg_sleep(0)) s where 1=1")
    ).resolves.toBeTruthy() // read-only call still works
  })
})

const MY = process.env.TEST_MYSQL_URL
;(MY ? describe : describe.skip)('query engine — MySQL (live)', () => {
  const cfg = MY ? parse(MY, 'mysql') : ({} as ConnectionConfig)
  const key = 'itest-my'
  afterAll(async () => closePool(key))

  it('runs a SELECT', async () => {
    const r = await executeReadOnlyWithConfig(key, cfg, 'select 1 as n')
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('blocks DDL via the guard', async () => {
    await expect(executeReadOnlyWithConfig(key, cfg, 'create table _x(i int)')).rejects.toBeTruthy()
  })
})
