import { describe, expect, it } from 'vitest'

import { pickHomeDashboard, resolveHome } from './home-pick'

const board = (id: string, slug: string, pinned = false, position = 0) => ({ id, slug, pinned, position })

describe('pickHomeDashboard', () => {
  it('no boards → no home', () => {
    expect(pickHomeDashboard([], 'anything')).toBeNull()
  })

  it('the chosen board wins while it is live', () => {
    const boards = [board('core', 'core-kpi', true, 0), board('growth', 'growth', false, 1)]
    expect(pickHomeDashboard(boards, 'growth')?.id).toBe('growth')
  })

  it('a chosen board that no longer resolves falls back to the AI-drafted core-KPI board', () => {
    const boards = [board('a', 'sales', true, 0), board('core', 'core-kpi', false, 3)]
    expect(pickHomeDashboard(boards, 'deleted')?.id).toBe('core')
    expect(pickHomeDashboard(boards, null)?.id).toBe('core')
  })

  it('without a core-KPI board: first pinned, then first by position', () => {
    expect(pickHomeDashboard([board('a', 'a', false, 0), board('b', 'b', true, 5)], null)?.id).toBe('b')
    expect(pickHomeDashboard([board('a', 'a', false, 2), board('b', 'b', false, 1)], null)?.id).toBe('b')
  })
})

describe('resolveHome — the reason the Overview names', () => {
  const boards = [board('a', 'sales', false, 0), board('core', 'core-kpi', false, 3), board('p', 'ops', true, 1)]

  it('a live choice is "chosen", and Automatic still resolves to the rule\'s board', () => {
    expect(resolveHome(boards, 'a')).toMatchObject({ home: { id: 'a' }, reason: 'chosen', auto: { id: 'core' }, chosenId: 'a' })
  })

  it('no (live) choice → the rule, with its reason', () => {
    expect(resolveHome(boards, null)).toMatchObject({ home: { id: 'core' }, reason: 'core', chosenId: null })
    expect(resolveHome(boards, 'deleted')).toMatchObject({ home: { id: 'core' }, reason: 'core', chosenId: null })
    expect(resolveHome([board('a', 'a', false, 0), board('b', 'b', true, 5)], null)).toMatchObject({ home: { id: 'b' }, reason: 'pinned' })
    expect(resolveHome([board('a', 'a', false, 2), board('b', 'b', false, 1)], null)).toMatchObject({ home: { id: 'b' }, reason: 'first' })
  })

  it('no boards → nothing to name', () => {
    expect(resolveHome([], 'a')).toEqual({ home: null, reason: null, auto: null, chosenId: null })
  })
})
