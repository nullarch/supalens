import { randomUUID } from 'crypto'

import { probeFirestore } from '@/lib/firestore'
import { putSecret } from '@/lib/secrets/service'
import { recordOwnDbConnected } from '@/lib/content-agent/events'
import { sendDataConnectedToHub } from '@/lib/event-hub/events'
import { requireAdminClient } from '@/utils/supabase/admin'

import { RegistrationError } from './register'
import { syncSchemaCache } from './introspect-cache'
import type { FirestoreDataSourceInput } from './validate'

/** Map a raw Firestore/GCP error to a coarse, non-leaky reason. */
function classifyFsError(raw?: string): string {
  const e = (raw ?? '').toLowerCase()
  if (/permission|denied|iam|forbidden|unauthorized/.test(e)) return 'permission denied (needs roles/datastore.viewer)'
  if (/invalid|decode|pem|private[_ ]?key|jwt|credential|signature/.test(e)) return 'invalid credentials'
  if (/not found|does not exist|404|not_found/.test(e)) return 'project or database not found'
  if (/timeout|etimedout|network|enotfound|unavailable/.test(e)) return 'unreachable'
  return 'connection failed'
}

/**
 * Register a Firebase Firestore data source:
 *   1. parse + validate the service-account JSON (project_id / client_email / private_key),
 *   2. PROBE the connection (listCollections) BEFORE creating anything,
 *   3. insert the data_source (engine='firestore'; config holds NO secret — only project_id /
 *      client_email / database_id),
 *   4. store the FULL service-account JSON as an envelope-encrypted gcp_service_account secret.
 *
 * Mirrors registerDirectDataSource, minus the SSRF host-pin (Firestore has no user host — it
 * talks to Google's API) and with a listCollections probe instead of `select 1`.
 */
export async function registerFirestoreDataSource(args: {
  orgId: string
  userId: string
  input: FirestoreDataSourceInput
}): Promise<{ dataSourceId: string; latencyMs?: number; collections?: number }> {
  const { orgId, userId, input } = args

  // 1. parse the service-account JSON (the private_key must go to the vault, never to config)
  let sa: { project_id?: string; client_email?: string; private_key?: string }
  try {
    sa = JSON.parse(input.serviceAccountJson) as typeof sa
  } catch {
    throw new RegistrationError('service-account JSON is not valid JSON', 'connection_failed')
  }
  const projectId = String(sa.project_id ?? '')
  const clientEmail = String(sa.client_email ?? '')
  const privateKey = String(sa.private_key ?? '')
  if (!projectId || !clientEmail || !privateKey) {
    throw new RegistrationError(
      'service-account JSON missing project_id / client_email / private_key',
      'connection_failed'
    )
  }
  const databaseId = input.databaseId?.trim() || '(default)'

  // 2. probe BEFORE creating anything (no row yet)
  const probe = await probeFirestore({ projectId, clientEmail, privateKey, databaseId })
  if (!probe.ok) {
    console.error(`[data-sources] firestore probe failed for ${projectId}`, probe.error)
    throw new RegistrationError(`connection test failed (${classifyFsError(probe.error)})`, 'connection_failed')
  }

  // 3. insert data_source (config is NON-secret: project_id / client_email / database_id)
  const admin = requireAdminClient()
  const dataSourceId = randomUUID()
  const config = { project_id: projectId, client_email: clientEmail, database_id: databaseId }
  const { error: insErr } = await admin.from('data_sources').insert({
    id: dataSourceId,
    org_id: orgId,
    connection_id: null,
    name: input.name,
    engine: 'firestore',
    provider: 'firebase',
    config,
    status: 'active',
    last_connected_at: new Date().toISOString(),
    created_by: userId,
  })
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      throw new RegistrationError('a data source with this name already exists', 'duplicate_name')
    }
    throw insErr
  }

  // 4. store the full service-account JSON in the vault (envelope-encrypted)
  try {
    await putSecret({
      orgId,
      kind: 'gcp_service_account',
      plaintext: input.serviceAccountJson,
      parent: { dataSourceId },
      actor: { kind: 'user', id: userId },
    })
  } catch (e) {
    console.error(`[data-sources] firestore secret store failed for ${dataSourceId}`, e)
    // soft-delete the half-created row so it doesn't squat the name or read as a live source
    try {
      await admin
        .from('data_sources')
        .update({ status: 'error', deleted_at: new Date().toISOString() })
        .eq('id', dataSourceId)
    } catch {
      /* surface the real store_failed cause */
    }
    throw new RegistrationError('failed to store credentials', 'store_failed')
  }

  // 5. best-effort: sample collections into the schema cache (table/collection count + fields).
  //    Never fails registration; Firestore sampling is billed so it's bounded in syncSchemaCache.
  try {
    await syncSchemaCache(dataSourceId)
  } catch (e) {
    console.error(`[data-sources] initial firestore introspection failed for ${dataSourceId}`, e)
  }

  // 6. content-agent `own_db_connected` (first own source only; env-gated no-op, never throws)
  await recordOwnDbConnected({ orgId, dataSourceId })

  // 7. event hub `data_connected` (the acting user's first source only; never throws)
  await sendDataConnectedToHub(admin, userId, dataSourceId)

  return { dataSourceId, latencyMs: probe.latencyMs, collections: probe.collections }
}
