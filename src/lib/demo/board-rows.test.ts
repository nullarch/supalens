import { describe, expect, it } from 'vitest'

import { normalizeDemoRow, wholeDayRows } from './board-rows'

describe('demo board rows', () => {
  it('turns Postgres numeric strings into numbers and keeps text', () => {
    expect(normalizeDemoRow({ day: '2026-09-01', revenue: '1234.50', name: 'Tee 12' }, ['day', 'revenue', 'name'])).toEqual({
      day: '2026-09-01',
      revenue: 1234.5,
      name: 'Tee 12',
    })
  })

  it('drops today and a partial first day from rolling-interval series', () => {
    const rows = [{ day: '2026-09-02' }, { day: '2026-09-03' }, { day: '2026-09-16' }, { day: '2026-09-17' }]
    const today = '2026-09-17'
    expect(wholeDayRows(rows, "where order_date >= now() - interval '14 days'", today).map((r) => r.day)).toEqual(['2026-09-03', '2026-09-16'])
    expect(wholeDayRows(rows, 'where signup_date >= current_date - 29', today).map((r) => r.day)).toEqual(['2026-09-02', '2026-09-03', '2026-09-16'])
    expect(wholeDayRows([{ gmv: 10 }], "now() - interval '1 day'", today)).toEqual([{ gmv: 10 }])
  })
})
