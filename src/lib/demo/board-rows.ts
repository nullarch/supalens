// Pure row shaping shared by the live demo board (board.ts) and
// scripts/refresh-demo-catalog-samples.mjs. No server imports.

export type DemoRow = Record<string, unknown>

/** Postgres numerics arrive as strings from `pg`; charts need numbers. */
export function normalizeDemoRow(row: DemoRow, columns: string[]): DemoRow {
  return Object.fromEntries(
    columns.map((column) => {
      const value = row[column]
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return [column, Number(value)]
      if (value instanceof Date) return [column, value.toISOString()]
      return [column, value]
    }),
  )
}

/**
 * Previews show whole days only. Today is unfinished, and a `now() - interval` window starts partway
 * through its first day; either would read as a false drop next to complete days.
 */
export function wholeDayRows(rows: DemoRow[], sql: string, today: string): DemoRow[] {
  const startsMidDay = /now\(\)\s*-\s*interval/i.test(sql)
  return rows
    .filter((row) => !(typeof row.day === 'string' && row.day >= today))
    .filter((row, index) => !(index === 0 && startsMidDay && typeof row.day === 'string'))
}
