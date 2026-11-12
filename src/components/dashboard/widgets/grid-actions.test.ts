import { describe, expect, it } from 'vitest'
import { fitGridSize, gridResult, minimumGridRows, moveGridItem, resizeGridItem } from './grid-actions'

describe('report grid acknowledgements', () => {
  it.each([undefined, null, true, 'ok', {}, { ok: 'true' }, { ok: 1 }])('keeps malformed %j unconfirmed', value => {
    expect(gridResult(value)).toBe('unknown')
  })
  it('requires explicit boolean results', () => {
    expect(gridResult({ ok: true })).toBe('confirmed')
    expect(gridResult({ ok: false, message: 'private backend text' })).toBe('rejected')
  })
})
describe('keyboard grid layout', () => {
  it('reserves chart room independently of compact numeric tiles', () => {
    expect(minimumGridRows('line')).toBe(5)
    expect(minimumGridRows('bar', true)).toBe(5)
    expect(minimumGridRows('kpi')).toBe(3)
    expect(minimumGridRows('bignumber', true)).toBe(4)
    const stored = { w: 4, h: 3 }
    expect(fitGridSize(stored, 5)).toEqual({ w: 4, h: 5 })
    expect(stored).toEqual({ w: 4, h: 3 })
    expect(resizeGridItem({ w: 4, h: 5 }, 'ArrowUp', 5)).toEqual({ w: 4, h: 5 })
    expect(resizeGridItem({ w: 4, h: 5 }, 'ArrowDown', 5)).toEqual({ w: 4, h: 6 })
  })
  it('moves only the requested item and preserves the input', () => {
    const order = ['a', 'b', 'c']
    expect(moveGridItem(order, 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(moveGridItem(order, 'c', -2)).toEqual(['c', 'a', 'b'])
    expect(order).toEqual(['a', 'b', 'c'])
  })
  it('clamps order boundaries and ignores missing items', () => {
    const order = ['a', 'b']
    expect(moveGridItem(order, 'a', -1)).toBe(order)
    expect(moveGridItem(order, 'b', 1)).toBe(order)
    expect(moveGridItem(order, 'missing', 1)).toBe(order)
  })
  it.each([
    ['ArrowRight', { w: 7, h: 4 }], ['ArrowLeft', { w: 5, h: 4 }],
    ['ArrowDown', { w: 6, h: 5 }], ['ArrowUp', { w: 6, h: 3 }],
  ])('resizes with %s', (key, expected) => expect(resizeGridItem({ w: 6, h: 4 }, key)).toEqual(expected))
  it('preserves minimum and maximum dimensions', () => {
    expect(resizeGridItem({ w: 3, h: 3 }, 'ArrowLeft')).toEqual({ w: 3, h: 3 })
    expect(resizeGridItem({ w: 3, h: 3 }, 'ArrowUp')).toEqual({ w: 3, h: 3 })
    expect(resizeGridItem({ w: 12, h: 12 }, 'ArrowRight')).toEqual({ w: 12, h: 12 })
    expect(resizeGridItem({ w: 12, h: 12 }, 'ArrowDown')).toEqual({ w: 12, h: 12 })
  })
})
