// Test helper: an in-memory stand-in for the service-role client, covering the chains the Paddle
// webhook path uses. Filters are applied for real, so claim and re-claim behave as in the database.
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

export function fakeAdmin(seed: Record<string, Row[]> = {}, failures: { upsert?: { code: string; message: string } } = {}) {
  const tables: Record<string, Row[]> = { ...seed }
  const rows = (table: string) => (tables[table] ??= [])

  function query(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let action: 'select' | 'update' = 'select'
    let patch: Row = {}
    const sorts: Array<(a: Row, b: Row) => number> = []
    const run = () => {
      const matched = rows(table).filter((row) => filters.every((f) => f(row)))
      sorts.forEach((sort) => matched.sort(sort)) // Reverse call order, so the first order() is the primary key.
      if (action === 'update') matched.forEach((row) => Object.assign(row, patch))
      return { data: matched, error: null }
    }
    const chain = {
      select: () => chain,
      // A dotted column filters on an embedded row; no embedded row means no match, like !inner.
      eq: (column: string, value: unknown) => {
        const [first, nested] = column.split('.')
        return filters.push((r) => (nested ? (r[first] as Row | null)?.[nested] : r[first]) === value), chain
      },
      is: (column: string, value: unknown) => (filters.push((r) => (r[column] ?? null) === value), chain),
      in: (column: string, values: unknown[]) => (filters.push((r) => values.includes(r[column])), chain),
      not: (column: string, _op: 'is', value: unknown) => (filters.push((r) => (r[column] ?? null) !== value), chain),
      // Only the `a.eq.x,b.eq.y` form.
      or: (expression: string) => {
        const terms = expression.split(',').map((term) => term.split('.eq.'))
        return filters.push((r) => terms.some(([column, value]) => r[column] === value)), chain
      },
      lt: (column: string, value: string) => (filters.push((r) => String(r[column]) < value), chain),
      order: (column: string, options?: { ascending?: boolean }) => {
        const dir = options?.ascending === false ? -1 : 1
        sorts.unshift((a, b) => dir * String(a[column]).localeCompare(String(b[column])))
        return chain
      },
      limit: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      setUpdate(values: Row) {
        action = 'update'
        patch = values
        return chain
      },
    }
    return chain
  }

  const admin = {
    from(table: string) {
      return {
        select: () => query(table),
        update: (values: Row) => query(table).setUpdate(values),
        async insert(row: Row) {
          if (table === 'paddle_webhook_events' && rows(table).some((r) => r.event_id === row.event_id)) {
            return { error: { code: '23505', message: 'duplicate' } }
          }
          rows(table).push({ received_at: new Date().toISOString(), ...row })
          return { error: null }
        },
        async upsert(row: Row) {
          if (failures.upsert) return { error: failures.upsert }
          const existing = rows(table).find((r) => r.paddle_transaction_id === row.paddle_transaction_id)
          if (existing) Object.assign(existing, row)
          else rows(table).push({ ...row })
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, tables }
}
