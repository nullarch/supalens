/**
 * Which connected service a dashboard widget reads from — the line a board card shows above its
 * title. A board (the home board above all) collects widgets from every service in the
 * workspace, so a card without it is a number with no owner.
 *
 * Pure (no io): shared by the board read (lib/dashboards/fetch.ts), the workspace snapshot and
 * the dev fixtures. NOT `server-only` — the grid renders the type on the client.
 */

/** The brand mark a data source is drawn with (components/brand/DatabaseLogo keys). */
export type SourceMark = 'supabase' | 'postgresql' | 'mysql' | 'firestore'

/** The service a widget belongs to, as a card names it. */
export interface WidgetSource {
  id: string
  name: string
  engine: SourceMark
}

/** A data_sources row → its mark. Supabase is a provider on the postgres engine, so the
 *  provider wins; an unrecognized engine draws as PostgreSQL (the SQL default). */
export function sourceMarkOf(row: { engine: string; provider: string | null }): SourceMark {
  if (row.provider === 'supabase') return 'supabase'
  if (row.engine === 'mysql') return 'mysql'
  if (row.engine === 'firestore') return 'firestore'
  return 'postgresql'
}

/**
 * A widget's source for display.
 *   null        the widget has no data source (a saved snapshot, or its source was removed and
 *               the widget detached) — the card says so
 *   undefined   the widget points at a source this read could not name (lookup failed / row not
 *               visible) — the card shows no line rather than a wrong one
 */
export function resolveWidgetSource(
  dataSourceId: string | null,
  sources: ReadonlyMap<string, WidgetSource> | null,
): WidgetSource | null | undefined {
  if (!dataSourceId) return null
  return sources?.get(dataSourceId)
}
