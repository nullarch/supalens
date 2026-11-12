import { schedules } from '@trigger.dev/sdk'

import './sentry'
import { processPendingRevocations } from '@/lib/supabase-oauth/revocations'

/**
 * Credential-revocation outbox drain (docs/agent-implementation-plan.md Phase 6).
 * disconnectSupabase enqueues a pending row whenever an upstream revoke (minted
 * supalens_ro role drop / OAuth grant revoke) fails; this cron retries them until
 * done or MAX_ATTEMPTS. Idempotent per row (status flips before secrets are
 * finally revoked), so retries are safe.
 */
export const processRevocationsCron = schedules.task({
  id: 'process-revocations-cron',
  cron: '*/15 * * * *',
  machine: 'micro',
  maxDuration: 300,
  run: async () => processPendingRevocations(),
})
