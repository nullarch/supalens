import type { ChartSpec, WidgetData } from '@/lib/viz/spec'

/** Props every concrete widget component receives. */
export interface WidgetComponentProps<T extends ChartSpec = ChartSpec> {
  spec: T
  data: WidgetData
  /** when true the chart fills its container's height (a dashboard grid cell with an
   *  explicit height) instead of its fixed px reserve — enables live resize reflow. */
  fill?: boolean
}

/** Narrow ChartSpec to the member(s) with the given `type`. */
export type SpecOf<K extends ChartSpec['type']> = Extract<ChartSpec, { type: K }>
