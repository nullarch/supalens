/**
 * How the monitor screens RENDER `alerts.last_error`.
 *
 * The codes themselves are owned by `@/lib/alerts/error-codes` (the runner writes them); this
 * module only holds the two presentation decisions the screens share:
 *   1. which codes have a sentence in the catalog, and
 *   2. how much raw driver text a row may show.
 *
 * Anything that is NOT a known code is a genuine query/driver message, kept verbatim on purpose —
 * it is the whole diagnostic value for someone debugging their own SQL — and rendered under a
 * generic "Check failed:" label, in mono, clipped.
 */
import { isAlertErrorCode, type AlertErrorCode } from '@/lib/alerts/error-codes'

/** The codes that have a sentence under `appMonitors.errors.*`. */
export type LabelledAlertErrorCode = Exclude<AlertErrorCode, 'reconnect_required'>

/**
 * True only for codes the catalog can label. `reconnect_required` is excluded because it renders
 * through its OWN branch (`row.reconnect` + the re-authorize link — a dead grant carries a fix, not
 * just a fault); asking next-intl for `errors.reconnect_required` would throw MISSING_MESSAGE, so
 * the exclusion lives here rather than depending on the caller's branch order.
 */
export function isLabelledAlertErrorCode(value: string | null | undefined): value is LabelledAlertErrorCode {
  return isAlertErrorCode(value) && value !== 'reconnect_required'
}

/** Raw driver text can be a whole stack of SQL — show enough to recognize it, not enough to shout. */
export const RAW_ERROR_MAX = 140

export function truncateError(raw: string, max = RAW_ERROR_MAX): string {
  const one = raw.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
