import { describe, expect, it } from 'vitest'

import { wizardSpec } from './wizard-specs'

const t = (key: string) => key // identity translator — titles aren't under test

type Env = { sample?: { rows: Record<string, unknown>[] }; chart: Record<string, unknown> }

describe('wizardSpec (display-only clones for the wizard)', () => {
  it('PIN: daily_revenue never carries full localized dates — they drown a ~185px cell (ko/ja worst)', () => {
    const s = wizardSpec(t, 'daily_revenue') as Env
    expect(s.chart.xFormat).toEqual({ kind: 'string' })
    for (const r of s.sample!.rows) {
      expect(String(r.day)).toMatch(/^\d{1,2}\/\d{1,2}$/) // "6/23", not "2026-06-23"
    }
  })

  it('replay variant trims to 6 trailing days with day-of-month-only labels', () => {
    const s = wizardSpec(t, 'daily_revenue', { replay: true }) as Env
    expect(s.sample!.rows).toHaveLength(6)
    for (const r of s.sample!.rows) {
      expect(String(r.day)).toMatch(/^\d{1,2}$/) // "25" … "30"
    }
  })

  it('other keys pass through with a localized title and no caption/description', () => {
    const s = wizardSpec(t, 'total_revenue') as Env
    expect(s.chart.title).toBe('payoffTitles.total_revenue')
    expect(s.chart.description).toBeUndefined()
    expect(s.chart.caption).toBeUndefined()
  })

  it('unknown key → null (caller filters)', () => {
    expect(wizardSpec(t, 'nope')).toBeNull()
  })
})
