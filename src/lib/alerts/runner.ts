// NOTE: intentionally NOT `import 'server-only'` — this module is called from the
// Trigger.dev evaluate-alerts task (a plain Node bundle where the server-only
// guard throws), same convention as utils/supabase/admin.ts.
import { randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { executeReadOnly } from '@/lib/query'
import { SQL_ENGINES } from '@/lib/data-sources/engines'
import { persistableError } from '@/lib/supabase-oauth/errors'
import type { AlertErrorCode } from './error-codes'
import { entitledPlan, getPlanLimit } from '@/lib/plans/limits'
import { billingActive } from '@/lib/plans/usage'
import { sendAlertEmail } from '@/lib/email/alert'
import { notifyChannels } from '@/lib/notify/dispatch'
import { resolveOrgLocale } from '@/lib/i18n/resolve-locale'
import { getServerTranslator } from '@/lib/i18n/server-translator'
import { readOrgTimezone } from '@/lib/org/timezone'
import { isMissingSchemaError } from '@/lib/activation/logic'
import {
  decideTransition,
  type AlertOp,
  type AlertStatus,
  effectiveCheckInterval,
  isDue,
} from './evaluate'
import { parseCondition } from './condition'
import { evaluateMonitorResult, monitorMaxRows, type MonitorEvalDetail } from './monitor-eval'

/**
 * Alert evaluation runner — the io shell around the pure `evaluate.ts` logic.
 * Invoked by the Trigger.dev `evaluate-alerts` scheduled task (service-role), NOT
 * by user requests, so it uses the admin client (BYPASSRLS) with EXPLICIT org
 * filters. Each alert is evaluated + persisted + notified independently and
 * idempotently: state writes happen per-alert right after that alert's own
 * evaluate step, so a crash mid-fan-out only drops the unprocessed tail (no
 * partial-batch corruption, no double-notify).
 */

const RUNNER_ALERT_COLUMNS =
  'id, org_id, data_source_id, name, type, metric_sql, operator, threshold, sensitivity, status, consecutive_fires, fire_threshold, cooldown_seconds, last_notified_at, last_checked_at'

interface AlertRow {
  id: string
  org_id: string
  data_source_id: string
  name: string
  type: string // 'threshold' | 'change_rate' | 'anomaly'
  metric_sql: string
  operator: AlertOp
  threshold: number
  sensitivity: number | null // anomaly z-score cutoff; null for threshold alerts
  /** goal monitors (20260927110005): the operator's words + the structured rule. Absent before the
   *  migration and null on legacy monitors — both evaluate exactly as before. */
  goal?: string | null
  condition?: unknown
  status: AlertStatus
  consecutive_fires: number
  fire_threshold: number
  cooldown_seconds: number
  last_notified_at: string | null
  last_checked_at?: string | null
}

export interface EvaluateResult {
  alertId: string
  ok: boolean
  value?: number
  edge?: 'fired' | 'resolved' | null
  notified?: boolean
  error?: string
}

export interface NotifyRecipient {
  email: string
  /** profiles.id — needed to sign the per-recipient unsubscribe token */
  userId: string
}

/**
 * Resolve the notify recipients for an org: owner/admin verified emails only.
 * `kind` applies the member's email opt-out flag (digest/alert are recurring
 * mail with a mandatory unsubscribe); omit it for transactional mail (billing
 * dunning) which has no opt-out.
 */
export async function recipientsDetailFor(
  orgId: string,
  kind?: 'digest' | 'alert' | 'lifecycle',
): Promise<NotifyRecipient[]> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('organization_members')
    .select('user_id, role, email_digest_opt_out, email_alert_opt_out, email_lifecycle_opt_out, profiles(email)')
    .eq('org_id', orgId)
    .in('role', ['owner', 'admin'])
  type Row = {
    user_id: string
    role: string
    email_digest_opt_out: boolean | null
    email_alert_opt_out: boolean | null
    email_lifecycle_opt_out: boolean | null
    profiles: { email: string | null } | null
  }
  return ((data ?? []) as unknown as Row[])
    .filter((r) => {
      if (kind === 'digest') return !r.email_digest_opt_out
      if (kind === 'alert') return !r.email_alert_opt_out
      if (kind === 'lifecycle') return !r.email_lifecycle_opt_out
      return true
    })
    .map((r) => ({ email: r.profiles?.email ?? '', userId: r.user_id }))
    .filter((r) => Boolean(r.email))
}

/** Email-only variant (kept for the transactional callers: billing/dunning). */
export async function recipientsFor(orgId: string, kind?: 'digest' | 'alert'): Promise<string[]> {
  return (await recipientsDetailFor(orgId, kind)).map((r) => r.email)
}

// notification-body translator: resolved from the org's locale (getServerTranslator on
// the 'emailAlert' namespace). The body feeds email + Slack + /app/alerts, so localizing
// it once here keeps every channel consistent with the (localized) email chrome.
type NotifyTr = (key: string, values?: Record<string, string | number>) => string
function intlLocale(loc: string): string {
  return loc === 'ko' ? 'ko-KR' : loc === 'ja' ? 'ja-JP' : 'en-US'
}

/**
 * Human one-liner for the notification body (no LLM — template only). Legacy threshold monitors
 * state the crossed line; anomaly monitors (legacy or goal) the deviation from the learned baseline
 * — the "(mean …, 3.2σ …)" shape `incidents.ts::parseZScore` reads back; relative goal monitors the
 * % change vs the trailing average.
 */
function describeEdge(
  kind: 'fired' | 'resolved',
  value: number,
  alert: Pick<AlertRow, 'operator' | 'threshold'>,
  detail: MonitorEvalDetail,
  tr: NotifyTr,
  loc: string,
): string {
  const nf = (n: number) => n.toLocaleString(intlLocale(loc))
  const anomalyLike =
    detail.kind === 'legacy_anomaly' || (detail.kind === 'goal' && detail.condition.strategy === 'anomaly')
  if (kind === 'resolved') return anomalyLike ? tr('anomalyResolved', { value: nf(value) }) : tr('bodyResolved', { value: nf(value) })

  if (anomalyLike) {
    const mean = detail.kind === 'goal' ? detail.result.mean : detail.mean
    const z = detail.kind === 'goal' ? detail.result.z : detail.z
    const deviation =
      mean !== null && z !== null
        ? tr('anomalyDeviation', {
            mean: nf(Math.round(mean)),
            dev: Math.abs(z) === Infinity ? '∞σ' : `${Math.abs(z).toFixed(1)}σ`,
          })
        : ''
    return tr('anomalyFired', { value: nf(value), deviation })
  }
  if (detail.kind === 'goal' && detail.condition.strategy === 'relative') {
    const change = detail.result.change
    return tr('relativeFired', {
      value: nf(value),
      mean: nf(Math.round((detail.result.mean ?? 0) * 100) / 100),
      change: change === null ? '—' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`,
      window: detail.condition.window,
    })
  }
  const op = detail.kind === 'goal' && detail.condition.strategy === 'absolute' ? detail.condition.operator : alert.operator
  const threshold = detail.kind === 'goal' && detail.condition.strategy === 'absolute' ? detail.condition.threshold : alert.threshold
  return tr('bodyFired', { value: nf(value), threshold: nf(threshold), op: tr(`op.${op}`) })
}

/** The email's `value op threshold` box only makes sense for a fixed line; every other rule shows
 *  the value alone and lets the message carry the comparison. */
function noFixedLine(detail: MonitorEvalDetail): boolean {
  if (detail.kind === 'legacy_anomaly') return true
  return detail.kind === 'goal' && detail.condition.strategy !== 'absolute'
}

/** Evaluate a single alert row: run its SQL, decide, persist, notify. Never throws. `timezone` is
 *  the org's zone — goal monitors skip the bucket still in progress in it (condition.ts). */
export async function evaluateAlert(alert: AlertRow, nowMs: number, timezone = 'UTC'): Promise<EvaluateResult> {
  const admin = requireAdminClient()
  const nowIso = new Date(nowMs).toISOString()

  // 1. run the metric query (read-only, capped, audited by the query engine) and decide through the
  //    ONE evaluation seam shared with "test now" and the recovery check (monitor-eval.ts): legacy
  //    threshold → scalar; legacy anomaly → series z-score; goal monitor → its structured condition.
  const condition = parseCondition(alert.condition)
  const monitor = { type: alert.type, operator: alert.operator, threshold: alert.threshold, sensitivity: alert.sensitivity, condition }
  let value: number | null = null
  let met = false
  let detail: MonitorEvalDetail = { kind: 'threshold' }
  let evalError: string | null = null
  try {
    const res = await executeReadOnly(alert.data_source_id, alert.metric_sql, {
      actor: { kind: 'system', id: `alert:${alert.id}` },
      maxRows: monitorMaxRows(monitor),
      timeoutMs: 30_000,
    })
    const outcome = evaluateMonitorResult(monitor, res, nowMs, timezone)
    if (outcome.ok) {
      value = outcome.value
      met = outcome.met
      detail = outcome.detail
    } else {
      evalError = outcome.code satisfies AlertErrorCode
    }
  } catch (e) {
    // `alerts.last_error` IS rendered on /app/monitors, so a raw exception message becomes UI
    // copy. Faults the product understands persist as an ALERT_ERROR_CODES code the screen can
    // translate (and act on); a genuine query/driver message is kept RAW on purpose — it is the
    // diagnostic a user needs to fix their own SQL. See error-codes.ts.
    evalError = persistableError(e, e instanceof Error ? e.message : String(e))
  }
  const isAnomaly = noFixedLine(detail)

  // 2. on eval error: record it, leave firing state untouched, don't notify
  if (value === null) {
    await admin
      .from('alerts')
      .update({ last_checked_at: nowIso, last_error: evalError })
      .eq('id', alert.id)
    return { alertId: alert.id, ok: false, error: evalError ?? 'unknown' }
  }

  // 3. pure decision (hysteresis + cooldown) — `met` was computed above per alert type
  const t = decideTransition(
    met,
    { status: alert.status, consecutiveFires: alert.consecutive_fires, lastNotifiedAt: alert.last_notified_at },
    { operator: alert.operator, threshold: alert.threshold, fireThreshold: alert.fire_threshold, cooldownSeconds: alert.cooldown_seconds },
    nowMs,
  )

  // 4. persist the hysteresis state that must advance no matter what happens during notification:
  //    consecutive_fires drives the fire_threshold count; last_value/last_checked feed the UI. The
  //    STATUS transition + last_notified_at are deliberately DEFERRED for a notifying edge — they are
  //    written only AFTER the notification is dispatched (step 5), so a transient notify failure
  //    (e.g. a Trigger API blip) re-fires on the next tick instead of silently consuming the edge and
  //    starting the cooldown for a notification that never went out.
  const basePatch: Record<string, unknown> = {
    consecutive_fires: t.consecutiveFires,
    last_checked_at: nowIso,
    last_value: value,
    last_error: null,
  }
  if (t.edge === 'fired') basePatch.last_fired_at = nowIso
  if (!t.notify) basePatch.status = t.status // no notification to gate on → advance status now
  await admin.from('alerts').update(basePatch).eq('id', alert.id)

  // 5. record the edge event, then notify. A FIRED edge routes through the root-cause task, which
  //    investigates WHY and sends the ENRICHED email; resolved edges (or no Trigger) email inline.
  //    Wrapped in try/catch so evaluateAlert honors its "never throws" contract; on a notify failure
  //    we leave status un-advanced so the next tick retries the edge rather than losing it.
  let notified = false
  if (t.edge && t.notify) {
    try {
      const orgLocale = await resolveOrgLocale(alert.org_id)
      const tr = await getServerTranslator(orgLocale, 'emailAlert')
      const message = describeEdge(t.edge, value, alert, detail, tr, orgLocale)

      const { data: evRows } = await admin
        .from('alert_events')
        .insert({ alert_id: alert.id, org_id: alert.org_id, kind: t.edge, value, message, notified: false })
        .select('id')
      const eventId = (evRows?.[0] as { id: string } | undefined)?.id ?? null

      if (t.edge === 'fired' && process.env.TRIGGER_SECRET_KEY) {
        // Root-cause: the explain-alert task owns the notification (enriched email + explanation).
        await tasks.trigger(
          'explain-alert',
          {
            alertId: alert.id,
            eventId,
            orgId: alert.org_id,
            dataSourceId: alert.data_source_id,
            alertName: alert.name,
            metricSql: alert.metric_sql,
            value,
            operator: alert.operator,
            threshold: alert.threshold,
            isAnomaly,
            goal: alert.goal ?? null,
            message,
            locale: orgLocale,
            runId: randomUUID(),
          },
          { concurrencyKey: alert.data_source_id },
        )
        notified = true // the explain task will send + mark the event notified
        // dispatch enqueued → consume the edge (advance status + start cooldown)
        await admin.from('alerts').update({ status: t.status, last_notified_at: nowIso }).eq('id', alert.id)
      } else {
        const to = await recipientsDetailFor(alert.org_id, 'alert')
        const orgName = await orgNameOf(alert.org_id)
        const r = await sendAlertEmail({
          to,
          orgId: alert.org_id,
          kind: t.edge,
          alertName: alert.name,
          orgName,
          value,
          operator: alert.operator,
          threshold: alert.threshold,
          isAnomaly,
          goal: alert.goal ?? null,
          message,
          locale: orgLocale,
          alertId: alert.id,
          eventId,
        })
        notified = r.sent
        if (eventId) await admin.from('alert_events').update({ notified }).eq('id', eventId)
        // primary channel (email) done → consume the edge BEFORE the best-effort Slack post, so a
        // Slack failure can't re-fire an alert whose email already went out (double-email).
        await admin.from('alerts').update({ status: t.status, last_notified_at: nowIso }).eq('id', alert.id)
        try {
          await notifyChannels(alert.org_id, { kind: t.edge, alertName: alert.name, message, locale: orgLocale, alertId: alert.id, eventId })
        } catch (chErr) {
          console.error(`[alerts] channel notify failed for alert ${alert.id}:`, chErr)
          Sentry.captureException(chErr, { tags: { area: 'alerts' }, extra: { alertId: alert.id } })
        }
      }
    } catch (e) {
      // Transient notify failure — status was NOT advanced, so the next cron tick re-detects the
      // edge and retries. Surface it (the notification did NOT go out this tick).
      console.error(`[alerts] notify failed for alert ${alert.id}:`, e)
      Sentry.captureException(e, { tags: { area: 'alerts' }, extra: { alertId: alert.id, edge: t.edge } })
      return { alertId: alert.id, ok: true, value, edge: t.edge, notified: false, error: 'notify_failed' }
    }
  } else if (t.edge) {
    // Edge occurred but cooldown suppresses the notification — record the event for the UI; status
    // was already advanced in step 4 (nothing to gate on).
    const orgLocale = await resolveOrgLocale(alert.org_id)
    const tr = await getServerTranslator(orgLocale, 'emailAlert')
    const message = describeEdge(t.edge, value, alert, detail, tr, orgLocale)
    await admin
      .from('alert_events')
      .insert({ alert_id: alert.id, org_id: alert.org_id, kind: t.edge, value, message, notified: false })
  }

  return { alertId: alert.id, ok: true, value, edge: t.edge, notified }
}

export async function orgNameOf(orgId: string): Promise<string> {
  const admin = requireAdminClient()
  const { data } = await admin.from('organizations').select('name').eq('id', orgId).limit(1)
  return (data?.[0] as { name: string } | undefined)?.name ?? 'Supalens'
}

/** The org row `planIntervalFor` needs — plan alone is not the entitlement (see entitledPlan). */
export interface OrgPlanRow {
  plan?: string | null
  subscription_status?: string | null
}

/**
 * PURE: the effective check interval (seconds) for an org row. Uses `entitledPlan`, so a paid
 * plan whose subscription lapsed (past_due / paused / canceled) is throttled at FREE cadence —
 * the same rule the quota gate and every billing display already apply. Reading `plan` alone
 * would keep giving a canceled premium org the 5-minute cadence forever.
 */
export function planIntervalFor(org: OrgPlanRow | null | undefined): number {
  const plan = entitledPlan(org?.plan, org?.subscription_status)
  return effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval'))
}

/**
 * Keep only the alerts that are due under their org's plan cadence. All alerts of one
 * data source share an org, so the plan is read once. Fails OPEN (everything due) when the
 * plan can't be read, or when billing is not configured at all — a billing hiccup, and the
 * pre-Paddle "everyone unlimited" mode (`billingActive()` gates every other cap the same way),
 * must never silently throttle monitoring.
 */
async function filterDueByPlan(
  admin: ReturnType<typeof requireAdminClient>,
  rows: AlertRow[],
  nowMs: number,
): Promise<AlertRow[]> {
  if (!billingActive()) return rows
  const orgId = rows[0]?.org_id
  if (!orgId) return rows
  const { data, error } = await admin
    .from('organizations')
    .select('plan, subscription_status')
    .eq('id', orgId)
    .limit(1)
  if (error) return rows
  const org = data?.[0] as OrgPlanRow | undefined
  if (!org) return rows // org row missing → fail open, same as the error branch
  const interval = planIntervalFor(org)
  return rows.filter((r) => isDue(r.last_checked_at, interval, nowMs))
}

/**
 * Drop monitors an operator snoozed from /app/incidents. `alerts.snoozed_until` ships in
 * `*_incident_ack.sql`; it is read in its OWN query so an unapplied migration (PostgREST 42703)
 * degrades to "nothing is snoozed" instead of taking the whole evaluation sweep down with it.
 */
async function filterSnoozed(
  admin: ReturnType<typeof requireAdminClient>,
  rows: AlertRow[],
  nowMs: number,
): Promise<AlertRow[]> {
  const { data, error } = await admin
    .from('alerts')
    .select('id, snoozed_until')
    .in('id', rows.map((r) => r.id))
    .not('snoozed_until', 'is', null)
  if (error) return rows
  const snoozed = new Set(
    ((data ?? []) as { id: string; snoozed_until: string | null }[])
      .filter((r) => r.snoozed_until && Date.parse(r.snoozed_until) > nowMs)
      .map((r) => r.id),
  )
  return snoozed.size === 0 ? rows : rows.filter((r) => !snoozed.has(r.id))
}

/**
 * Fetch all enabled alerts that belong to a given data source and evaluate them.
 * The Trigger.dev task fans this out with `concurrencyKey: dataSourceId` so one
 * slow tenant DB can't starve others (mirrors trigger/analyze.ts).
 */
export async function evaluateAlertsForDataSource(dataSourceId: string, nowMs: number): Promise<EvaluateResult[]> {
  const admin = requireAdminClient()
  // inner-join data_sources so alerts pointing at a soft-deleted/disabled source are
  // skipped (removal disables them via cleanupDataSourceDependents, but this guards
  // against rows disabled by any other path / cleanup failures).
  const read = (goalCols: boolean) =>
    admin
      .from('alerts')
      .select(`${RUNNER_ALERT_COLUMNS}${goalCols ? ', goal, condition' : ''}, data_sources!inner(id)`)
      .eq('data_source_id', dataSourceId)
      .eq('enabled', true)
      .is('deleted_at', null)
      .is('data_sources.deleted_at', null)
      .neq('data_sources.status', 'disabled')
      .in('data_sources.engine', [...SQL_ENGINES]) // metric_sql runs through the SQL engine only
  // `goal`/`condition` ship in 20260927110005 — before it is applied the combined select fails with
  // 42703, so retry without them (no goal monitor can exist yet) rather than stop evaluating.
  let { data, error } = await read(true)
  if (error && isMissingSchemaError(error)) ({ data, error } = await read(false))
  const all = (data ?? []) as unknown as AlertRow[]
  // Plan cadence: the cron ticks every 5 minutes for everyone, but each ENTITLED plan's
  // `alert_min_check_interval` decides how often ONE alert is actually evaluated
  // (free 2h / basic 10m / standard 5m; premium's 1m is floored to the cron period).
  // Filtering here (not in dueDataSourceIds) keeps the fan-out cheap and the rule in
  // one place; skipped alerts simply keep their last_checked_at. No Paddle → no cadence
  // throttle either (billingActive gates it, like every other plan cap).
  const due = all.length ? await filterDueByPlan(admin, all, nowMs) : all
  const rows = due.length ? await filterSnoozed(admin, due, nowMs) : due
  // One source = one org, so the org's zone is read once (goal monitors skip the bucket still in
  // progress in it). Never throws — degrades to UTC.
  const timezone = rows.length ? (await readOrgTimezone(admin, rows[0].org_id)).timezone : 'UTC'
  const out: EvaluateResult[] = []
  for (const row of rows) {
    // evaluateAlert is contracted to never throw, but guard the loop anyway so an unexpected fault
    // on one alert (e.g. a DB write error outside the inner try) can't drop the unprocessed tail.
    try {
      out.push(await evaluateAlert(row, nowMs, timezone))
    } catch (e) {
      console.error(`[alerts] evaluateAlert threw for ${row.id}:`, e)
      Sentry.captureException(e, { tags: { area: 'alerts' }, extra: { alertId: row.id } })
      out.push({ alertId: row.id, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

/** Distinct data-source ids that currently have at least one enabled alert (SQL engines only —
 *  creation gates non-SQL sources, but legacy/imported rows must not spin the cron forever). */
export async function dueDataSourceIds(): Promise<string[]> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('alerts')
    .select('data_source_id, data_sources!inner(id)')
    .eq('enabled', true)
    .is('deleted_at', null)
    .is('data_sources.deleted_at', null)
    .neq('data_sources.status', 'disabled')
    .in('data_sources.engine', [...SQL_ENGINES])
  const ids = new Set(((data ?? []) as { data_source_id: string }[]).map((r) => r.data_source_id))
  return [...ids]
}
