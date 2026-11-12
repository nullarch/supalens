import { describe, expect, it } from 'vitest'
import { coincidentReferences, exactReferenceValue, referenceDash, type ChartReference } from './references'

describe('chart reference presentation', () => {
  it('gives all four allowed references different, stable non-color keys', () => {
    expect(new Set([0, 1, 2, 3].map(referenceDash)).size).toBe(4)
    expect(referenceDash(0)).toBe('4 4')
  })
  it('marks identical values, not merely values that round to the same display', () => {
    const refs: ChartReference[] = [
      { value: 1, intent: 'warning' }, { value: 1, intent: 'warning' },
      { value: 1.000001, intent: 'warning' }, { value: 0, intent: 'neutral' },
    ]
    const snapshot = structuredClone(refs)
    expect(coincidentReferences(refs, 0)).toEqual([2])
    expect(coincidentReferences(refs, 1)).toEqual([1])
    expect(coincidentReferences(refs, 2)).toEqual([])
    expect(coincidentReferences(refs, 3)).toEqual([])
    expect(refs).toEqual(snapshot)
  })
  it('treats zero and negative zero as the same plotted level', () => {
    expect(coincidentReferences([{ value: 0, intent: 'neutral' }, { value: -0, intent: 'target' }], 0)).toEqual([2])
  })
  it.each(['en', 'ko', 'ja'])('keeps close, small and large source numbers distinct in %s', locale => {
    for (const value of [0, -1.000001, .00000000000001, 1.000001, 123456789012345.67, 1e21]) {
      const formatted = exactReferenceValue(value, locale)
      expect(Number(formatted.replaceAll(',', ''))).toBe(value)
    }
    expect(exactReferenceValue(1, locale)).not.toBe(exactReferenceValue(1.000001, locale))
    expect(exactReferenceValue(.01, locale)).toBe('0.01')
  })
})
