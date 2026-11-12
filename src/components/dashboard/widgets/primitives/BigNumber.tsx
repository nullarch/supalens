import { formatValue } from '@/lib/viz/format'
import type { SpecOf, WidgetComponentProps } from '../types'
import s from './primitives.module.css'

type BigNumberSpecT = SpecOf<'bignumber'>

export function BigNumber({ spec, data }: WidgetComponentProps<BigNumberSpecT>) {
  const row = data.rows[0] ?? {}
  return (
    <div className={s.big}>
      <span className={s.bigValue}>{formatValue(row[spec.value], spec.format)}</span>
      {spec.caption && <span className={s.bigCaption}>{spec.caption}</span>}
    </div>
  )
}
