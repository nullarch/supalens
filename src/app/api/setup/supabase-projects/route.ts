import { tasks } from '@trigger.dev/sdk'
import { getLocale } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { listConnectionProjects } from '@/lib/data-sources/supabase-projects'
import { bootstrapConnectionProjects } from '@/lib/supabase-oauth/bootstrap-projects'
import { trackServer } from '@/lib/analytics/server'
import { isReconnectRequired } from '@/lib/supabase-oauth/tokens'
import { resourceHeadroom, resourceLimitMessage } from '@/lib/plans/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Hard ceiling on one selection, so a click can't queue a mint against dozens of databases. */
const MAX_SELECTION = 10

/**
 * GET — the setup project picker's data: every project on the org's Supabase connection, joined
 * to what supalens has provisioned. Also the POLL endpoint while provisioning runs, so it must
 * stay cheap: one cached-token Management call plus two indexed reads.
 *
 * Member+ may read (it is the same non-secret project list the sources page implies).
 */
export async function GET() {
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const orgId = await ensurePrimaryOrg(supabase, user)
  if (!(await userHasOrgRole(supabase, orgId, user.id, ['owner', 'admin', 'member']))) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const result = await listConnectionProjects(orgId)
    if (!result) return Response.json({ connected: false, projects: [] })
    // A dead grant is a normal end of the OAuth lifecycle, not a fault: answer 200 with the
    // state so the picker can render its reconnect CTA instead of a generic failure.
    if (result.needsReconnect) {
      return Response.json({ connected: true, projects: [], needsReconnect: true })
    }
    return Response.json({ connected: true, projects: result.projects, needsReconnect: false })
  } catch (e) {
    // A Management-API fault must degrade the picker, not 500 the setup page that polls it.
    // Only a stable CODE crosses the wire — `String(e)` would hand the browser raw exception
    // text (which for an OAuth fault names an internal connection id).
    console.error('[setup] listConnectionProjects failed:', e)
    return Response.json({ error: 'list_failed' }, { status: 502 })
  }
}

/**
 * POST `{ refs: string[] }` — provision exactly the chosen projects (mint the read-only role,
 * store its password, introspect). Also the RETRY path: re-running a ref whose row is in `error`
 * heals it, because the bootstrap's upsert reuses the row and re-mints on it.
 *
 * owner/admin only: this mints a credential on the customer's database.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const orgId = await ensurePrimaryOrg(supabase, user)
  if (!(await userHasOrgRole(supabase, orgId, user.id))) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { refs?: unknown }
  const refs = Array.isArray(body.refs)
    ? [...new Set(body.refs.filter((r): r is string => typeof r === 'string' && r.length > 0))]
    : []
  if (refs.length === 0) return Response.json({ error: 'no_refs' }, { status: 400 })
  if (refs.length > MAX_SELECTION) return Response.json({ error: 'too_many_refs' }, { status: 400 })

  // Plan cap. This route provisions a BATCH, so the one-more-row enforceResourceLimit used by
  // /api/data-sources cannot express it — headroom does. Same 402 `limit_reached` shape and the
  // same localized message, plus `remaining` so the picker can say how many still fit.
  const room = await resourceHeadroom(orgId, 'database_connections', {
    table: 'data_sources',
    label: 'dataSource',
    softDelete: true,
    filters: [{ column: 'org_id', value: orgId }],
    excludeDemo: true,
  })
  if (room.limit !== null && room.remaining !== null && refs.length > room.remaining) {
    return Response.json(
      {
        error: 'limit_reached',
        message: await resourceLimitMessage('dataSource', room.limit, await getLocale()),
        remaining: room.remaining,
      },
      { status: 402 },
    )
  }

  // The connection is resolved SERVER-side from the caller's org — a ref list can never point
  // provisioning at another tenant's connection.
  let connectionId: string
  try {
    const result = await listConnectionProjects(orgId)
    if (!result) return Response.json({ error: 'not_connected' }, { status: 409 })
    if (result.needsReconnect) return Response.json({ error: 'reconnect_required' }, { status: 409 })
    connectionId = result.connectionId
    const known = new Set(result.projects.map((p) => p.ref))
    if (refs.some((r) => !known.has(r))) return Response.json({ error: 'unknown_ref' }, { status: 400 })
  } catch (e) {
    console.error('[setup] project resolution failed:', e)
    return Response.json({ error: 'list_failed' }, { status: 502 })
  }

  // Minting runs SQL in the project's own region, so it goes to the Trigger host when one is
  // configured; the picker polls GET for the result. Local dev falls back to inline.
  // Funnel: the choice itself, before provisioning is attempted. `source_ready` below only
  // fires on the inline path — when the work is dispatched to Trigger it completes outside any
  // Next request, so there is no server context to emit from (the picker's poll observes it).
  trackServer('supabase_project_selected', user.id, { org_id: orgId, projects: refs.length })

  if (process.env.TRIGGER_SECRET_KEY) {
    try {
      await tasks.trigger(
        'bootstrap-supabase-projects',
        { orgId, userId: user.id, connectionId, projectRefs: refs },
        { concurrencyKey: connectionId },
      )
      return Response.json({ ok: true, dispatched: true, refs })
    } catch (e) {
      console.error('[setup] trigger dispatch failed, provisioning inline:', e)
    }
  }

  try {
    const result = await bootstrapConnectionProjects({ orgId, userId: user.id, connectionId, projectRefs: refs })
    for (const o of result.outcomes) {
      if (o.ok && o.dataSourceId) {
        trackServer('source_ready', user.id, { org_id: orgId, source_id: o.dataSourceId })
      } else if (!o.ok) {
        trackServer('source_provision_failed', user.id, {
          org_id: orgId,
          failure_code: o.errorCode ?? 'unknown',
        })
      }
    }
    return Response.json({ ok: true, dispatched: false, refs, outcomes: result.outcomes })
  } catch (e) {
    console.error('[setup] inline provisioning failed:', e)
    // Stable codes only — `String(e)` would hand the browser raw exception text, which for an
    // OAuth fault names an internal connection id (and is untranslatable in the UI).
    if (isReconnectRequired(e)) {
      return Response.json({ error: 'reconnect_required' }, { status: 409 })
    }
    return Response.json({ error: 'provisioning_failed' }, { status: 502 })
  }
}
