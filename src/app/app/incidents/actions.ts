'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { userHasOrgRole } from '@/lib/org/require-role'
import { isCauseFeedback, type AckKind, type CauseFeedback } from '@/lib/alerts/incidents'
import type { ActionResult } from '@/lib/dashboards/types'

/**
 * Incident triage writes. `alert_events` is member-READ / service_role-write under RLS (the runner
 * owns the audit trail), so each action verifies membership with the USER-JWT client first — RLS
 * only returns the caller's own-org rows, and `userHasOrgRole` then excludes viewers, matching
 * `alerts_write` — and only then writes with the admin client.
 *
 * Every write targets the ack/feedback/snooze columns from `*_incident_ack.sql`. Before that
 * migration is applied the UI hides these controls entirely (incidents-server.ts probes), and a
 * stray call degrades to a plain error instead of a crash.
 */

/** the detail route, which did not move — the deep links in email/Slack/Discord point at it */
const INCIDENTS_PATH = '/app/incidents'
/** the queue, which is now the 감시 screen's second view (see app/app/monitors/view.ts) */
const QUEUE_PATH = '/app/monitors'
const WRITER_ROLES = ['owner', 'admin', 'member'] as const

type Guard =
  | { ok: true; orgId: string; alertId: string; userId: string }
  | { ok: false; result: ActionResult<never> }

/** Resolve the incident's org through RLS + role-gate the caller. */
async function guardEvent(eventId: string): Promise<Guard> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, result: { ok: false, reason: 'unconfigured' } }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, result: { ok: false, reason: 'unauthorized' } }

  // RLS (`alert_events_sel`) already limits this to orgs the caller belongs to.
  const { data } = await supabase.from('alert_events').select('org_id, alert_id').eq('id', eventId).limit(1)
  const row = data?.[0] as { org_id: string; alert_id: string } | undefined
  if (!row) return { ok: false, result: { ok: false, reason: 'not_found' } }

  if (!(await userHasOrgRole(supabase, row.org_id, user.id, [...WRITER_ROLES]))) {
    const t = await getTranslations('appIncidents')
    return { ok: false, result: { ok: false, reason: 'error', message: t('actions.memberOnly') } }
  }
  return { ok: true, orgId: row.org_id, alertId: row.alert_id, userId: user.id }
}

async function failure(e: unknown): Promise<ActionResult<never>> {
  const t = await getTranslations('appIncidents')
  console.error('[incidents] write failed:', e)
  return { ok: false, reason: 'error', message: t('actions.migrationPending') }
}

/** Acknowledge an incident, or mark it expected. `null` clears the acknowledgement. */
export async function setIncidentAck(eventId: string, kind: AckKind | null): Promise<ActionResult<void>> {
  const g = await guardEvent(eventId)
  if (!g.ok) return g.result
  if (kind !== null && kind !== 'ack' && kind !== 'expected') {
    return { ok: false, reason: 'error', message: (await getTranslations('appIncidents'))('actions.invalid') }
  }

  const { error } = await requireAdminClient()
    .from('alert_events')
    .update(
      kind === null
        ? { acknowledged_at: null, acknowledged_by: null, ack_kind: null }
        : { acknowledged_at: new Date().toISOString(), acknowledged_by: g.userId, ack_kind: kind },
    )
    .eq('id', eventId)
  if (error) return failure(error)

  revalidatePath(QUEUE_PATH)
  revalidatePath(`${INCIDENTS_PATH}/${eventId}`)
  return { ok: true, data: undefined }
}

/** Record whether the AI's probable cause was right, with an optional correction. */
export async function setIncidentFeedback(
  eventId: string,
  value: CauseFeedback,
  correction?: string,
): Promise<ActionResult<void>> {
  const g = await guardEvent(eventId)
  if (!g.ok) return g.result
  if (!isCauseFeedback(value)) {
    return { ok: false, reason: 'error', message: (await getTranslations('appIncidents'))('actions.invalid') }
  }

  const { error } = await requireAdminClient()
    .from('alert_events')
    .update({ cause_feedback: value, cause_correction: correction?.trim() ? correction.trim().slice(0, 2000) : null })
    .eq('id', eventId)
  if (error) return failure(error)

  revalidatePath(`${INCIDENTS_PATH}/${eventId}`)
  return { ok: true, data: undefined }
}

/**
 * Mute the incident's monitor for `hours` (0 lifts the snooze). The runner skips snoozed monitors
 * on its next sweep; the monitor itself stays enabled, so this is a pause with an expiry rather
 * than a disable an operator has to remember to undo.
 */
export async function snoozeIncidentMonitor(eventId: string, hours: number): Promise<ActionResult<void>> {
  const g = await guardEvent(eventId)
  if (!g.ok) return g.result
  if (!Number.isFinite(hours) || hours < 0 || hours > 720) {
    return { ok: false, reason: 'error', message: (await getTranslations('appIncidents'))('actions.invalid') }
  }

  const until = hours > 0 ? new Date(Date.now() + hours * 3_600_000).toISOString() : null
  const { error } = await requireAdminClient().from('alerts').update({ snoozed_until: until }).eq('id', g.alertId)
  if (error) return failure(error)

  revalidatePath(`${INCIDENTS_PATH}/${eventId}`)
  revalidatePath(QUEUE_PATH)
  return { ok: true, data: undefined }
}
