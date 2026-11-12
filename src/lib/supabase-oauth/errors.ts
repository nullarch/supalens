/**
 * Stable, user-safe codes persisted in place of raw exception text.
 *
 * Raw `Error.message` must never reach a persisted column (`alerts.last_error`,
 * `data_source_context.error`, `kpi_extractions.error`): those columns ARE rendered in the
 * product, so an internal string like
 *   "Supabase connection 11111111-… requires reconnect (revoked)."
 * becomes UI copy — untranslated, unactionable, and leaking an internal id. Persist a code
 * from here instead and let the screen render it through the message catalog.
 *
 * Deliberately import-free so a client component can import the constant without dragging the
 * admin client (and its service-role key) into the browser bundle. The typed guard for the
 * error CLASS lives in `tokens.ts`, next to the class itself.
 */

/** The OAuth grant is gone (revoked upstream, or a reuse was detected). The user must re-authorize. */
export const RECONNECT_REQUIRED = 'reconnect_required'

export type ConnectionErrorCode = typeof RECONNECT_REQUIRED

export function isConnectionErrorCode(value: string | null | undefined): value is ConnectionErrorCode {
  return value === RECONNECT_REQUIRED
}

/**
 * Recognize a reconnect fault WITHOUT importing the class — `instanceof` is unreliable here
 * because `tokens.ts` is bundled twice (Next's webpack build and the Trigger.dev esbuild
 * bundle), so an error thrown in one realm fails `instanceof` in the other. The `name`
 * discriminator is set in the constructor and survives both bundles and a structured clone.
 *
 * This checks the error's NAME, never its message — message text is free to change.
 */
export function isReconnectRequiredError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'ReconnectRequiredError'
  )
}

/**
 * Turn a caught error into something safe to store in a rendered column: the stable code when
 * it is a reconnect fault, otherwise the caller's own (already-bounded) fallback text.
 *
 * The raw pass-through is DELIBERATE: a genuine query/driver message ("relation \"orders\" does
 * not exist", a statement timeout) is the whole diagnostic value for a user debugging their own
 * SQL. Only faults the product itself understands become codes — the full set persisted into
 * `alerts.last_error` lives in `src/lib/alerts/error-codes.ts`, which includes this one.
 */
export function persistableError(err: unknown, fallback: string): string {
  return isReconnectRequiredError(err) ? RECONNECT_REQUIRED : fallback
}
