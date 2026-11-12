import type { SpecOf } from '../types'

export type ChartReference = NonNullable<SpecOf<'line'>['references']>[number]

/** Stable, color-independent mapping between each configured line and its legend. */
const DASHES = ['4 4', '9 3', '2 3', '9 3 2 3'] as const
export const referenceDash = (index: number) => DASHES[index % DASHES.length]

/** Preserve source order, including distinct definitions at the same numeric level. */
export function coincidentReferences(references: readonly ChartReference[], index: number): number[] {
  return references.flatMap((reference, other) => other !== index && reference.value === references[index]?.value ? [other + 1] : [])
}

/** Raw, unscaled JS numeric value: never round nearby thresholds into the same value. */
export function exactReferenceValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }).format(value)
}
