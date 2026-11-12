import { cleanupDataSourceDependents } from '@/lib/data-sources/cleanup'
import { closeFirestore, invalidateFirestoreDataSource } from '@/lib/firestore'
import { closePool, invalidateDataSource } from '@/lib/query'
import { revokeSecret, type Actor } from '@/lib/secrets/service'
import { requireAdminClient } from '@/utils/supabase/admin'

/**
 * Remove a direct data source: revoke its current secret(s) — db_password for a SQL source or
 * gcp_service_account for a Firestore source — drop the cached decrypted creds + warm
 * pool/client immediately, and soft-delete the row. (OAuth/Supabase sources go through
 * disconnectSupabase instead, which also revokes upstream.)
 */
export async function removeDirectDataSource(dataSourceId: string, actor: Actor): Promise<void> {
  const admin = requireAdminClient()

  const { data: secrets } = await admin
    .from('secrets')
    .select('id')
    .eq('data_source_id', dataSourceId)
    .eq('is_current', true)
  for (const s of secrets ?? []) {
    await revokeSecret((s as { id: string }).id, { reason: 'data_source_removed', actor })
  }

  // drop cached decrypted creds + warm connections. Each pair is a no-op for the other engine
  // family (a SQL source has no Firestore client cached, and vice versa).
  invalidateDataSource(dataSourceId)
  await closePool(dataSourceId)
  invalidateFirestoreDataSource(dataSourceId)
  closeFirestore(dataSourceId)

  await admin
    .from('data_sources')
    .update({ status: 'disabled', deleted_at: new Date().toISOString() })
    .eq('id', dataSourceId)
    .is('deleted_at', null)

  // soft delete means FK cascades never fire — disable alerts / detach widgets explicitly
  await cleanupDataSourceDependents(dataSourceId)
}
