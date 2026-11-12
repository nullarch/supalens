// NOT `import 'server-only'` — shared with the Trigger.dev runtime (like utils/supabase/admin.ts
// and lib/query/dsn.ts). Server-only by nature: needs the service-role client + vault reveal.
//
// Firestore parallel of query/dsn.ts (resolveDataSource): read the (non-secret) config row via
// the service-role client, decrypt the gcp_service_account JSON from the vault, and return
// resolved credentials. TTL-cached so we reveal once per client lifetime, not per query, and
// so decrypted creds don't live forever on the warm Trigger container. NO SSRF: the endpoint is
// Google's API, not a user-supplied host.
import { getCurrentSecret, revealSecret } from '@/lib/secrets/service'
import { requireAdminClient } from '@/utils/supabase/admin'

export interface FirestoreConnection {
  projectId: string
  clientEmail: string
  privateKey: string
  databaseId: string
}

interface ResolvedFirestore {
  conn: FirestoreConnection
  orgId: string
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, ResolvedFirestore>()

export async function resolveFirestoreDataSource(dataSourceId: string): Promise<ResolvedFirestore> {
  const hit = cache.get(dataSourceId)
  if (hit && hit.expiresAt > Date.now()) return hit
  if (hit) cache.delete(dataSourceId) // expired — re-resolve (re-checks deleted_at + secret)

  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('data_sources')
    .select('id, org_id, engine, config, deleted_at')
    .eq('id', dataSourceId)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`data source not found: ${dataSourceId}`)
  const ds = data[0] as {
    org_id: string
    engine: string
    config: Record<string, unknown> | null
    deleted_at: string | null
  }
  if (ds.deleted_at) throw new Error(`data source is deleted: ${dataSourceId}`)
  if (ds.engine !== 'firestore') throw new Error(`not a firestore data source: ${dataSourceId} (engine=${ds.engine})`)

  const secretMeta = await getCurrentSecret({ kind: 'gcp_service_account', parent: { dataSourceId } })
  if (!secretMeta) throw new Error(`no gcp_service_account secret for data source: ${dataSourceId}`)
  const raw = await revealSecret(secretMeta.id, { actor: { kind: 'system' }, purpose: 'firestore_connect' })

  let sa: { project_id?: string; client_email?: string; private_key?: string }
  try {
    sa = JSON.parse(raw) as typeof sa
  } catch {
    throw new Error(`invalid service-account JSON for data source: ${dataSourceId}`)
  }

  const c = ds.config ?? {}
  const projectId = String(c.project_id ?? sa.project_id ?? '')
  const clientEmail = String(sa.client_email ?? c.client_email ?? '')
  const privateKey = String(sa.private_key ?? '')
  const databaseId = String(c.database_id ?? '(default)')
  if (!projectId || !clientEmail || !privateKey)
    throw new Error(`firestore credentials incomplete for data source: ${dataSourceId}`)

  const resolved: ResolvedFirestore = {
    conn: { projectId, clientEmail, privateKey, databaseId },
    orgId: ds.org_id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
  cache.set(dataSourceId, resolved)
  return resolved
}

/** Drop cached credentials (caller should also closeFirestore) on disconnect/rotation. */
export function invalidateFirestoreDataSource(dataSourceId: string): void {
  cache.delete(dataSourceId)
}
