import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAdminClient } from '@/utils/supabase/admin'
import { emailConfigured } from '@/lib/email/resend'
import { createClient } from '@/utils/supabase/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { isMissingSchemaError } from '@/lib/activation/logic'
import { parseCondition, type MonitorCondition } from './condition'
import { parseMonitorDraft, type MonitorDraft } from './draft'

/**
 * READ-FAILURE CONTRACT (shared with `lib/activation/state.ts`).
 *
 * Every read below feeds a screen that STATES SOMETHING when it comes back empty — "no monitors
 * yet", "no incidents yet", "connect a data source first", "no destination". Swallowing an error
 * into `[]` turns a transient DB fault into a confident false all-clear on the one surface whose
 * entire job is to say whether anything is wrong.
 *
 * So: `42703` undefined_column / `42P01` undefined_table (code shipped ahead of its migration) are
 * the ONLY errors that may degrade to empty; everything else throws and hits the /app error
 * boundary, which says "something failed" instead of "nothing is being watched".
 */
function describeError(error: unknown): string {
  if (!error) return 'unknown error'
  const e = error as { message?: unknown; code?: unknown }
  const code = typeof e.code === 'string' ? ` (${e.code})` : ''
  return `${typeof e.message === 'string' ? e.message : String(error)}${code}`
}

/** Throws unless the failure is an unapplied migration, in which case the caller degrades to empty. */
function assertReadable(label: string, error: unknown): void {
  if (!error) return
  if (isMissingSchemaError(error)) return
  throw new Error(`alerts: ${label} read failed — ${describeError(error)}`)
}

/** One monitor as the /app/monitors list + detail need it (client-safe). */
export interface AlertSummary {
  id: string
  name: string
  description: string | null
  type: string
  /** the monitor's OWN org — a detail page must role-check against this, not the active-org cookie */
  orgId: string
  dataSourceId: string
  dataSourceName: string | null
  /** RLS-visible, same-org Supabase connection; never contains credentials/config. */
  connectionId?: string | null
  connectionStatus?: string | null
  connectionRefreshedAt?: string | null
  operator: string
  threshold: number
  metricSql: string
  sensitivity: number | null
  /** goal monitors: the operator's own words (the row's headline) — null on legacy monitors */
  goal: string | null
  /** goal monitors: the structured rule; null = legacy threshold/anomaly evaluation */
  condition: MonitorCondition | null
  fireThreshold: number
  cooldownSeconds: number
  enabled: boolean
  status: string
  lastValue: number | null
  lastCheckedAt: string | null
  lastError: string | null
  lastNotifiedAt: string | null
  createdAt: string
  /** AI root-cause of the most recent firing (from the latest fired alert_event), if any. */
  explanation: string | null
  lastFiredAt: string | null
}

const ALERT_COLUMNS =
  'id, name, description, type, org_id, data_source_id, operator, threshold, metric_sql, sensitivity, fire_threshold, cooldown_seconds, enabled, status, last_value, last_checked_at, last_error, last_notified_at, created_at, data_sources(name, org_id, provider, connection_id, deleted_at, provider_connections(id, org_id, provider, status, token_refreshed_at, deleted_at))'

/** `goal`/`condition` (20260927110005) are appended to the select only while the migration is
 *  live; before it the read retries without them (see `selectAlerts`). */
const GOAL_COLUMNS = ', goal, condition'

type AlertRow = {
  id: string; name: string; description: string | null; type: string; org_id: string
  data_source_id: string; operator: string; threshold: number; metric_sql: string; sensitivity: number | null
  goal?: string | null; condition?: unknown
  fire_threshold: number | null; cooldown_seconds: number | null
  enabled: boolean; status: string; last_value: number | null; last_checked_at: string | null; last_error: string | null
  last_notified_at: string | null; created_at: string
  data_sources: { name: string | null; org_id?: string; provider?: string; connection_id?: string | null; deleted_at?: string | null;
    provider_connections?: { id: string; org_id: string; provider: string; status: string; token_refreshed_at: string | null; deleted_at: string | null } | null } | null
}

/**
 * Run an alerts read with the goal columns, retrying without them when the goal migration isn't
 * applied yet (42703) — adding them unconditionally would turn a deploy-before-migrate into an
 * empty monitors board, the exact false all-clear the read contract above forbids.
 */
async function selectAlerts(
  run: (cols: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ data: unknown; error: unknown }> {
  const first = await run(ALERT_COLUMNS + GOAL_COLUMNS)
  if (first.error && isMissingSchemaError(first.error)) return run(ALERT_COLUMNS)
  return first
}

function toSummary(r: AlertRow): AlertSummary {
  const source = r.data_sources
  const connectionId = source?.org_id === r.org_id && source.provider === 'supabase' && !source.deleted_at ? source.connection_id ?? null : null
  const connection = source?.provider_connections
  const visible = !!connectionId && connection?.id === connectionId && connection.org_id === r.org_id && connection.provider === 'supabase' && !connection.deleted_at
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    orgId: r.org_id,
    dataSourceId: r.data_source_id,
    dataSourceName: r.data_sources?.name ?? null,
    connectionId,
    connectionStatus: visible ? connection.status : null,
    connectionRefreshedAt: visible ? connection.token_refreshed_at : null,
    operator: r.operator,
    threshold: r.threshold,
    metricSql: r.metric_sql,
    sensitivity: r.sensitivity,
    goal: r.goal ?? null,
    condition: parseCondition(r.condition),
    fireThreshold: r.fire_threshold ?? 1,
    cooldownSeconds: r.cooldown_seconds ?? 3600,
    enabled: r.enabled,
    status: r.status,
    lastValue: r.last_value,
    lastCheckedAt: r.last_checked_at,
    lastError: r.last_error,
    lastNotifiedAt: r.last_notified_at,
    createdAt: r.created_at,
    explanation: null,
    lastFiredAt: null,
  }
}

/**
 * List an org's monitors (RLS-scoped to members via `alerts_sel`). Joins the data
 * source name for display. Soft-deleted rows are excluded by the RLS policy.
 */
export async function listAlerts(supabase: SupabaseClient, orgId: string): Promise<AlertSummary[]> {
  // NOTE: the alerts_write (`for all`) policy also grants SELECT without a
  // deleted_at filter, so — exactly like listDashboards — we must exclude
  // soft-deleted rows in the query, not rely on the alerts_sel policy alone.
  const { data, error } = await selectAlerts((cols) =>
    supabase
      .from('alerts')
      .select(cols)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  )
  // A transient DB fault must not render an empty board that reads as "nothing is being
  // watched" (a false all-clear on a monitoring product). Only a deploy-before-migration
  // schema gap degrades to []; every other error surfaces to the route's error boundary.
  assertReadable('monitors list', error)
  if (error) return [] // reached only for a schema gap — assertReadable threw on anything else
  const summaries = ((data ?? []) as unknown as AlertRow[]).map(toSummary)

  // Attach the AI root-cause from each alert's most recent firing event (alert_events_sel RLS scopes
  // to org members). Fetch recent fired events desc + keep the first (latest) seen per alert.
  const { data: events, error: eventsError } = await supabase
    .from('alert_events')
    .select('alert_id, explanation, created_at')
    .eq('org_id', orgId)
    .eq('kind', 'fired')
    .order('created_at', { ascending: false })
    .limit(300)
  // same contract: an unread history would silently blank every "last incident" cell
  assertReadable('monitor incident history', eventsError)
  const latest = new Map<string, { explanation: string | null; created_at: string }>()
  for (const e of (events ?? []) as { alert_id: string; explanation: string | null; created_at: string }[]) {
    if (!latest.has(e.alert_id)) latest.set(e.alert_id, { explanation: e.explanation, created_at: e.created_at })
  }
  for (const sm of summaries) {
    const l = latest.get(sm.id)
    if (l) {
      sm.explanation = l.explanation
      sm.lastFiredAt = l.created_at
    }
  }
  return summaries
}

/**
 * One monitor by id (RLS: own-org members only) with its latest-firing explanation, or null.
 * `null` means NOT FOUND (no row, or another tenant's id) — the caller 404s on it. A failed READ
 * is a different statement and must not be told as "this monitor does not exist", so it throws.
 */
export async function getAlert(supabase: SupabaseClient, id: string): Promise<AlertSummary | null> {
  const { data, error } = await selectAlerts((cols) =>
    supabase.from('alerts').select(cols).eq('id', id).is('deleted_at', null).limit(1),
  )
  assertReadable('monitor', error)
  const row = (data as unknown[] | null)?.[0] as AlertRow | undefined
  if (!row) return null
  const sm = toSummary(row)
  const { data: ev, error: evError } = await supabase
    .from('alert_events')
    .select('explanation, created_at')
    .eq('alert_id', id)
    .eq('kind', 'fired')
    .order('created_at', { ascending: false })
    .limit(1)
  assertReadable('monitor last firing', evError)
  const last = ev?.[0] as { explanation: string | null; created_at: string } | undefined
  if (last) {
    sm.explanation = last.explanation
    sm.lastFiredAt = last.created_at
  }
  return sm
}

/** Firing / resolve history of one monitor, newest first (RLS member-read on alert_events). */
export interface AlertEventSummary {
  id: string
  kind: string
  value: number | null
  message: string | null
  explanation: string | null
  notified: boolean
  createdAt: string
}
export async function listAlertEventsFor(supabase: SupabaseClient, alertId: string, limit = 50): Promise<AlertEventSummary[]> {
  const { data, error } = await supabase
    .from('alert_events')
    .select('id, kind, value, message, explanation, notified, created_at')
    .eq('alert_id', alertId)
    .order('created_at', { ascending: false })
    .limit(limit)
  // empty renders as "No incidents yet" — a claim, not a blank; only a schema gap may make it
  assertReadable('incident history', error)
  type Row ={ id: string; kind: string; value: number | null; message: string | null; explanation: string | null; notified: boolean; created_at: string }
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, kind: r.kind, value: r.value, message: r.message, explanation: r.explanation, notified: r.notified, createdAt: r.created_at,
  }))
}

/** Active data sources for the monitor-create picker (client-safe). */
export interface DataSourceOption {
  id: string
  name: string
}
export async function listActiveDataSources(supabase: SupabaseClient, orgId: string): Promise<DataSourceOption[]> {
  const { data, error } = await supabase
    .from('data_sources')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name', { ascending: true })
  // empty makes the page say "Connect a data source first" to someone who already has one
  assertReadable('active data sources', error)
  return ((data ?? []) as { id: string; name: string }[]).map((d) => ({ id: d.id, name: d.name }))
}

/**
 * Where an org's alerts are delivered — the NON-SECRET summary every member may see on the monitors
 * list (a Slack channel NAME is not a credential; the webhook URLs never leave this function).
 * Read via service_role because `notification_channels` / `org_slack_config` are owner/admin-only
 * under RLS, which would hide the destination from members entirely.
 */
export interface NotificationTargets {
  /** the Slack bot channel label (e.g. "alerts"), when a bot channel is configured */
  slackChannel: string | null
  slackWebhook: boolean
  discord: boolean
  /** owner/admin recipients who have not opted out of alert mail */
  emailCount: number
}
export async function getNotificationTargets(orgId: string): Promise<NotificationTargets> {
  const admin = requireAdminClient()
  const [{ data: channels, error: chError }, { data: sc, error: scError }, { data: members, error: memError }] =
    await Promise.all([
    admin
      .from('notification_channels')
      .select('provider, label, target')
      .eq('org_id', orgId)
      .in('provider', ['slack', 'discord'])
      .eq('enabled', true)
      .is('deleted_at', null),
    admin.from('org_slack_config').select('org_id').eq('org_id', orgId).limit(1),
    admin
      .from('organization_members')
      .select('user_id, email_alert_opt_out, profiles(email)')
      .eq('org_id', orgId)
      .in('role', ['owner', 'admin']),
    ])
  // "No destination" is a claim that nobody would be told — never say it because a read failed
  assertReadable('notification channels', chError)
  assertReadable('slack webhook config', scError)
  assertReadable('notification recipients', memError)
  type Ch = { provider: string; label: string | null; target: string }
  const slack = ((channels ?? []) as Ch[]).find((c) => c.provider === 'slack')
  const discord = ((channels ?? []) as Ch[]).some((c) => c.provider === 'discord')
  type Mem = { email_alert_opt_out: boolean | null; profiles: { email: string | null } | null }
  // No transport (neither SMTP nor Resend) means nobody is told by email, whoever is listed.
  const emailCount = emailConfigured()
    ? ((members ?? []) as unknown as Mem[]).filter((m) => !m.email_alert_opt_out && m.profiles?.email).length
    : 0
  return {
    slackChannel: slack ? (slack.label ?? slack.target) : null,
    slackWebhook: Boolean(sc && sc.length > 0),
    discord,
    emailCount,
  }
}

/**
 * The full notification configuration for /app/settings/notifications — owner/admin ONLY. The
 * webhook URLs it returns ARE posting credentials, so the role check lives HERE rather than in the
 * callers: a future call site that forgets to gate gets `null`, not a credential it can ship to a
 * viewer's browser. Callers keep their own gate too (they need `canConfigure` for the UI anyway).
 */
export interface EmailRecipientSummary {
  userId: string
  email: string
  role: string
  optedOut: boolean
}
export interface NotificationConfig {
  slackWebhook: string | null
  discordWebhook: string | null
  slackConnected: boolean
  slackChannels: Array<{ id: string; name: string }>
  selectedSlackChannel: string | null
  emailRecipients: EmailRecipientSummary[]
}
export async function loadNotificationConfig(orgId: string): Promise<NotificationConfig | null> {
  const supabase = await createClient()
  if (!supabase) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  // RLS already limits organization_members to the caller's orgs, so this both authenticates the
  // caller and pins the answer to THIS org — an id from another workspace can never pass.
  if (!(await userHasOrgRole(supabase, orgId, user.id, ['owner', 'admin']))) return null

  const admin = requireAdminClient()
  const [{ data: sc, error: scError }, { data: dc, error: dcError }, { data: members, error: memError }] =
    await Promise.all([
      admin.from('org_slack_config').select('webhook_url').eq('org_id', orgId).limit(1),
      admin
        .from('notification_channels')
        .select('target')
        .eq('org_id', orgId)
        .eq('provider', 'discord')
        .eq('enabled', true)
        .is('deleted_at', null)
        .limit(1),
      admin
        .from('organization_members')
        .select('user_id, role, email_alert_opt_out, profiles(email)')
        .eq('org_id', orgId)
        .in('role', ['owner', 'admin']),
    ])
  // an empty field here reads as "no webhook configured" — same false all-clear, so it throws
  assertReadable('slack webhook config', scError)
  assertReadable('discord webhook config', dcError)
  assertReadable('notification recipients', memError)
  type Mem = { user_id: string; role: string; email_alert_opt_out: boolean | null; profiles: { email: string | null } | null }
  const emailRecipients: EmailRecipientSummary[] = ((members ?? []) as unknown as Mem[])
    .filter((m) => Boolean(m.profiles?.email))
    .map((m) => ({ userId: m.user_id, email: m.profiles?.email ?? '', role: m.role, optedOut: Boolean(m.email_alert_opt_out) }))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'owner' ? -1 : 1))

  const cfg: NotificationConfig = {
    slackWebhook: (sc?.[0] as { webhook_url: string } | undefined)?.webhook_url ?? null,
    discordWebhook: (dc?.[0] as { target: string } | undefined)?.target ?? null,
    slackConnected: false,
    slackChannels: [],
    selectedSlackChannel: null,
    emailRecipients,
  }

  // Slack BOT channel picker: if a workspace is connected, list its channels and read the
  // currently-selected alert channel. The whole block is guarded — a vault/KEK fault or a Slack API
  // failure must degrade the picker, never 500 the settings page.
  try {
    const { data: conn } = await admin
      .from('provider_connections')
      .select('id')
      .eq('org_id', orgId)
      .eq('provider', 'slack')
      .eq('status', 'active')
      .is('deleted_at', null)
      .limit(1)
    const connectionId = (conn?.[0] as { id: string } | undefined)?.id
    if (connectionId) {
      cfg.slackConnected = true
      const { data: nc } = await admin
        .from('notification_channels')
        .select('target, label')
        .eq('org_id', orgId)
        .eq('provider', 'slack')
        .eq('enabled', true)
        .is('deleted_at', null)
        .limit(1)
      const ncRow = nc?.[0] as { target: string; label: string | null } | undefined
      cfg.selectedSlackChannel = ncRow?.target ?? null
      const { botTokenForConnection } = await import('@/lib/slack-app/token')
      const { listConversations } = await import('@/lib/slack-app/client')
      const token = await botTokenForConnection(connectionId)
      if (token) cfg.slackChannels = await listConversations(token)
      // conversations.list is paginated/rate-limited — make sure the SAVED channel is always
      // selectable even when it's missing from the first page (or the list call failed).
      if (cfg.selectedSlackChannel && !cfg.slackChannels.some((c) => c.id === cfg.selectedSlackChannel)) {
        cfg.slackChannels = [{ id: cfg.selectedSlackChannel, name: ncRow?.label ?? cfg.selectedSlackChannel }, ...cfg.slackChannels]
      }
    }
  } catch (e) {
    console.error('[notifications] slack channel picker load failed:', e)
  }
  return cfg
}

/**
 * A goal → monitor draft persisted on its drafting run (`agent_runs.result.monitor_draft`), for
 * `/app/monitors?draft=<runId>` and for the composer when the live stream ended before the draft
 * chunk arrived. RLS `agent_runs_sel` scopes it to the run's org members; null = no such draft.
 */
export async function getMonitorDraft(
  supabase: SupabaseClient,
  runId: string,
): Promise<{ runId: string; dataSourceId: string; draft: MonitorDraft } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null
  const { data, error } = await supabase.from('agent_runs').select('id, data_source_id, result').eq('id', runId).limit(1)
  if (error) return null
  const row = (data as { id: string; data_source_id: string | null; result: { monitor_draft?: unknown } | null }[] | null)?.[0]
  const draft = parseMonitorDraft(row?.result?.monitor_draft)
  if (!row || !row.data_source_id || !draft) return null
  return { runId: row.id, dataSourceId: row.data_source_id, draft }
}
