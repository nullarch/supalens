/** Public surface of the visualization contract. */
export {
  SPEC_VERSION,
  VisualizationSpec,
  ChartSpec,
  WidgetDataSchema,
  FormatSchema,
  ProposeVizInput,
  // per-type schemas (handy for fixtures / narrow validation)
  KpiSpec,
  BigNumberSpec,
  BarSpec,
  StackedBarSpec,
  GroupedBarSpec,
  LineSpec,
  MultiLineSpec,
  AreaSpec,
  ScatterSpec,
  PieSpec,
  DonutSpec,
  TableSpec,
  referencedColumns,
  buildDefaultTableSpec,
  migrateSpec,
} from './spec'
export type { VisualizationSpec as VisualizationSpecT, ChartSpec as ChartSpecT, ChartType, WidgetData, Format } from './spec'
export { formatValue, computeDelta } from './format'
