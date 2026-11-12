import 'server-only'

import pg from 'pg'

import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { normalizeDemoRow, wholeDayRows, type DemoRow } from './board-rows'

export interface DemoTable {
  name: string
  rows: number | null
  columns: string[]
}

export interface DemoBoard {
  /** true when the values were read from the demo database for this render */
  live: boolean
  refreshedAt: string | null
  customers: number | null
  orders: number | null
  tables: DemoTable[]
  samples: Record<string, { columns: string[]; rows: DemoRow[] }>
}

/** KPIs the public demo board shows (catalog keys, in display order). */
export const DEMO_BOARD_KEYS = ['total_revenue', 'refund_rate', 'daily_revenue', 'revenue_by_category', 'top_products', 'new_signups'] as const

const TABLES: DemoTable[] = [
  { name: 'customers', rows: null, columns: ['id', 'name', 'email', 'country', 'signup_date'] },
  { name: 'products', rows: null, columns: ['id', 'name', 'category', 'price'] },
  { name: 'orders', rows: null, columns: ['id', 'customer_id', 'order_date', 'status', 'total_amount'] },
  { name: 'order_items', rows: null, columns: ['id', 'order_id', 'product_id', 'quantity', 'unit_price'] },
]

function fallbackBoard(): DemoBoard {
  return {
    live: false,
    refreshedAt: null,
    customers: null,
    orders: null,
    tables: TABLES,
    samples: Object.fromEntries(
      DEMO_BOARD_KEYS.flatMap((key) => {
        const sample = DEMO_KPI_PROPOSALS.find((p) => p.key === key)?.vizSpec.sample
        return sample ? [[key, { columns: sample.columns, rows: sample.rows as DemoRow[] }]] : []
      }),
    ),
  }
}

/**
 * Read the public demo board straight from the demo database: the approved-KPI SQL from the canned
 * catalog, plus table sizes for the schema panel. One short read-only transaction as the demo's
 * SELECT-only role, rendered at most hourly (page revalidate). Any failure falls back to the
 * catalog's generated samples, which the page labels as samples.
 */
export async function getDemoBoard(): Promise<DemoBoard> {
  const url = process.env.DEMO_DATABASE_URL
  if (!url) return fallbackBoard()

  pg.types.setTypeParser(1082, (value) => value)
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000, statement_timeout: 5000 })
  try {
    await client.connect()
    await client.query('begin read only')
    const today = (await client.query<{ d: string }>('select current_date::text as d')).rows[0].d
    const counts = (
      await client.query<Record<string, string>>(
        `select (select count(*) from customers) as customers,
                (select count(*) from products) as products,
                (select count(*) from orders) as orders,
                (select count(*) from order_items) as order_items`,
      )
    ).rows[0]

    const samples: DemoBoard['samples'] = {}
    for (const key of DEMO_BOARD_KEYS) {
      const proposal = DEMO_KPI_PROPOSALS.find((p) => p.key === key)
      if (!proposal) continue
      const result = await client.query(proposal.metricSql)
      const columns = result.fields.map((field) => field.name)
      const rows = result.rows.map((row) => normalizeDemoRow(row as DemoRow, columns))
      samples[key] = { columns, rows: wholeDayRows(rows, proposal.metricSql, today) }
    }
    await client.query('rollback')

    return {
      live: true,
      refreshedAt: new Date().toISOString(),
      customers: Number(counts.customers),
      orders: Number(counts.orders),
      tables: TABLES.map((table) => ({ ...table, rows: Number(counts[table.name]) })),
      samples,
    }
  } catch (error) {
    console.error('[demo] live board read failed:', error instanceof Error ? error.message : error)
    return fallbackBoard()
  } finally {
    await client.end().catch(() => {})
  }
}
