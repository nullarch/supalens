import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingColumnError } from '@/lib/agent/run-channel'
import { deriveIncidents, type Incident, type IncidentAlertRow, type IncidentEventRow } from './incidents'

/**
 * The io shell around the pure incident model (./incidents.ts). Reads through the USER-JWT client so
 * `alert_events_sel` / `alerts_sel` scope everything to the caller's orgs — an incident id from
 * another tenant simply resolves to nothing.
 *
 * Fail-open before the migration, and ONLY for that: the ack/feedback columns ship in
 * `*_incident_ack.sql`, so every read asks for them first and degrades to the base columns when
 * PostgREST reports an undefined column (42703), reporting `ackReady: false` so the UI hides the
 * triage controls instead of the page 500-ing. Same convention as checkUsageQuota's
 * unmigrated-billing path.
 *
 * ANY OTHER read failure (RLS, a dropped connection, a timeout) THROWS. This screen's empty state
 * reads "no incidents" — an all-clear — so swallowing an error here would tell an operator their
 * monitors are quiet when in fact we could not look. A thrown error hits the /app error boundary,
 * which is honest.
 */

const BASE_EVENT_COLUMNS = 'id, alert_id, kind, value, message, explanation, explained, notified, created_at'
const ACK_EVENT_COLUMNS = `${BASE_EVENT_COLUMNS}, acknowledged_at, acknowledged_by, ack_kind, cause_feedback, cause_correction`

const ALERT_COLUMNS = 'id, name, type, operator, threshold, sensitivity, fire_threshold, data_source_id, data_sources(name)'

/** Errors here cross a Server Component boundary, so hand the boundary a real Error. */
function readFailed(context: string, err: unknown): Error {
  if (err instanceof Error) return err
  const e = (err ?? {}) as { message?: unknown; code?: unknown; details?: unknown }
  const message = typeof e.message === 'string' ? e.message : 'read failed'
  return Object.assign(new Error(`[incidents] ${context}: ${message}`), { code: e.code, details: e.details })
}

/**
 * Run `query(ACK_EVENT_COLUMNS)`, falling back to the base columns on an unapplied ack migration.
 * Returns the rows plus whether the ack columns exist. Throws on every other fault.
 */
async function readEvents(
  context: string,
  query: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: IncidentEventRow[]; ackReady: boolean }> {
  const first = await query(ACK_EVENT_COLUMNS)
  if (!first.error) return { rows: (first.data ?? []) as IncidentEventRow[], ackReady: true }
  if (!isMissingColumnError(first.error)) throw readFailed(context, first.error)

  const retry = await query(BASE_EVENT_COLUMNS)
  // The retry drops the columns 42703 complained about, so an error HERE is a different fault —
  // never a second degrade. Discarding it was what turned any read failure into a false all-clear.
  if (retry.error) throw readFailed(`${context} (base columns)`, retry.error)
  return { rows: (retry.data ?? []) as IncidentEventRow[], ackReady: false }
}

type AlertJoinRow = {
  id: string
  name: string
  type: string
  operator: string
  threshold: number
  sensitivity: number | null
  fire_threshold: number | null
  data_source_id: string
  data_sources: { name: string | null } | null
  condition?: unknown
}

function toAlertRow(r: AlertJoinRow): IncidentAlertRow {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    operator: r.operator,
    threshold: r.threshold,
    sensitivity: r.sensitivity,
    fire_threshold: r.fire_threshold,
    data_source_id: r.data_source_id,
    data_source_name: r.data_sources?.name ?? null,
    condition: r.condition ?? null,
  }
}

async function alertsById(supabase: SupabaseClient, ids: string[]): Promise<Map<string, IncidentAlertRow>> {
  const map = new Map<string, IncidentAlertRow>()
  if (ids.length === 0) return map
  // goal monitors' `condition` (20260927110005) is read only while the migration is live
  const read = (cols: string): PromiseLike<{ data: unknown; error: unknown }> =>
    supabase.from('alerts').select(cols).in('id', ids).is('deleted_at', null)
  const first = await read(`${ALERT_COLUMNS}, condition`)
  const { data } = first.error && isMissingColumnError(first.error) ? await read(ALERT_COLUMNS) : first
  for (const r of (data ?? []) as unknown as AlertJoinRow[]) map.set(r.id, toAlertRow(r))
  return map
}

export interface IncidentsResult {
  incidents: Incident[]
  /** false when `*_incident_ack.sql` has not been applied yet — the UI hides ack/feedback/snooze. */
  ackReady: boolean
}

/**
 * Every incident in the org's recent history, newest first. `limit` bounds the EVENT scan, not the
 * incident count: pairing a fired event with its resolve needs both rows, so the window is read
 * whole and the model does the pairing.
 */
export async function listIncidents(supabase: SupabaseClient, orgId: string, limit = 400): Promise<IncidentsResult> {
  const { rows, ackReady } = await readEvents('listIncidents', (columns) =>
    supabase
      .from('alert_events')
      .select(columns)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  if (rows.length === 0) return { incidents: [], ackReady }

  const alerts = await alertsById(supabase, [...new Set(rows.map((r) => r.alert_id))])
  return { incidents: deriveIncidents(rows, alerts, Date.now()), ackReady }
}

export interface OneIncidentResult {
  incident: Incident | null
  ackReady: boolean
  /** the monitor behind it — the detail page shows its definition + settings */
  alert: IncidentAlertRow | null
  /** consecutive_fires configured on the monitor, for the timeline's "re-confirmed" step */
  cooldownSeconds: number | null
  metricSql: string | null
  description: string | null
  enabled: boolean
  snoozedUntil: string | null
}

/**
 * One incident by its FIRED event id. Reads the whole event history of that monitor so the pairing
 * (and therefore the resolved/duration fields) matches what the list shows.
 */
export async function getIncident(supabase: SupabaseClient, eventId: string): Promise<OneIncidentResult> {
  const empty: OneIncidentResult = {
    incident: null,
    ackReady: true,
    alert: null,
    cooldownSeconds: null,
    metricSql: null,
    description: null,
    enabled: true,
    snoozedUntil: null,
  }

  const { data: head, error: headErr } = await supabase
    .from('alert_events')
    .select('id, alert_id, kind')
    .eq('id', eventId)
    .limit(1)
  // Same rule as readEvents: a failed lookup is not "no such incident". Only an EMPTY result is.
  if (headErr) throw readFailed('getIncident head', headErr)
  const row = head?.[0] as { id: string; alert_id: string; kind: string } | undefined
  if (!row || row.kind !== 'fired') return empty

  const { rows: events, ackReady } = await readEvents('getIncident', (columns) =>
    supabase
      .from('alert_events')
      .select(columns)
      .eq('alert_id', row.alert_id)
      .order('created_at', { ascending: false })
      .limit(200),
  )

  const alerts = await alertsById(supabase, [row.alert_id])
  const alert = alerts.get(row.alert_id) ?? null
  if (!alert) return { ...empty, ackReady }

  const incident = deriveIncidents(events, alerts, Date.now()).find((i) => i.id === eventId) ?? null

  // Extra monitor fields the detail page shows. `snoozed_until` is asked for separately so an
  // unapplied migration can't take the whole row down with it.
  const { data: extra } = await supabase
    .from('alerts')
    .select('metric_sql, description, cooldown_seconds, enabled')
    .eq('id', row.alert_id)
    .limit(1)
  const ex = extra?.[0] as
    | { metric_sql: string; description: string | null; cooldown_seconds: number | null; enabled: boolean }
    | undefined

  let snoozedUntil: string | null = null
  const { data: sn, error: snErr } = await supabase.from('alerts').select('snoozed_until').eq('id', row.alert_id).limit(1)
  if (!snErr) snoozedUntil = (sn?.[0] as { snoozed_until: string | null } | undefined)?.snoozed_until ?? null

  return {
    incident,
    ackReady,
    alert,
    cooldownSeconds: ex?.cooldown_seconds ?? null,
    metricSql: ex?.metric_sql ?? null,
    description: ex?.description ?? null,
    enabled: ex?.enabled ?? true,
    snoozedUntil,
  }
}
