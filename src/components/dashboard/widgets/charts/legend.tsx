import type { CSSProperties, ReactNode } from 'react'

/**
 * Legend chrome shared by the cartesian charts (app design system): a 7px dot and a 14px/500
 * label, placed ABOVE the plot. Recharts paints legend text in the series color by default;
 * series colors are for marks only, so every label is re-inked in `--ink-2` here.
 * `itemSorter={null}` stays at each <Legend> call site (Recharts 3 otherwise re-sorts items
 * away from the rendered series order).
 */
export const LEGEND_WRAPPER: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '20px',
  fontFamily: 'var(--font-sans)',
  paddingBottom: 12,
}

export const LEGEND_ICON_SIZE = 7

export function legendLabel(value: unknown): ReactNode {
  return <span style={{ color: 'var(--ink-2)', marginLeft: 2, marginRight: 8 }}>{String(value)}</span>
}
