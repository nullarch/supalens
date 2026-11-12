/**
 * Organization display timezone.
 *
 * `organizations.timezone` (migration 20260904141000_org_timezone.sql, default 'UTC') is the
 * one declared zone for rendering a workspace's operator timestamps.
 *
 * NOT `import 'server-only'` — the Trigger.dev host formats the same timestamps in alert and
 * digest emails, and its bundler does not alias `server-only` to a no-op (see the convention
 * comment in `src/utils/supabase/admin.ts`).
 *
 * ADOPTED (2026-09-05) by every monitor/incident surface: the server page reads the zone once
 * (`readOrgTimezone` / `getOrgTimezone`) and threads it down as a `timezone` prop, and the leaf
 * formats with `formatInOrgTz` — MonitorsManager, monitors/[id], IncidentsTable,
 * IncidentDetailView, IncidentTriage, and `alerts/incidents.ts::followUpQuestion` (which also
 * labels the offset instead of hardcoding UTC).
 *
 * STILL PENDING: email bodies (`src/lib/email/*`) format numbers per locale but not yet dates per
 * zone, and the digest/notification texts built on the Trigger host.
 */

/**
 * Zones offered first in the picker. Not a whitelist — every zone the runtime knows is
 * selectable; these are simply the ones this product's users pick most.
 */
export const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
] as const

export const DEFAULT_TIMEZONE = 'UTC'

/**
 * Every zone this runtime knows. `Intl.supportedValuesOf` is Node 18+/modern-browser only, so
 * a runtime without it degrades to the common list rather than rejecting every zone.
 */
export function supportedTimezones(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone')
    if (supported && supported.length > 0) return supported as string[]
  } catch {
    // fall through to the static list
  }
  return [...COMMON_TIMEZONES]
}

/**
 * True when `tz` is a zone this runtime can actually format with. Checked against the runtime
 * itself (not a regex) so a well-shaped but non-existent zone like `Asia/Atlantis` is rejected
 * before it reaches the DB.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Coerce anything to a usable zone, falling back to UTC. */
export function normalizeTimezone(tz: unknown): string {
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE
}

/**
 * The picker's option order: common zones first, then everything else alphabetically.
 * The common list is gated on `isValidTimezone`, NOT on membership in
 * `supportedTimezones()` — 'UTC' formats fine but is absent from the runtime's canonical
 * list, and dropping the default zone from its own picker would be a bug.
 */
export function timezoneOptions(): string[] {
  const common = COMMON_TIMEZONES.filter(isValidTimezone)
  const seen = new Set<string>(common)
  const rest = supportedTimezones()
    .filter((z) => !seen.has(z))
    .sort((a, b) => a.localeCompare(b))
  return [...common, ...rest]
}

/**
 * "Asia/Seoul (UTC+09:00)" — the label shown in the picker. The offset is computed for `at`
 * (default: now) so a DST zone reads correctly for the current part of the year.
 */
export function timezoneLabel(tz: string, at: Date = new Date()): string {
  const offset = utcOffsetLabel(tz, at)
  return offset ? `${tz} (${offset})` : tz
}

/** `UTC+09:00` / `UTC-04:00` / `UTC` for the given zone at the given instant; '' when invalid. */
export function utcOffsetLabel(tz: string, at: Date = new Date()): string {
  if (!isValidTimezone(tz)) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    // longOffset yields "GMT+09:00"; at zero offset it is plain "GMT" or "GMT+00:00" depending on
    // the runtime's ICU version — restate either as bare UTC.
    if (!name) return ''
    return /^GMT(?:[+-]00:00)?$/.test(name) ? 'UTC' : name.replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

/**
 * Render an ISO timestamp in the org's zone. Returns '' for a missing/unparsable input so a
 * caller can render a dash without a try/catch of its own; an unknown zone falls back to UTC
 * rather than throwing.
 */
export function formatInOrgTz(
  iso: string | null | undefined,
  tz: string,
  locale = 'en-US',
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: normalizeTimezone(tz) }).format(d)
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: DEFAULT_TIMEZONE }).format(d)
  }
}

/**
 * Postgres error code for "column does not exist". The timezone column ships in a migration
 * that may not be applied yet, so every read/write path treats 42703 as "feature not live"
 * instead of an error — the repo's fail-open-before-migration convention (see checkUsageQuota).
 */
export const UNDEFINED_COLUMN = '42703'

export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  return e.code === UNDEFINED_COLUMN || Boolean(e.message?.includes('column') && e.message?.includes('timezone'))
}

type Client = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
}

/**
 * The org's timezone plus whether the column exists yet. Read on its OWN query rather than
 * joining `timezone` into a caller's existing select: before the migration lands, adding the
 * column to a combined select would fail the WHOLE query and blank out the org name too.
 *
 * Takes a client rather than creating one so it works with both the user-JWT client (/app
 * pages) and the service-role admin client (Trigger crons). Never throws.
 */
export async function readOrgTimezone(
  client: Client,
  orgId: string,
): Promise<{ timezone: string; pendingMigration: boolean }> {
  try {
    const { data, error } = await client.from('organizations').select('timezone').eq('id', orgId).limit(1)
    if (error) {
      return { timezone: DEFAULT_TIMEZONE, pendingMigration: isMissingColumnError(error) }
    }
    const row = (data as { timezone?: string | null }[] | null)?.[0]
    return { timezone: normalizeTimezone(row?.timezone), pendingMigration: false }
  } catch {
    return { timezone: DEFAULT_TIMEZONE, pendingMigration: false }
  }
}

/**
 * The org's timezone, or 'UTC'. Never throws: an unapplied migration, an RLS miss, or a
 * network blip all degrade to UTC.
 */
export async function getOrgTimezone(client: Client, orgId: string): Promise<string> {
  return (await readOrgTimezone(client, orgId)).timezone
}
