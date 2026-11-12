import { task } from '@trigger.dev/sdk'

import './sentry'
import { bootstrapConnectionProjects } from '@/lib/supabase-oauth/bootstrap-projects'

interface BootstrapPayload {
  orgId: string
  userId: string
  connectionId: string
  /** Restrict provisioning to these project refs (the user's pick). Omit to provision all. */
  projectRefs?: string[]
}

/**
 * Provision the data sources for a freshly-connected Supabase account: list projects → per
 * ACTIVE project create a data_source, mint the read-only role, store its password. Split off
 * the OAuth callback (which now only stores the refresh token + redirects) because each mint
 * runs SQL against a tenant DB in its own region — doing it inline made "Authorize" hang.
 *
 * The token is minted HERE on the host from the stored refresh token (never in the payload).
 * Retries are OFF (trigger.config default maxAttempts:1) — a re-run is de-duped per project by
 * `bootstrapConnectionProjects` (existing sources are skipped), so it wouldn't double-mint, but
 * we still avoid a full re-list on transient faults.
 */
export const bootstrapSupabaseProjects = task({
  id: 'bootstrap-supabase-projects',
  machine: 'small-1x',
  maxDuration: 600,
  queue: { concurrencyLimit: 5 }, // bound the fan-out (BFF passes concurrencyKey: connectionId)
  run: async (payload: BootstrapPayload) => {
    return bootstrapConnectionProjects({
      orgId: payload.orgId,
      userId: payload.userId,
      connectionId: payload.connectionId,
      projectRefs: payload.projectRefs,
    })
  },
})
