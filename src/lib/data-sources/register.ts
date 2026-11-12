import { randomUUID } from 'crypto'

import * as Sentry from '@sentry/nextjs'

import { requireAdminClient } from '@/utils/supabase/admin'
import { putSecret } from '@/lib/secrets/service'
import { recordOwnDbConnected } from '@/lib/content-agent/events'
import { sendDataConnectedToHub } from '@/lib/event-hub/events'
import type { ConnectionConfig } from '@/lib/query'
import { resolveSafeHost } from './ssrf'
import { testConnection } from './test-connection'
import { syncSchemaCache } from './introspect-cache'
import type { DirectDataSourceInput } from './validate'

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly code: 'unsafe_host' | 'connection_failed' | 'duplicate_name' | 'store_failed'
  ) {
    super(message)
    this.name = 'RegistrationError'
  }
}

/** Map a raw driver error to a coarse, non-leaky reason (no host/IP/port echoed). */
function classifyConnError(raw?: string): string {
  const e = (raw ?? '').toLowerCase()
  if (/timeout|etimedout/.test(e)) return 'timeout'
  if (/password|authentication|access denied|\bauth\b/.test(e)) return 'authentication failed'
  if (/enotfound|getaddrinfo|\bdns\b/.test(e)) return 'host not found'
  if (/econnrefused|refused/.test(e)) return 'connection refused'
  if (/self.signed|certificate|tls|ssl/.test(e)) return 'TLS error'
  if (/does not exist|unknown database/.test(e)) return 'database not found'
  return 'unreachable'
}

/**
 * Register a direct (non-OAuth) MySQL/Postgres data source:
 *   1. SSRF guard + PIN the host to a validated IP,
 *   2. test the connection (read-only SELECT 1) BEFORE creating anything,
 *   3. insert the data_source (connection_id null),
 *   4. store the password as an envelope-encrypted db_password secret.
 */
export async function registerDirectDataSource(args: {
  orgId: string
  userId: string
  input: DirectDataSourceInput
}): Promise<{ dataSourceId: string; latencyMs?: number }> {
  const { orgId, userId, input } = args

  // 1. SSRF + pin (throws UnsafeHostError -> 400)
  const pinned = await resolveSafeHost(input.host)
  const cfg: ConnectionConfig = {
    engine: input.engine,
    host: pinned.ip,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    ssl: input.ssl,
    servername: pinned.ip !== pinned.original ? pinned.original : undefined,
  }

  // 2. connection test (no row created yet)
  const probe = await testConnection(cfg)
  if (!probe.ok) {
    // NOT sent to Sentry: a bad host/port/credential is an expected USER error
    // (surfaced to them as a 400), not a system fault — would be pure noise.
    console.error(`[data-sources] probe failed for ${input.host}:${input.port}`, probe.error)
    throw new RegistrationError(`connection test failed (${classifyConnError(probe.error)})`, 'connection_failed')
  }

  // 3. insert data_source (config holds NO secret — only host/port/db/user/ssl)
  const admin = requireAdminClient()
  const dataSourceId = randomUUID()
  const config = {
    host: input.host, // store the original hostname; SSRF re-pins on every connect
    port: input.port,
    database: input.database,
    db_user: input.user,
    ssl: input.ssl,
  }
  const { error: insErr } = await admin.from('data_sources').insert({
    id: dataSourceId,
    org_id: orgId,
    connection_id: null,
    name: input.name,
    engine: input.engine,
    provider: input.provider,
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

  // 4. store the password in the vault (envelope-encrypted)
  try {
    await putSecret({
      orgId,
      kind: 'db_password',
      plaintext: input.password,
      parent: { dataSourceId },
      actor: { kind: 'user', id: userId },
    })
  } catch (e) {
    console.error(`[data-sources] secret store failed for ${dataSourceId}`, e)
    Sentry.captureException(e, { tags: { dataSourceId } })
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

  // 5. best-effort: introspect the schema into the cache so the sources UI shows table counts
  //    immediately and the context generator has structured input. Never fails registration.
  try {
    await syncSchemaCache(dataSourceId)
  } catch (e) {
    console.error(`[data-sources] initial introspection failed for ${dataSourceId}`, e)
  }

  // 6. content-agent `own_db_connected` (first own source only; env-gated no-op, never throws)
  await recordOwnDbConnected({ orgId, dataSourceId })

  // 7. event hub `data_connected` (the acting user's first source only; never throws)
  await sendDataConnectedToHub(admin, userId, dataSourceId)

  return { dataSourceId, latencyMs: probe.latencyMs }
}
