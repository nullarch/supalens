'use server'

import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { trackServer } from '@/lib/analytics/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { assertReadOnly, UnsafeSqlError } from '@/lib/query'
import { enforceResourceLimit } from '@/lib/plans/usage'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { isMissingSchemaError } from '@/lib/activation/logic'
import type { ActionResult } from '@/lib/dashboards/types'
import { legacyColumnsFor, parseCondition, type MonitorCondition } from './condition'
import { ANOMALY_SERIES_MAX } from './evaluate'

/**
 * Alert CRUD via the user-JWT client, so the `alerts_write` RLS policy enforces
 * member+ (viewer excluded) and own-org only. Beyond RLS we add two defenses the
 * policy can't express: the metric SQL must be read-only (`assertReadOnly`), and
 * the target data source must belong to the caller's org (verified by a
 * user-JWT SELECT — RLS `ds_sel` only returns own-org sources) so an alert can't
 * be pointed at another tenant's DB.
 */

export type AlertOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'
const OPS: AlertOp[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq']

const ALERTS_PATH = '/app/monitors'
const NOTIFICATIONS_PATH = '/app/settings/notifications'

/** Goal text cap — mirrors the `alerts_goal_len_check` constraint. */
const GOAL_MAX = 500

export interface CreateAlertInput {
  name: string
  dataSourceId: string
  metricSql: string
  /** Goal monitor (docs/goal-monitors-plan.md): the operator's words + the structured rule the
   *  SERIES metric_sql is evaluated by. When `condition` is set, type/operator/threshold/sensitivity
   *  are derived from it (legacyColumnsFor) and the fields below are ignored. */
  goal?: string | null
  condition?: MonitorCondition
  operator?: AlertOp // required for threshold alerts; ignored for anomaly
  threshold?: number // required for threshold alerts; ignored for anomaly
  type?: 'threshold' | 'change_rate' | 'anomaly'
  sensitivity?: number // anomaly only: z-score cutoff (default 3)
  description?: string | null
  fireThreshold?: number
  cooldownSeconds?: number
}

export async function createAlert(input: CreateAlertInput): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  const name = input.name?.trim()
  if (!name) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('nameRequired') }

  // A goal monitor's rule is structured: validate it and derive the legacy columns from it.
  let condition: MonitorCondition | null = null
  if (input.condition !== undefined) {
    condition = parseCondition(input.condition)
    if (!condition) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('conditionInvalid') }
  }
  const goal = input.goal?.trim().slice(0, GOAL_MAX) || null

  // Anomaly alerts carry no user threshold — operator/threshold become unused placeholders and the
  // z-score cutoff lives in `sensitivity`. Threshold alerts validate operator + threshold as before.
  let type = input.type ?? 'threshold'
  const isAnomaly = type === 'anomaly'
  let operator: AlertOp = 'gt'
  let threshold = 0
  let sensitivity: number | null = null
  if (condition) {
    ;({ type, operator, threshold, sensitivity } = legacyColumnsFor(condition))
  } else if (isAnomaly) {
    sensitivity = Number.isFinite(input.sensitivity) ? (input.sensitivity as number) : 3
  } else {
    if (!input.operator || !OPS.includes(input.operator)) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('invalidOperator') }
    if (input.threshold === undefined || !Number.isFinite(input.threshold)) {
      return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('thresholdNaN') }
    }
    operator = input.operator
    threshold = input.threshold
  }

  // metric SQL must be a single read-only SELECT
  try {
    assertReadOnly(input.metricSql)
  } catch (e) {
    const t = await getTranslations('alertActions')
    const msg = e instanceof UnsafeSqlError ? e.message : t('invalidSql')
    return { ok: false, reason: 'error', message: t('metricSqlError', { msg }) }
  }

  const orgId = await ensurePrimaryOrg(supabase, user)

  // the data source must be visible to the caller (RLS ds_sel = own org only)
  const { data: ds } = await supabase
    .from('data_sources')
    .select('id, engine')
    .eq('id', input.dataSourceId)
    .is('deleted_at', null)
    .limit(1)
  const dsRow = ds?.[0] as { id: string; engine?: string | null } | undefined
  if (!dsRow) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('sourceNotFound') }
  // alerts evaluate metric_sql through the SQL engine — a document source (Firestore 등) would
  // fail on every */5 cron tick forever, so reject it at creation
  if (!isSqlEngine(dsRow.engine)) {
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('sqlOnly') }
  }

  const cap = await enforceResourceLimit(orgId, 'alerts_per_org', {
    table: 'alerts',
    label: 'alert',
    locale: await getLocale(),
    softDelete: true,
    filters: [{ column: 'org_id', value: orgId }],
  })
  if (!cap.ok) return { ok: false, reason: 'error', message: cap.error }

  const { data, error } = await supabase
    .from('alerts')
    .insert({
      org_id: orgId,
      data_source_id: input.dataSourceId,
      name,
      description: input.description ?? null,
      type,
      metric_sql: input.metricSql,
      operator,
      threshold,
      sensitivity,
      fire_threshold: input.fireThreshold ?? 1,
      cooldown_seconds: input.cooldownSeconds ?? 3600,
      created_by: user.id,
      // only written when set, so a legacy create keeps working before the goal migration lands
      ...(condition ? { condition } : {}),
      ...(goal ? { goal } : {}),
    })
    .select('id')
    .limit(1)
  if (error) return { ok: false, reason: 'error', message: error.message }

  revalidatePath(ALERTS_PATH)
  return { ok: true, data: { id: (data?.[0] as { id: string } | undefined)?.id ?? '' } }
}

/** Enable/disable an alert. RLS `alerts_write` (member+) gates it. */
export async function toggleAlert(id: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { data, error } = await supabase.from('alerts').update({ enabled }).eq('id', id).is('deleted_at', null).select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('changeDenied') }
  revalidatePath(ALERTS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Pause/resume MANY monitors at once (the list's bulk action). One RLS-gated UPDATE with `in(ids)`
 * — rows the caller may not write are simply not returned, so the count tells the UI how many
 * actually changed. No new policy: identical grant to toggleAlert.
 */
export async function toggleAlertsBulk(ids: string[], enabled: boolean): Promise<ActionResult<{ changed: number }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const clean = Array.from(new Set(ids.filter((i) => typeof i === 'string' && i.length > 0))).slice(0, 200)
  if (clean.length === 0) return { ok: true, data: { changed: 0 } }
  const { data, error } = await supabase.from('alerts').update({ enabled }).in('id', clean).is('deleted_at', null).select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  const changed = data?.length ?? 0
  if (changed === 0) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('changeDenied') }
  revalidatePath(ALERTS_PATH)
  return { ok: true, data: { changed } }
}

/** Update an alert's condition/threshold/SQL. RLS-gated. */
export async function updateAlert(
  id: string,
  patch: {
    name?: string
    threshold?: number
    operator?: AlertOp
    description?: string | null
    metricSql?: string
    sensitivity?: number
    fireThreshold?: number
    cooldownSeconds?: number
    /** goal monitors: replace the structured rule (legacy columns are re-derived from it) */
    condition?: MonitorCondition
    goal?: string | null
  },
): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const set: Record<string, unknown> = {}
  if (patch.condition !== undefined) {
    const condition = parseCondition(patch.condition)
    if (!condition) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('conditionInvalid') }
    set.condition = condition
    Object.assign(set, legacyColumnsFor(condition))
  }
  if (patch.goal !== undefined) set.goal = patch.goal?.trim().slice(0, GOAL_MAX) || null
  if (patch.metricSql !== undefined) {
    try {
      assertReadOnly(patch.metricSql)
    } catch (e) {
      const t = await getTranslations('alertActions')
      const msg = e instanceof UnsafeSqlError ? e.message : t('invalidSql')
      return { ok: false, reason: 'error', message: t('metricSqlError', { msg }) }
    }
    set.metric_sql = patch.metricSql
  }
  if (patch.sensitivity !== undefined) {
    if (!Number.isFinite(patch.sensitivity) || patch.sensitivity <= 0) {
      return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('sensitivityInvalid') }
    }
    set.sensitivity = patch.sensitivity
  }
  if (patch.fireThreshold !== undefined) {
    if (!Number.isInteger(patch.fireThreshold) || patch.fireThreshold < 1) {
      return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('fireThresholdInvalid') }
    }
    set.fire_threshold = patch.fireThreshold
  }
  if (patch.cooldownSeconds !== undefined) {
    if (!Number.isInteger(patch.cooldownSeconds) || patch.cooldownSeconds < 0) {
      return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('cooldownInvalid') }
    }
    set.cooldown_seconds = patch.cooldownSeconds
  }
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (!n) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('nameEmpty') }
    set.name = n
  }
  if (patch.threshold !== undefined) {
    if (!Number.isFinite(patch.threshold)) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('thresholdNaN') }
    set.threshold = patch.threshold
  }
  if (patch.operator !== undefined) {
    if (!OPS.includes(patch.operator)) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('invalidOperator') }
    set.operator = patch.operator
  }
  if (patch.description !== undefined) set.description = patch.description
  if (Object.keys(set).length === 0) return { ok: true, data: undefined }

  // condition changed → reset the hysteresis state so the new condition evaluates fresh
  if (set.metric_sql !== undefined || set.threshold !== undefined || set.operator !== undefined || set.sensitivity !== undefined || set.condition !== undefined) {
    set.status = 'normal'
    set.consecutive_fires = 0
  }

  const { data, error } = await supabase.from('alerts').update(set).eq('id', id).is('deleted_at', null).select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('changeDenied') }
  revalidatePath(ALERTS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Test-run an alert's metric SQL RIGHT NOW and report what the runner would see —
 * value + whether the condition matches. Pure read (no state/notify/event writes),
 * through the same guarded engine the scheduled runner uses. RLS scopes the alert
 * to the caller's org; the actor is the user for audit.
 *
 * Role-gated to member+ like every other write action here: `alerts_sel` also admits a VIEWER,
 * and running arbitrary stored SQL against the tenant DB on demand is exactly the capability
 * `alerts_write` withholds from viewers. The role is checked against the ALERT's org (read off
 * the row), not the active-org cookie.
 */
export async function testAlert(
  id: string,
): Promise<ActionResult<{ value: number; met: boolean; detail: string }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  // `condition` ships in the goal-monitor migration — retry without it before that lands.
  const read = (goalCols: boolean) =>
    supabase
      .from('alerts')
      .select(`id, org_id, data_source_id, type, metric_sql, operator, threshold, sensitivity${goalCols ? ', condition' : ''}`)
      .eq('id', id)
      .is('deleted_at', null)
      .limit(1)
  let { data, error: readError } = await read(true)
  if (readError && isMissingSchemaError(readError)) ({ data, error: readError } = await read(false))
  const alert = (data?.[0] ?? null) as {
    org_id: string
    data_source_id: string
    type: string
    metric_sql: string
    operator: AlertOp
    threshold: number
    sensitivity: number | null
    condition?: unknown
  } | null
  if (!alert) return { ok: false, reason: 'not_found', message: (await getTranslations('alertActions'))('alertNotFound') }
  if (!(await userHasOrgRole(supabase, alert.org_id, user.id, ['owner', 'admin', 'member'])))
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('changeDenied') }

  const { executeReadOnly } = await import('@/lib/query')
  const { evaluateMonitorResult, monitorMaxRows } = await import('./monitor-eval')
  const { getOrgTimezone } = await import('@/lib/org/timezone')
  const t = await getTranslations('alertActions')
  const locale = await getLocale()
  const nf = (n: number) => n.toLocaleString(locale)
  try {
    const monitor = { ...alert, condition: parseCondition(alert.condition) }
    const res = await executeReadOnly(alert.data_source_id, alert.metric_sql, {
      actor: { kind: 'user', id: user.id },
      maxRows: monitorMaxRows(monitor),
      timeoutMs: 30_000,
    })
    // only a goal monitor reads the org zone (it skips the bucket still in progress there)
    const timezone = monitor.condition ? await getOrgTimezone(supabase, alert.org_id) : 'UTC'
    const outcome = evaluateMonitorResult(monitor, res, Date.now(), timezone)
    if (!outcome.ok) {
      // A truncated series drops the newest points → stale "latest"; refuse rather than mislead
      // (mirrors the runner). The user should narrow the time window.
      if (outcome.code === 'series_too_long') return { ok: false, reason: 'error', message: t('seriesTooLong', { max: ANOMALY_SERIES_MAX }) }
      if (outcome.code === 'series_too_short') return { ok: false, reason: 'error', message: t('seriesNotNumeric') }
      return { ok: false, reason: 'error', message: t('scalarNotNumeric') }
    }
    const d = outcome.detail
    let detail: string
    if (d.kind === 'goal' && d.result.insufficient) {
      detail = t('testDetailLearning', { latest: nf(outcome.value), n: d.result.baselineN })
    } else if (d.kind === 'goal' && d.condition.strategy === 'relative') {
      const change = d.result.change
      detail = t('testDetailRelative', {
        latest: nf(outcome.value),
        mean: nf(Math.round((d.result.mean ?? 0) * 100) / 100),
        change: change === null ? '—' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`,
      })
    } else if (d.kind === 'legacy_anomaly' || (d.kind === 'goal' && d.condition.strategy === 'anomaly')) {
      const mean = d.kind === 'goal' ? d.result.mean ?? 0 : d.mean
      const z = d.kind === 'goal' ? d.result.z ?? 0 : d.z
      detail = t('testDetailAnomaly', {
        latest: nf(outcome.value),
        mean: nf(Math.round(mean)),
        z: Math.abs(z) === Infinity ? '∞' : z.toFixed(2),
      })
    } else {
      const threshold = d.kind === 'goal' && d.condition.strategy === 'absolute' ? d.condition.threshold : alert.threshold
      detail = t('testDetail', { value: nf(outcome.value), threshold: nf(threshold) })
    }
    return { ok: true, data: { value: outcome.value, met: outcome.met, detail } }
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : t('queryFailed') }
  }
}

/**
 * The draft persisted on a goal → monitor drafting run — the composer's fallback when the live
 * stream finished before the draft chunk was delivered. Read-only; RLS scopes it to the org.
 */
export async function loadMonitorDraft(runId: string): Promise<ActionResult<{ dataSourceId: string; draft: import('./draft').MonitorDraft }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { getMonitorDraft } = await import('./server')
  const found = await getMonitorDraft(supabase, runId)
  if (!found) return { ok: false, reason: 'not_found' }
  return { ok: true, data: { dataSourceId: found.dataSourceId, draft: found.draft } }
}

export interface AlertEventRow {
  id: string
  kind: string
  value: number | null
  message: string | null
  explanation: string | null
  notified: boolean
  createdAt: string
}

/** Recent firing/resolve history for one alert (RLS member-read on alert_events). */
export async function listAlertEvents(alertId: string): Promise<ActionResult<AlertEventRow[]>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { data, error } = await supabase
    .from('alert_events')
    .select('id, kind, value, message, explanation, notified, created_at')
    .eq('alert_id', alertId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return { ok: false, reason: 'error', message: error.message }
  type Row = { id: string; kind: string; value: number | null; message: string | null; explanation: string | null; notified: boolean; created_at: string }
  return {
    ok: true,
    data: ((data ?? []) as Row[]).map((r) => ({
      id: r.id, kind: r.kind, value: r.value, message: r.message,
      explanation: r.explanation, notified: r.notified, createdAt: r.created_at,
    })),
  }
}

/** Soft-delete an alert (RLS-gated). */
export async function deleteAlert(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { data, error } = await supabase
    .from('alerts')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('deleteDenied') }
  revalidatePath(ALERTS_PATH)
  return { ok: true, data: undefined }
}

/** Do not return database messages that may contain a posting credential in row details. */
async function notificationSaveFailure(): Promise<ActionResult> {
  return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('notificationSaveFailed') }
}

/** Set (or clear, with '') the org's Slack incoming-webhook for alert notifications. owner/admin only
 *  — the webhook is a posting credential, so the row is role-gated (RLS `slack_rw`) and written via the
 *  service-role client after an explicit role check. */
export async function setSlackWebhook(webhookUrl: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)

  if (!(await userHasOrgRole(supabase, orgId, user.id)))
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('adminOnly') }

  const url = webhookUrl.trim()
  if (url && !/^https:\/\/hooks\.slack\.com\//.test(url)) {
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('slackWebhookInvalid') }
  }

  const admin = requireAdminClient()
  if (!url) {
    const { error } = await admin.from('org_slack_config').delete().eq('org_id', orgId)
    if (error) return notificationSaveFailure()
  } else {
    const { data, error } = await admin
      .from('org_slack_config')
      .upsert({ org_id: orgId, webhook_url: url, created_by: user.id }, { onConflict: 'org_id' })
      .select('org_id')
    if (error || !data?.length) return notificationSaveFailure()
  }
  revalidatePath(ALERTS_PATH)
  revalidatePath(NOTIFICATIONS_PATH)
  return { ok: true, data: undefined }
}

/** Set (or clear, with '') the org's Discord incoming-webhook for alert notifications. owner/admin
 *  only — the webhook URL embeds a posting credential, so it lives in a notification_channels row
 *  (provider='discord', target=URL) behind the owner/admin-only `nc_rw` policy, written via the
 *  service-role client after an explicit role check (same model as setSlackWebhook). */
export async function setDiscordWebhook(webhookUrl: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)

  if (!(await userHasOrgRole(supabase, orgId, user.id)))
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('adminOnly') }

  const url = webhookUrl.trim()
  // host-pin the target: the Trigger host POSTs to this URL, so an arbitrary host would be an
  // SSRF/exfil surface — mirror the hooks.slack.com pin on the Slack webhook.
  if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('discordWebhookInvalid') }
  }

  const admin = requireAdminClient()

  // clear → soft-delete any existing discord channel rows for the org
  if (!url) {
    const { error } = await admin
      .from('notification_channels')
      .update({ enabled: false, deleted_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('provider', 'discord')
      .is('deleted_at', null)
    if (error) return notificationSaveFailure()
    revalidatePath(ALERTS_PATH)
    revalidatePath(NOTIFICATIONS_PATH)
    return { ok: true, data: undefined }
  }

  const { data: existing, error: lookupError } = await admin
    .from('notification_channels')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', 'discord')
    .is('deleted_at', null)
    .limit(1)
  if (lookupError || !existing) return notificationSaveFailure()
  const row = { target: url, label: 'Discord', enabled: true }
  if (existing && existing.length > 0) {
    const { data, error } = await admin.from('notification_channels').update(row)
      .eq('id', (existing[0] as { id: string }).id).eq('org_id', orgId).eq('provider', 'discord').is('deleted_at', null).select('id')
    if (error || !data?.length) return notificationSaveFailure()
  } else {
    const { data, error } = await admin
      .from('notification_channels')
      .insert({ org_id: orgId, provider: 'discord', created_by: user.id, ...row })
      .select('id')
    if (error || !data?.length) return notificationSaveFailure()
  }
  revalidatePath(ALERTS_PATH)
  revalidatePath(NOTIFICATIONS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Set (or clear, with '') the Slack BOT channel that alerts post to (via chat.postMessage). owner/admin
 * only. Upserts a single provider='slack' row into notification_channels bound to the org's active Slack
 * connection. Preferred over the incoming webhook when a bot is connected (see notify/dispatch.ts).
 */
export async function setAlertSlackChannel(channelId: string, channelName: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)

  if (!(await userHasOrgRole(supabase, orgId, user.id)))
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('adminOnly') }

  const admin = requireAdminClient()
  const id = channelId.trim()

  // clear → soft-delete any existing slack channel rows for the org
  if (!id) {
    const { error } = await admin
      .from('notification_channels')
      .update({ enabled: false, deleted_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('provider', 'slack')
      .is('deleted_at', null)
    if (error) return notificationSaveFailure()
    revalidatePath(ALERTS_PATH)
    revalidatePath(NOTIFICATIONS_PATH)
    return { ok: true, data: undefined }
  }

  // must have an active Slack bot connection to post through
  const { data: conn, error: connectionError } = await admin
    .from('provider_connections')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', 'slack')
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
  if (connectionError || !conn) return notificationSaveFailure()
  const connectionId = (conn?.[0] as { id: string } | undefined)?.id
  if (!connectionId) return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('slackConnectFirst') }

  const { data: existing, error: lookupError } = await admin
    .from('notification_channels')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', 'slack')
    .is('deleted_at', null)
    .limit(1)
  if (lookupError || !existing) return notificationSaveFailure()
  const row = { target: id, label: channelName.trim() || id, connection_id: connectionId, enabled: true }
  if (existing && existing.length > 0) {
    const { data, error } = await admin.from('notification_channels').update(row)
      .eq('id', (existing[0] as { id: string }).id).eq('org_id', orgId).eq('provider', 'slack').is('deleted_at', null).select('id')
    if (error || !data?.length) return notificationSaveFailure()
  } else {
    const { data, error } = await admin.from('notification_channels').insert({ org_id: orgId, provider: 'slack', created_by: user.id, ...row }).select('id')
    if (error || !data?.length) return notificationSaveFailure()
  }
  // Funnel: picking the destination channel is the step after `slack_connected`.
  trackServer('slack_channel_selected', user.id, { org_id: orgId })
  revalidatePath(ALERTS_PATH)
  revalidatePath(NOTIFICATIONS_PATH)
  return { ok: true, data: undefined }
}

/**
 * "Send test alert": deliver a clearly-labelled test through every configured channel (Slack bot /
 * webhook, Discord) plus an email to the CALLER only — never the whole owner/admin list, so a click
 * can't spam the team. owner/admin only (it exercises posting credentials). Same never-throw
 * adapters the runner uses, so what arrives is exactly what a real firing looks like.
 */
export async function sendTestNotification(): Promise<ActionResult<{ channels: boolean; email: boolean }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)
  if (!(await userHasOrgRole(supabase, orgId, user.id)))
    return { ok: false, reason: 'error', message: (await getTranslations('alertActions'))('adminOnly') }

  const locale = await getLocale()
  const t = await getTranslations('alertActions')
  const alertName = t('testNotifyName')
  const message = t('testNotifyMessage')

  const { notifyChannels } = await import('@/lib/notify/dispatch')
  const channels = await notifyChannels(orgId, { kind: 'fired', alertName, message, locale })

  let email = false
  if (user.email) {
    const admin = requireAdminClient()
    const { data: orgRows } = await admin.from('organizations').select('name').eq('id', orgId).limit(1)
    const orgName = (orgRows?.[0] as { name: string } | undefined)?.name ?? ''
    const { sendAlertEmail } = await import('@/lib/email/alert')
    const r = await sendAlertEmail({
      to: [{ email: user.email, userId: user.id }],
      orgId,
      kind: 'fired',
      alertName,
      orgName,
      value: 0,
      operator: 'gt',
      threshold: 0,
      isAnomaly: true,
      message,
      locale,
    })
    email = r.sent
  }
  // Funnel: the last setup step — proof that a real notification can reach the team.
  trackServer('test_alert_sent', user.id, { org_id: orgId, channels, email })
  return { ok: true, data: { channels, email } }
}
