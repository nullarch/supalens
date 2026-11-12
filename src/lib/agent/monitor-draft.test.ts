import { describe, expect, it } from 'vitest'

import { buildMonitorHref, looksMultiColumn } from './monitor-draft'

describe('looksMultiColumn', () => {
  it('accepts a single scalar aggregate as monitorable', () => {
    expect(looksMultiColumn('select sum(amount) from orders')).toBe(false)
    expect(looksMultiColumn('SELECT count(*) FROM users WHERE deleted_at IS NULL')).toBe(false)
    expect(looksMultiColumn('select 1')).toBe(false)
  })

  it('is not fooled by commas inside function calls', () => {
    expect(looksMultiColumn("select coalesce(sum(amount), 0) from orders")).toBe(false)
    expect(looksMultiColumn("select round(100.0 * a / nullif(b, 0), 2) from t")).toBe(false)
  })

  it('flags a real multi-column select list', () => {
    expect(looksMultiColumn('select category, sum(amount) from orders group by 1')).toBe(true)
    expect(looksMultiColumn('select date_trunc(\'day\', created_at) as d, count(*) from users group by 1')).toBe(true)
  })

  it('flags star selects', () => {
    expect(looksMultiColumn('select * from orders limit 10')).toBe(true)
  })

  it('ignores commas and the word FROM inside string literals', () => {
    expect(looksMultiColumn("select sum(amount) from orders where note = 'a, b'")).toBe(false)
    expect(looksMultiColumn("select sum(amount) filter (where tag = 'from') from orders")).toBe(false)
  })

  it('never throws on input it cannot read', () => {
    expect(looksMultiColumn('')).toBe(false)
    expect(looksMultiColumn('with t as (select 1) select count(*) from t')).toBe(false)
  })
})

describe('buildMonitorHref', () => {
  it('opens the SQL create form prefilled, using the page\'s existing new=sql contract', () => {
    const href = buildMonitorHref({ dataSourceId: 'ds1', name: '일 매출', sql: 'select sum(amount) from orders' })
    const url = new URL(href, 'https://x.test')
    expect(url.pathname).toBe('/app/monitors')
    expect(url.searchParams.get('new')).toBe('sql')
    expect(url.searchParams.get('source')).toBe('ds1')
    expect(url.searchParams.get('name')).toBe('일 매출')
    expect(url.searchParams.get('sql')).toBe('select sum(amount) from orders')
  })

  it('collapses whitespace and truncates a long question used as the name', () => {
    const href = buildMonitorHref({ dataSourceId: 'ds1', name: `  a${'b'.repeat(200)}\n c `, sql: 'select 1' })
    const name = new URL(href, 'https://x.test').searchParams.get('name') ?? ''
    expect(name.length).toBe(80)
    expect(name.startsWith('ab')).toBe(true)
  })

  it('omits an empty name rather than sending a blank param', () => {
    const href = buildMonitorHref({ dataSourceId: 'ds1', name: '   ', sql: 'select 1' })
    expect(new URL(href, 'https://x.test').searchParams.has('name')).toBe(false)
  })
})
