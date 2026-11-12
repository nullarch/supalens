// Shared open-redirect guard for OAuth `returnTo` params. Single source of truth for the
// Supabase / GitHub / Slack connect flows (each re-exports this) so a future bypass fix lands
// once, not three times. NOT `import 'server-only'` — the github/slack config modules that
// re-export it are shared with the Trigger runtime; this is a pure string predicate anyway.

/**
 * Only same-origin, path-only redirect targets are allowed. Rejects protocol-relative
 * (`//evil.com`) and backslash (`/\evil.com`) forms that `new URL()` resolves off-origin.
 */
export function isSafeReturnTo(path: string | null | undefined): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\')
  )
}
