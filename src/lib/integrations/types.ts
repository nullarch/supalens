// Pure types and helpers — safe to import from client components (no env, no server modules).

/** Which optional integrations this install has registered. Every one needs an app or account
 *  with an outside provider, so on a self-hosted install they are usually all off and the UI
 *  must not offer them. */
export interface IntegrationAvailability {
  /** "Connect Supabase" — Management API OAuth app. */
  supabaseConnect: boolean
  /** GitHub App — attach a repository for code-aware context. */
  github: boolean
  /** Slack app — bot channels and @mention answers (webhooks work without it). */
  slack: boolean
  /** An email transport (SMTP or Resend) for invitations, alerts and digests. */
  email: boolean
}

/** What a component sees when no provider is mounted (dev previews, tests): everything on. */
export const ALL_INTEGRATIONS: IntegrationAvailability = { supabaseConnect: true, github: true, slack: true, email: true }

/** Where "connect a database" goes: the OAuth round-trip when it exists, else the direct form. */
export function connectDatabaseHref(a: IntegrationAvailability, returnTo = '/app/setup'): string {
  return a.supabaseConnect
    ? `/api/connect-supabase/authorize?returnTo=${returnTo}`
    : '/app/sources?connect=postgres'
}
