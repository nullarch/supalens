// NOTE: intentionally NOT `import 'server-only'` — this is the SLOW half of a Supabase
// connect (list projects → per-project mint read-only role + store password), split out of
// connect.ts so it can run on the Trigger.dev host (plain Node bundle) instead of blocking the
// OAuth callback. Same convention as utils/supabase/admin.ts. Uses @sentry/node (not
// @sentry/nextjs) so it reports from whichever runtime called it.
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { putSecret } from '@/lib/secrets/service'
import { recordOwnDbConnected } from '@/lib/content-agent/events'
import { sendDataConnectedToHub } from '@/lib/event-hub/events'
import { getValidAccessToken } from '@/lib/supabase-oauth/tokens'
import { SupabaseManagementClient, type SupabaseProject } from '@/lib/supabase-management/client'
import { fetchPoolerConfig, mintReadonlyRole, READONLY_ROLE } from '@/lib/supabase-management/bootstrap'

/**
 * Supabase project status (Management API `/v1/projects[].status`) we will bootstrap.
 * Only `ACTIVE_HEALTHY` projects have a running Postgres we can mint the read-only role on;
 * paused (`INACTIVE`) / coming-up / failed / restoring projects would each stall the loop on a
 * slow-or-failing `mintReadonlyRole` (which runs SQL against the tenant DB), so we skip them.
 * A missing status (older API shape) is treated as bootstrappable rather than silently dropped.
 */
export function isProjectBootstrappable(project: SupabaseProject): boolean {
  return !project.status || project.status === 'ACTIVE_HEALTHY'
}

/** Per-project outcome, so a caller (the setup picker) can report exactly what failed. */
export interface BootstrapProjectOutcome {
  ref: string
  ok: boolean
  dataSourceId: string | null
  errorCode: string | null
}

export interface BootstrapResult {
  dataSourceCount: number
  skippedCount: number
  outcomes: BootstrapProjectOutcome[]
}

/**
 * Finish a Supabase connection: discover the account org, list projects, and per ACTIVE project
 * create a data_source + mint a read-only role + store its password. This is the expensive part
 * of connect (each mint runs SQL on the tenant DB in its own region), so it runs OUTSIDE the
 * OAuth callback — either on the Trigger.dev host (normal) or inline as a local-dev fallback.
 *
 * Auth: the Trigger path omits `accessToken` and mints a fresh one from the stored refresh token
 * (secrets never travel in a trigger payload); the inline path passes the freshly-exchanged token
 * to avoid a needless refresh-token rotation. Per-project failures are isolated (the data_source is
 * marked 'error' and we continue), and already-created sources are skipped, so a retry/reconnect is
 * safe. See docs/supabase.md §6.
 */
export async function bootstrapConnectionProjects(args: {
  orgId: string
  userId: string
  connectionId: string
  /** Fresh Management-API token (inline path). Omit to mint from the stored refresh token. */
  accessToken?: string
  /**
   * Restrict provisioning to these project refs (the setup picker's selection, or a single-project
   * auto-select). Omit to provision every bootstrappable project — the resync/manage-all path.
   */
  projectRefs?: string[]
}): Promise<BootstrapResult> {
  const admin = requireAdminClient()
  const actor = { kind: 'user' as const, id: args.userId }

  const accessToken =
    args.accessToken ?? (await getValidAccessToken(args.connectionId, actor)).accessToken
  const mgmt = new SupabaseManagementClient(accessToken)

  // discover account org (best-effort — a display name, not load-bearing)
  try {
    const orgs = await mgmt.listOrganizations()
    if (orgs.length > 0) {
      await admin
        .from('provider_connections')
        .update({ external_account_id: orgs[0].id, display_name: orgs[0].name })
        .eq('id', args.connectionId)
    }
  } catch (err) {
    console.warn('[connect-supabase] listOrganizations failed:', err)
    Sentry.captureException(err, { level: 'warning', tags: { connectionId: args.connectionId } })
  }

  let projects: SupabaseProject[]
  try {
    projects = await mgmt.listProjects()
  } catch (err) {
    console.error('[connect-supabase] listProjects failed:', err)
    Sentry.captureException(err, { tags: { connectionId: args.connectionId } })
    await admin.from('provider_connections').update({ status: 'error' }).eq('id', args.connectionId)
    return { dataSourceCount: 0, skippedCount: 0, outcomes: [] }
  }

  // Selection filter FIRST: a picker choice must not be widened by the ACTIVE_HEALTHY pass, and
  // an unknown ref is simply absent (a project deleted between listing and selecting).
  const selected = args.projectRefs?.length ? projects.filter((p) => args.projectRefs!.includes(p.id)) : projects
  const active = selected.filter(isProjectBootstrappable)
  const skippedCount = selected.length - active.length
  if (skippedCount > 0) {
    console.info(
      `[connect-supabase] skipping ${skippedCount}/${selected.length} non-ACTIVE_HEALTHY project(s) for ${args.connectionId}`
    )
  }

  let created = 0
  const outcomes: BootstrapProjectOutcome[] = []
  for (const project of active) {
    try {
      const pooler = await fetchPoolerConfig(mgmt, project.id)
      const config = {
        project_ref: project.id,
        region: project.region,
        pooler_host: pooler?.db_host ?? null,
        pooler_port: pooler?.db_port ?? null,
        database: pooler?.db_name ?? 'postgres',
        pool_mode: pooler?.pool_mode ?? 'transaction',
        db_user: `${READONLY_ROLE}.${project.id}`,
        ssl: 'require',
      }

      const { dataSourceId, alreadyActive, connectable } = await upsertDataSource(admin, {
        orgId: args.orgId,
        connectionId: args.connectionId,
        name: project.name,
        ref: project.id,
        config,
        createdBy: args.userId,
      })

      // Fail closed: without a pooler host the source can never connect — the query engine
      // (query/dsn.ts) would throw "missing host/db_user" on every query. Surface it as an
      // error row (visible in the UI, healed by a later resync) instead of minting a role
      // for a dead config or leaving a broken row 'active'.
      if (!connectable) {
        console.error(`[connect-supabase] no pooler host for ${project.id} — marking data source error`)
        Sentry.captureMessage('pooler config unavailable at bootstrap', {
          level: 'warning',
          tags: { projectId: project.id, connectionId: args.connectionId },
        })
        await admin
          .from('data_sources')
          .update({ status: 'error', last_error_code: 'pooler_config_unavailable' })
          .eq('id', dataSourceId)
        outcomes.push({ ref: project.id, ok: false, dataSourceId, errorCode: 'pooler_config_unavailable' })
        continue
      }

      // Already fully provisioned on a prior run — don't re-mint (would rotate the stored
      // password out from under working stored creds). A pending/error row falls through and
      // gets (re)minted on the SAME row, so a re-run heals a partial bootstrap.
      if (alreadyActive) {
        created++
        outcomes.push({ ref: project.id, ok: true, dataSourceId, errorCode: null })
        continue
      }

      try {
        const password = await mintReadonlyRole(mgmt, project.id)
        await putSecret({
          orgId: args.orgId,
          kind: 'db_password',
          plaintext: password,
          parent: { dataSourceId },
          actor,
        })
        await admin
          .from('data_sources')
          .update({ status: 'active', last_error_code: null, last_connected_at: new Date().toISOString() })
          .eq('id', dataSourceId)
        created++
        outcomes.push({ ref: project.id, ok: true, dataSourceId, errorCode: null })

        // content-agent `own_db_connected` — only a source that just went active (not the
        // alreadyActive skip above); first own source per org; env-gated no-op, never throws.
        await recordOwnDbConnected({ orgId: args.orgId, dataSourceId })
        await sendDataConnectedToHub(admin, args.userId, dataSourceId)

        // Introspect once, right after the role exists — the direct-DB register path already does
        // this and the OAuth path did not, so an OAuth source had an empty introspection cache
        // until someone hit "스키마 동기화". It also makes the setup picker's "schema scanned"
        // stage a real observation. Best-effort: never fails provisioning.
        try {
          // Imported lazily: a static import would pull the whole introspection/query stack into
          // this module's graph, which the OAuth callback and the Trigger task both load.
          const { syncSchemaCache } = await import('@/lib/data-sources/introspect-cache')
          await syncSchemaCache(dataSourceId)
        } catch (syncErr) {
          console.warn(`[connect-supabase] schema sync failed for ${project.id}:`, syncErr)
        }
      } catch (mintErr) {
        console.error(`[connect-supabase] mint role failed for ${project.id}:`, mintErr)
        Sentry.captureException(mintErr, { tags: { projectId: project.id } })
        await admin
          .from('data_sources')
          .update({ status: 'error', last_error_code: 'mint_readonly_role_failed' })
          .eq('id', dataSourceId)
        outcomes.push({ ref: project.id, ok: false, dataSourceId, errorCode: 'mint_readonly_role_failed' })
      }
    } catch (err) {
      console.error(`[connect-supabase] project ${project.id} failed:`, err)
      Sentry.captureException(err, { tags: { projectId: project.id } })
      outcomes.push({ ref: project.id, ok: false, dataSourceId: null, errorCode: 'provisioning_failed' })
    }
  }

  return { dataSourceCount: created, skippedCount, outcomes }
}

/**
 * Insert a data_source for a project, or reuse the existing live one for this
 * (connection, project_ref) — so a retried/re-run bootstrap never creates duplicates.
 * `alreadyActive: true` means it's fully provisioned; the caller then skips (re)minting.
 * A reused pending/error row is (re)minted on, so a re-run heals a partial bootstrap.
 * (Disconnect soft-deletes rows, so a reconnect gets a fresh row rather than reusing a disabled one.)
 *
 * A reused row also gets its (non-secret) connection config REFRESHED when the fresh fetch
 * produced a pooler host — this is the heal path for rows bootstrapped while `getPoolerConfigs`
 * misparsed the API (stored `pooler_host: null` yet went 'active'), and it picks up pooler host
 * changes. A failed fetch never clobbers a working stored config. `connectable: false` means
 * neither the fresh config nor the stored one has a host — the caller must fail the row closed.
 */
async function upsertDataSource(
  admin: ReturnType<typeof requireAdminClient>,
  args: {
    orgId: string
    connectionId: string
    name: string
    ref: string
    config: Record<string, unknown>
    createdBy: string
  }
): Promise<{ dataSourceId: string; alreadyActive: boolean; connectable: boolean }> {
  const hasFreshHost = Boolean(args.config.pooler_host)

  const { data: prior } = await admin
    .from('data_sources')
    .select('id, status, config')
    .eq('connection_id', args.connectionId)
    .eq('config->>project_ref', args.ref)
    .is('deleted_at', null)
    .limit(1)
  if (prior && prior.length > 0) {
    const row = prior[0] as { id: string; status: string; config: Record<string, unknown> | null }
    if (hasFreshHost) {
      await admin.from('data_sources').update({ config: args.config }).eq('id', row.id)
    }
    const storedHost = Boolean(row.config?.pooler_host ?? row.config?.host)
    return {
      dataSourceId: row.id,
      alreadyActive: row.status === 'active',
      connectable: hasFreshHost || storedHost,
    }
  }

  const base = {
    org_id: args.orgId,
    connection_id: args.connectionId,
    engine: 'postgres',
    provider: 'supabase',
    config: args.config,
    status: 'pending',
    created_by: args.createdBy,
  }

  // try project name; on unique-name collision, disambiguate with the ref
  const { data, error } = await admin
    .from('data_sources')
    .insert({ ...base, name: args.name })
    .select('id')
  if (!error) return { dataSourceId: (data![0] as { id: string }).id, alreadyActive: false, connectable: hasFreshHost }

  if ((error as { code?: string }).code === '23505') {
    const { data: data2, error: error2 } = await admin
      .from('data_sources')
      .insert({ ...base, name: `${args.name} (${args.ref.slice(0, 6)})` })
      .select('id')
    if (error2) throw error2
    return { dataSourceId: (data2![0] as { id: string }).id, alreadyActive: false, connectable: hasFreshHost }
  }
  throw error
}
