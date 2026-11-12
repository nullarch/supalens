// NOTE: intentionally NOT `import 'server-only'` — callable from Trigger.dev-shared
// removal paths, same convention as utils/supabase/admin.ts.
import { requireAdminClient } from '@/utils/supabase/admin'
import type { AlertErrorCode } from '@/lib/alerts/error-codes'

/**
 * Disable/detach everything that depends on a data source being removed.
 * Removal is a SOFT delete (`data_sources.deleted_at`), so the migrations'
 * ON DELETE CASCADE/SET NULL FKs never fire — without this, alerts keep
 * evaluating against a source whose secrets were just revoked (perpetual
 * silent failures) and dashboard widgets keep re-querying a dead source.
 *
 * Best-effort per table: a failure in one cleanup must not abort the removal.
 */
export async function cleanupDataSourceDependents(dataSourceId: string): Promise<void> {
  const admin = requireAdminClient()

  const steps: Array<[string, () => PromiseLike<{ error: unknown }>]> = [
    // alerts: disable (not delete) so the user can still see them and re-point/re-enable.
    // `last_error` is rendered in a localized UI, so it carries a CODE, never a sentence
    // (this used to store hardcoded Korean prose — see lib/alerts/error-codes.ts).
    ['alerts', () =>
      admin
        .from('alerts')
        .update({ enabled: false, last_error: 'source_removed' satisfies AlertErrorCode })
        .eq('data_source_id', dataSourceId)
        .is('deleted_at', null)],
    // widgets: detach so live refresh stops; spec/sample stay for snapshot rendering
    ['dashboard_widgets', () =>
      admin
        .from('dashboard_widgets')
        .update({ data_source_id: null, refresh_interval: null })
        .eq('data_source_id', dataSourceId)],
    ['saved_queries', () =>
      admin
        .from('saved_queries')
        .update({ data_source_id: null })
        .eq('data_source_id', dataSourceId)],
  ]

  for (const [table, run] of steps) {
    try {
      const { error } = await run()
      if (error) console.warn(`[ds-cleanup] ${table} cleanup failed for ${dataSourceId}:`, error)
    } catch (err) {
      console.warn(`[ds-cleanup] ${table} cleanup failed for ${dataSourceId}:`, err)
    }
  }
}
