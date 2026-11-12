// NOT `import 'server-only'` — this is the body of the Trigger.dev
// lifecycle-emails cron (plain Node bundle), same convention as
// lib/digest/generate.ts / lib/maintenance/prune.ts.
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { resolveUserLocale } from '@/lib/i18n/resolve-locale'
import { sendLifecycleEmail } from '@/lib/email/lifecycle'
import { getActivationInputs } from '@/lib/activation/state'
import { pickNudge, type LifecycleContext } from './rules'
import { claimSend, releaseClaim, sentCountLastNDays } from './send-log'

type Admin = ReturnType<typeof requireAdminClient>

/** Max lifecycle nudges one user may receive in a rolling 7 days (anti-fatigue). */
const MAX_LIFECYCLE_PER_WEEK = 2
const DAY = 86_400_000

export interface SweepReport {
  scanned: number
  sent: Record<string, number>
  errors: string[]
}

interface OrgRow {
  id: string
  name: string
  created_at: string
}
interface OwnerRow {
  org_id: string
  user_id: string
  email_lifecycle_opt_out: boolean | null
  profiles: { email: string | null; locale: string | null } | null
}
interface SourceRow {
  id: string
  org_id: string
  name: string
  is_demo: boolean | null
  created_at: string
  status: string | null
  deleted_at: string | null
}

/**
 * Daily activation sweep. Enumerates workspaces on supalens's OWN Supabase (no
 * tenant DB, no LLM), builds each owner's product-state context, and sends at
 * most one instructional nudge per owner per run — opt-out honored,
 * frequency-capped, and claim-guarded so a retry can never double-send.
 * Never throws (best-effort, per-org try/catch).
 */
/** Org-scan page size. Also bounds each `.in('org_id', …)` batch: PostgREST caps un-ranged
 *  selects at ~1000 rows (so an unpaginated scan would silently miss orgs past the cap), and a
 *  huge `.in()` list would be an oversize GET query string. 500 UUIDs ≈ 18KB, well within limits. */
const ORG_PAGE = 500

export async function runLifecycleSweep(now = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { scanned: 0, sent: {}, errors: [] }
  const admin = requireAdminClient()

  // Page through ALL orgs (ordered by the unique PK for stable pagination), fetching owners +
  // sources per batch so both the scan and the `.in()` lists stay bounded.
  for (let from = 0; ; from += ORG_PAGE) {
    const { data: orgData, error: orgErr } = await admin
      .from('organizations')
      .select('id, name, created_at')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + ORG_PAGE - 1)
    if (orgErr) {
      report.errors.push(`orgs[${from}]: ${orgErr.message}`)
      break
    }
    const orgs = (orgData ?? []) as OrgRow[]
    if (orgs.length === 0) break
    const orgIds = orgs.map((o) => o.id)

    // Owners (role='owner') + their email/locale/opt-out for this batch. Capture the error — a
    // failed members query must SURFACE in the report, not silently yield an empty owners map
    // (which would make the whole batch a no-op that looks like success).
    const { data: ownerData, error: ownerErr } = await admin
      .from('organization_members')
      .select('org_id, user_id, email_lifecycle_opt_out, profiles(email, locale)')
      .in('org_id', orgIds)
      .eq('role', 'owner')
    if (ownerErr) report.errors.push(`owners[${from}]: ${ownerErr.message}`)
    const ownersByOrg = new Map<string, OwnerRow[]>()
    for (const r of (ownerData ?? []) as unknown as OwnerRow[]) {
      const list = ownersByOrg.get(r.org_id) ?? []
      list.push(r)
      ownersByOrg.set(r.org_id, list)
    }

    // Sources (incl. deleted — a real source that was later removed still means the user has
    // "connected own data" for run-attribution purposes).
    const { data: srcData, error: srcErr } = await admin
      .from('data_sources')
      .select('id, org_id, name, is_demo, created_at, status, deleted_at')
      .in('org_id', orgIds)
    if (srcErr) report.errors.push(`sources[${from}]: ${srcErr.message}`)
    const sourcesByOrg = new Map<string, SourceRow[]>()
    for (const s of (srcData ?? []) as SourceRow[]) {
      const list = sourcesByOrg.get(s.org_id) ?? []
      list.push(s)
      sourcesByOrg.set(s.org_id, list)
    }

    for (const org of orgs) {
      const owners = ownersByOrg.get(org.id) ?? []
      for (const owner of owners) {
        // Per (org, owner) isolation. `getActivationInputs` THROWS on a real DB fault (only a
        // missing schema degrades to 0), and the ladder's whole decision surface is those inputs
        // — so a failed read must SKIP this owner entirely rather than fall through to pickNudge
        // with a half-built context and mail them the wrong nudge. Nothing below the throw runs
        // (no pickNudge, no claimSend, no send), and the sweep continues with the next owner.
        try {
          await processOwner(admin, now, org, owner, sourcesByOrg.get(org.id) ?? [], report)
          report.scanned++
        } catch (e) {
          console.warn(`[lifecycle] skipping ${org.id}/${owner.user_id}:`, e)
          Sentry.captureException(e, {
            tags: { area: 'lifecycle' },
            extra: { orgId: org.id, userId: owner.user_id },
          })
          report.errors.push(`${org.id}/${owner.user_id}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    if (orgs.length < ORG_PAGE) break // short page → last page
  }
  return report
}

async function processOwner(
  admin: Admin,
  now: number,
  org: OrgRow,
  owner: OwnerRow,
  sources: SourceRow[],
  report: SweepReport,
): Promise<void> {
  const email = owner.profiles?.email ?? ''
  if (!email || owner.email_lifecycle_opt_out) return

  // real (non-demo) sources — live ones gate hasRealSource; all of them (incl.
  // deleted) form the id set for the "queried real data?" run check.
  const realSources = sources.filter((s) => !s.is_demo)
  const liveReal = realSources.filter((s) => !s.deleted_at && (s.status === 'active' || s.status === 'pending'))
  const hasRealSource = liveReal.length > 0
  const firstRealLive = liveReal
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]

  const orgAge = now - Date.parse(org.created_at)
  const sourceAge = firstRealLive ? now - Date.parse(firstRealLive.created_at) : null

  // Early skip: if no rule can match on age + source-state ALONE (run counts
  // aside), don't spend the run-count queries. Bounds the sweep to onboarding-age
  // orgs — old/activated workspaces cost nothing. Keep these windows in sync with
  // pickNudge (this is a cheap superset guard, not the decision).
  const couldA3 = hasRealSource && sourceAge != null && sourceAge >= 24 * 60 * 60_000 && sourceAge <= 30 * DAY
  const couldA2orA1 = !hasRealSource && orgAge >= 24 * 60 * 60_000 && orgAge <= 30 * DAY
  if (!couldA3 && !couldA2orA1) return

  // Activation inputs are the ladder's whole decision surface, but they cost ~7 counts —
  // pay for them ONLY once a real source exists (the no-source branch of pickNudge needs
  // nothing but org age).
  const activation = couldA3 ? await getActivationInputs(admin, org.id) : null

  const ctx: LifecycleContext = {
    now,
    orgCreatedAt: Date.parse(org.created_at),
    hasRealSource,
    firstRealSourceAt: firstRealLive ? Date.parse(firstRealLive.created_at) : null,
    firstRealSourceName: firstRealLive?.name ?? null,
    activation,
  }

  const decision = pickNudge(ctx)
  if (!decision) return

  // Frequency cap (per USER across all their orgs — onboarding is one person's experience).
  if ((await sentCountLastNDays(admin, owner.user_id, 7)) >= MAX_LIFECYCLE_PER_WEEK) return

  // Claim before send — the unique (user_id, dedupe_key) makes this the never-double-send point.
  const won = await claimSend(admin, {
    orgId: org.id,
    userId: owner.user_id,
    kind: decision.kind,
    dedupeKey: decision.dedupeKey,
  })
  if (!won) return

  const locale = await resolveUserLocale(owner.user_id)
  let res: { sent: boolean; reason?: string }
  try {
    res = await sendLifecycleEmail({
      to: { email, userId: owner.user_id },
      orgId: org.id,
      nudge: decision.nudge,
      sourceName: decision.sourceName,
      locale,
    })
  } catch (e) {
    // a thrown send (rare — Resend normally returns {error}) must also release the
    // claim, else the one-shot is burned with nothing delivered.
    await releaseClaim(admin, { userId: owner.user_id, dedupeKey: decision.dedupeKey })
    throw e
  }
  if (res.sent) {
    report.sent[decision.kind] = (report.sent[decision.kind] ?? 0) + 1
  } else if (res.reason === 'error') {
    // hard send failure → roll the claim back so a later sweep can retry (a
    // transient Resend blip shouldn't permanently burn a one-shot nudge).
    // 'unconfigured' is NOT rolled back — re-sending into an unconfigured env is pointless.
    await releaseClaim(admin, { userId: owner.user_id, dedupeKey: decision.dedupeKey })
    report.errors.push(`send ${decision.kind} for ${org.id}: ${res.reason}`)
  }
}

/** Count this org's agent_runs, optionally restricted to a set of data_source ids. */
