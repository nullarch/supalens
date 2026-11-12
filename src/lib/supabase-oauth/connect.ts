import 'server-only'

import { tasks } from '@trigger.dev/sdk'

import { requireAdminClient } from '@/utils/supabase/admin'
import { putSecret } from '@/lib/secrets/service'
import { bootstrapConnectionProjects, isProjectBootstrappable, type BootstrapResult } from './bootstrap-projects'
import { SupabaseManagementClient } from '@/lib/supabase-management/client'
import { resourceHeadroom, withinHeadroom } from '@/lib/plans/usage'
import type { OAuthTokens } from './client'

export interface ConnectResult {
  connectionId: string
  /** true → projects are being imported by the background task; false → done inline (count is real). */
  dispatched: boolean
  /** live count when done inline (local-dev fallback); 0 when dispatched (not known yet). */
  dataSourceCount: number
  /**
   * true → the account has several projects and NOTHING was provisioned; the user picks which one
   * to watch first in /app/setup. Connecting must not silently mint a read-only role on every
   * database someone happens to own.
   */
  needsSelection: boolean
  /** How many projects the account exposes (0 when the listing failed). */
  projectCount: number
  /**
   * Projects the plan's connection cap left out of the auto-bootstrap. Connecting is never
   * FAILED by the cap (the account really is connected) — the extras stay pickable from
   * /app/setup once the plan allows.
   */
  skippedForPlan: number
}

/**
 * Finalize a Supabase OAuth connection — the FAST half that runs inside the OAuth callback:
 *  1. create the provider_connection,
 *  2. store the refresh token (envelope-encrypted) and mark the connection active.
 *
 * The SLOW half (list projects → per-project mint read-only role + store password) is handed off
 * to the `bootstrap-supabase-projects` Trigger task so the callback can redirect immediately —
 * each mint runs SQL against a tenant DB in its own region, which previously made "Authorize" hang
 * for tens of seconds while every project (incl. paused ones) was provisioned serially. When no
 * Trigger worker is configured (local dev), the bootstrap runs inline as a fallback.
 */
export async function connectSupabaseAccount(args: {
  orgId: string
  userId: string
  tokens: OAuthTokens
}): Promise<ConnectResult> {
  const admin = requireAdminClient()
  const actor = { kind: 'user' as const, id: args.userId }
  const scopes = (process.env.SUPA_CONNECT_SCOPES ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  // 1. provider_connection (pending until the refresh token is safely stored)
  const { data: connRows, error: connErr } = await admin
    .from('provider_connections')
    .insert({
      org_id: args.orgId,
      provider: 'supabase',
      status: 'pending',
      scopes: scopes.length ? scopes : null,
      created_by: args.userId,
    })
    .select('id')
  if (connErr) throw connErr
  const connectionId = (connRows![0] as { id: string }).id

  // 2. store refresh token — on failure, mark the connection errored so it isn't left
  //    'active' with no credential (which would look connected but be unusable).
  try {
    await putSecret({
      orgId: args.orgId,
      kind: 'oauth_refresh_token',
      plaintext: args.tokens.refreshToken,
      parent: { connectionId },
      actor,
    })
  } catch (err) {
    await admin.from('provider_connections').update({ status: 'error' }).eq('id', connectionId)
    throw err
  }
  await admin.from('provider_connections').update({ status: 'active' }).eq('id', connectionId)

  // 3. decide WHAT to provision. Listing projects is one cheap Management-API call (unlike
  //    minting, which runs SQL per project), so it is safe to do inside the callback.
  //    One bootstrappable project → auto-select it. Several → provision nothing and let the
  //    user choose in /app/setup; auto-provisioning every project mints a role on databases
  //    the user never asked us to watch.
  let projectRefs: string[] | undefined
  let projectCount = 0
  try {
    const projects = await new SupabaseManagementClient(args.tokens.accessToken).listProjects()
    projectCount = projects.length
    const bootstrappable = projects.filter(isProjectBootstrappable)
    if (bootstrappable.length > 1) {
      return { connectionId, dispatched: false, dataSourceCount: 0, needsSelection: true, projectCount, skippedForPlan: 0 }
    }
    projectRefs = bootstrappable.map((p) => p.id)
  } catch (err) {
    // Listing failed — fall back to the old behaviour (bootstrap decides) rather than stranding
    // the connection with nothing provisioned and no picker data.
    console.error('[connect-supabase] listProjects failed during connect, provisioning all:', err)
  }

  // 3b. Plan cap. Auto-bootstrap must not provision past the org's connection allowance — but a
  //     full cap is NOT a connect failure: the OAuth grant is stored and valid, so we truncate and
  //     report what was deferred. The picker (/api/setup/supabase-projects) enforces the same cap
  //     on an explicit selection, and reports it as a 402 there because that IS the user's ask.
  let skippedForPlan = 0
  const room = await resourceHeadroom(args.orgId, 'database_connections', {
    table: 'data_sources',
    label: 'dataSource',
    softDelete: true,
    filters: [{ column: 'org_id', value: args.orgId }],
    excludeDemo: true,
  })
  if (room.remaining !== null) {
    if (projectRefs) {
      const split = withinHeadroom(projectRefs, room.remaining)
      projectRefs = split.allowed
      skippedForPlan = split.skipped
    } else if (room.remaining === 0) {
      // The listing failed, so there is no ref list to truncate and "provision everything" would
      // blow straight past the cap. Provision nothing; /app/setup can still pick later.
      projectRefs = []
    }
    if (projectRefs?.length === 0) {
      return { connectionId, dispatched: false, dataSourceCount: 0, needsSelection: false, projectCount, skippedForPlan }
    }
  }

  // 4. hand off project provisioning to the background task (or run inline if no worker).
  if (process.env.TRIGGER_SECRET_KEY) {
    try {
      await tasks.trigger(
        'bootstrap-supabase-projects',
        { orgId: args.orgId, userId: args.userId, connectionId, projectRefs },
        { concurrencyKey: connectionId }
      )
      return { connectionId, dispatched: true, dataSourceCount: 0, needsSelection: false, projectCount, skippedForPlan }
    } catch (err) {
      // fall through to inline provisioning so a trigger outage doesn't leave a connection empty
      console.error('[connect-supabase] trigger dispatch failed, provisioning inline:', err)
    }
  }

  // pass the freshly-exchanged access token to avoid a needless refresh-token rotation.
  const { dataSourceCount } = await bootstrapConnectionProjects({
    orgId: args.orgId,
    userId: args.userId,
    connectionId,
    accessToken: args.tokens.accessToken,
    projectRefs,
  })
  return { connectionId, dispatched: false, dataSourceCount, needsSelection: false, projectCount, skippedForPlan }
}

/**
 * Re-run project provisioning for an EXISTING connection: picks up Supabase projects created
 * since connect, and heals sources bootstrapped with a broken/missing pooler config (the
 * bootstrap upsert refreshes each reused row's stored config; active rows are never re-minted).
 *
 * Runs INLINE on the BFF, not on the Trigger task: minting the Management-API token from the
 * stored refresh token needs `SUPA_CONNECT_*`, which is guaranteed wherever the OAuth callback
 * runs (Vercel) but not necessarily on the Trigger host — a dispatch there fails invisibly when
 * that env is missing. Resync is light for existing sources (config refresh only, no re-mint),
 * and the bootstrap is per-project idempotent, so a rare long run (many NEW projects to mint)
 * that hits the function limit simply heals incrementally on the next click.
 */
export async function resyncSupabaseProjects(args: {
  orgId: string
  userId: string
  connectionId: string
}): Promise<BootstrapResult> {
  return bootstrapConnectionProjects(args)
}
