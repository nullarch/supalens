// NOT `import 'server-only'` — runs on the Trigger.dev host (agent + admin client + email),
// same convention as alerts/explain.ts.
import { randomUUID } from 'crypto'

import { isSelfHosted } from '@/config/edition'

import * as Sentry from '@sentry/node'

import { runByEngine } from '@/lib/agent/run-by-engine'
import { SYSTEM_RUN_MODEL } from '@/lib/agent/models'
import { requireAdminClient } from '@/utils/supabase/admin'
import { recipientsDetailFor } from '@/lib/alerts/runner'
import { sendDigestEmail, type DigestItem, type DigestSection } from '@/lib/email/digest'
import { getServerTranslator } from '@/lib/i18n/server-translator'
import { resolveOrgLocale } from '@/lib/i18n/resolve-locale'

// English on purpose: prompt scaffolding is never translated (i18n bucket #2) — the ANSWER
// language follows the org locale via languageDirective, threaded through runByEngine below.
const DIGEST_QUESTION = `Summarize the most important changes in this data source over the last 7 days. Compare the key metrics that exist (signups, revenue, active users, orders, …) against the previous week, and condense notable trends or outliers into 3-5 short bullets. Write for an operator who has 30 seconds in the morning, with concrete numbers (before → after). Do not speculate about anything the data doesn't confirm.`

/** Per-digest source cap. One consolidated email summarizes at most this many sources; the
 *  rest are noted as "+N more" (keeps a many-source org's digest — and its LLM cost — bounded). */
const MAX_DIGEST_SOURCES = 6

interface DigestSource {
  dataSourceId: string
  name: string
  /** data_sources.engine — each source's digest run dispatches by it (runByEngine). */
  engine: string | null
}

export interface OrgDigestTarget {
  orgId: string
  orgName: string
  sources: DigestSource[]
  /** active sources beyond the cap that were NOT summarized (footer note only). */
  moreCount: number
}

/**
 * Discover the orgs that should receive a weekly digest and the (capped) source list for each.
 * Gate: PAID plan (digest is a paid feature) AND `weekly_digest_enabled` (opt-in — default off,
 * so no org is silently blasted). Excludes the auto-provisioned demo source. One target per ORG
 * (was one per data source) so the fan-out — and therefore the email — is org-granular.
 */
export async function digestOrgTargets(): Promise<OrgDigestTarget[]> {
  const admin = requireAdminClient()
  let orgQuery = admin
    .from('organizations')
    .select('id, name')
    .eq('weekly_digest_enabled', true)
    .is('deleted_at', null)
  // The paid-plan gate is a hosted-service rule; a self-hosted install has no plans.
  if (!isSelfHosted()) orgQuery = orgQuery.neq('plan', 'free')
  const { data: orgData } = await orgQuery
  const orgs = ((orgData ?? []) as { id: string; name: string }[]) ?? []
  if (orgs.length === 0) return []
  const orgIds = orgs.map((o) => o.id)

  const { data: srcData } = await admin
    .from('data_sources')
    .select('id, org_id, name, engine, created_at')
    .in('org_id', orgIds)
    .eq('status', 'active')
    .neq('is_demo', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true }) // oldest (usually the primary) sources first
  const byOrg = new Map<string, DigestSource[]>()
  for (const s of (srcData ?? []) as { id: string; org_id: string; name: string; engine: string | null }[]) {
    const list = byOrg.get(s.org_id) ?? []
    list.push({ dataSourceId: s.id, name: s.name, engine: s.engine })
    byOrg.set(s.org_id, list)
  }

  const targets: OrgDigestTarget[] = []
  for (const org of orgs) {
    const all = byOrg.get(org.id) ?? []
    if (all.length === 0) continue // opted-in but no source to summarize → never send an empty digest
    targets.push({
      orgId: org.id,
      orgName: org.name,
      sources: all.slice(0, MAX_DIGEST_SOURCES),
      moreCount: Math.max(0, all.length - MAX_DIGEST_SOURCES),
    })
  }
  return targets
}


const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type T = Awaited<ReturnType<typeof getServerTranslator>>

/**
 * The three DETERMINISTIC operator sections — monitor health, the week's incidents, and the
 * review queue. These read supalens's own Postgres only (no tenant DB, no LLM), so the digest
 * is useful even when every agent summary fails. Each returns null when it has nothing to say,
 * so an org with no monitors doesn't get three empty boxes.
 */
async function healthSection(orgId: string, t: T): Promise<DigestSection | null> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('alerts')
    .select('enabled, status, last_error')
    .eq('org_id', orgId)
    .is('deleted_at', null)
  const rows = (data ?? []) as { enabled: boolean; status: string; last_error: string | null }[]
  if (rows.length === 0) return null
  const enabled = rows.filter((r) => r.enabled)
  const items: DigestItem[] = [
    { label: t('health.watching'), value: t('health.unit', { count: enabled.length }) },
    { label: t('health.firing'), value: t('health.unit', { count: enabled.filter((r) => r.status === 'firing').length }) },
    { label: t('health.errored'), value: t('health.unit', { count: enabled.filter((r) => r.last_error).length }) },
    { label: t('health.paused'), value: t('health.unit', { count: rows.length - enabled.length }) },
  ]
  return { name: t('sections.health'), items }
}

/** Bounds the 7-day event scan. Only a count and the newest 5 are rendered, so a monitor that
 *  flapped thousands of times must not pull its whole history into the cron's memory. */
const MAX_DIGEST_EVENTS = 500

/**
 * Returns the section AND the raw event count, because the two are not the same signal: with zero
 * events this still renders a reassuring "no incidents this week" line, which is worth showing
 * NEXT TO real content but is not itself a reason to send a mail. `runOrgWeeklyDigest` uses
 * `events` for the send decision and `section` for the body.
 */
async function incidentsSection(orgId: string, nowMs: number, t: T): Promise<{ section: DigestSection; events: number }> {
  const admin = requireAdminClient()
  const since = new Date(nowMs - WEEK_MS).toISOString()
  const { data } = await admin
    .from('alert_events')
    .select('id, alert_id, kind, value, created_at, explanation, alerts!inner(name)')
    .eq('org_id', orgId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_DIGEST_EVENTS)
  const rows = (data ?? []) as unknown as {
    id: string
    alert_id: string
    kind: string
    value: number | null
    created_at: string
    explanation: string | null
    alerts: { name: string } | null
  }[]
  if (rows.length === 0) {
    return { section: { name: t('sections.incidents'), items: [{ label: t('incidents.none') }] }, events: 0 }
  }

  const fired = rows.filter((r) => r.kind === 'fired')
  const resolvedIds = new Set(rows.filter((r) => r.kind === 'resolved').map((r) => r.alert_id))
  const items: DigestItem[] = [
    {
      label: t('incidents.count', { fired: fired.length, resolved: rows.length - fired.length }),
    },
  ]
  // Top 5 by recency, each with the first line of the root-cause explanation when one exists.
  for (const f of fired.slice(0, 5)) {
    const first = f.explanation?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null
    items.push({
      label: f.alerts?.name ?? t('sections.incidents'),
      value: resolvedIds.has(f.alert_id) ? t('incidents.resolved') : t('incidents.open'),
      note: first,
    })
  }
  return { section: { name: t('sections.incidents'), items }, events: rows.length }
}

async function pendingSection(orgId: string, sourceIds: string[], t: T): Promise<DigestSection | null> {
  if (sourceIds.length === 0) return null
  const admin = requireAdminClient()
  const [proposed, stale, ctx] = await Promise.all([
    admin
      .from('kpi_catalog')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'proposed'),
    admin.from('kpi_catalog').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'stale'),
    admin
      .from('data_source_context')
      .select('data_source_id', { count: 'exact', head: true })
      .in('data_source_id', sourceIds)
      .eq('status', 'stale'),
  ])
  const items: DigestItem[] = []
  if ((proposed.count ?? 0) > 0) items.push({ label: t('pending.kpis'), value: String(proposed.count) })
  if ((stale.count ?? 0) > 0) items.push({ label: t('pending.stale'), value: String(stale.count) })
  if ((ctx.count ?? 0) > 0) items.push({ label: t('pending.context'), value: String(ctx.count) })
  if (items.length === 0) return null
  return { name: t('sections.pending'), items }
}

/**
 * Generate + email ONE consolidated weekly digest for an org: run the read-only analysis agent
 * (SUPALENS.md-aware) once PER source — sequentially, since org-level concurrency isolation now
 * lives on the Trigger task (concurrencyKey: orgId) — collect each into a section, and send a
 * SINGLE email covering all of them. A system run (not via the analyze task) so it does NOT meter
 * the org's quota. Never throws; recipients are org owner/admin verified addresses only.
 */
export async function runOrgWeeklyDigest(
  t: OrgDigestTarget,
  nowMs = Date.now(),
): Promise<{ ok: boolean; sent: boolean; sources: number }> {
  const locale = await resolveOrgLocale(t.orgId)
  const tr = await getServerTranslator(locale, 'emailDigest')

  // Operator sections FIRST — the digest is a monitoring report; the KPI narrative is third.
  const sections: DigestSection[] = []
  const [health, incidents] = await Promise.all([
    healthSection(t.orgId, tr).catch(() => null),
    incidentsSection(t.orgId, nowMs, tr).catch(() => ({ section: null, events: 0 })),
  ])
  if (health) sections.push(health)
  if (incidents.section) sections.push(incidents.section)

  const summaries: DigestSection[] = []
  for (const src of t.sources) {
    let text = ''
    try {
      // dispatch by engine (SQL vs Firestore runner) — this runs on the Trigger host, where the
      // in-process runners live, so runByEngine is the right seam (same as messenger-answer)
      const res = await runByEngine(src.engine, {
        orgId: t.orgId,
        dataSourceId: src.dataSourceId,
        userId: 'system',
        runId: randomUUID(),
        question: DIGEST_QUESTION,
        maxTurns: 14,
        maxTotalTokens: 300_000,
        locale,
        // system summarization run → cheaper model (~3× cost cut vs the hero Sonnet path)
        model: SYSTEM_RUN_MODEL,
      })
      if (res.ok && res.text.trim()) text = res.text.trim()
    } catch (e) {
      // one source failing must not sink the whole digest — skip it, keep the others.
      console.error(`[digest] generation failed for ${src.dataSourceId}:`, e)
      Sentry.captureException(e, { tags: { area: 'digest' }, extra: { dataSourceId: src.dataSourceId, orgId: t.orgId } })
    }
    // Group-labelled per source — an extra header section would render as an empty box.
    if (text) summaries.push({ name: `${tr('sections.changes')} · ${src.name}`, summary: text })
  }
  sections.push(...summaries)

  const pending = await pendingSection(
    t.orgId,
    t.sources.map((s) => s.dataSourceId),
    tr,
  ).catch(() => null)
  if (pending) sections.push(pending)

  // Never send an empty digest. `sections.length === 0` could not express that: incidentsSection
  // always returns a section (the "no incidents this week" line), so the gate was unreachable and
  // an opted-in org with no monitors, no events and a failed summary still got a mail whose entire
  // content was "nothing happened".
  //
  // REAL CONTENT is any one of: a monitor exists (health) · something fired or resolved this week
  // · the review queue is non-empty · at least one agent summary succeeded. Monitor health ALONE
  // still sends — that decision is deliberate and unchanged: "N watching, 0 firing" is the report.
  const hasRealContent =
    Boolean(health) || incidents.events > 0 || Boolean(pending) || summaries.length > 0
  if (!hasRealContent) return { ok: false, sent: false, sources: 0 }

  const to = await recipientsDetailFor(t.orgId, 'digest')
  const r = await sendDigestEmail({
    to,
    orgId: t.orgId,
    orgName: t.orgName,
    sections,
    moreCount: t.moreCount,
    locale,
  })
  return { ok: true, sent: r.sent, sources: summaries.length }
}
