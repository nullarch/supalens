import { schedules } from '@trigger.dev/sdk'

import '../sentry'
import { requireAdminClient } from '@/utils/supabase/admin'
import { sweepPendingCallbacks } from '@/lib/proxy/callbacks'

/**
 * Proxy-gateway callback retry sweep. Immediate delivery happens inline with
 * webhook processing (lib/proxy/callbacks.ts); this cron re-sends anything still
 * pending (partner downtime, timeouts) with the ≥5-min backoff until the 8-attempt
 * cap. Deliveries are idempotent on the partner side (documented contract), so a
 * crash mid-sweep double-send is safe.
 */
export const proxyCallbacksCron = schedules.task({
  id: 'proxy-callbacks-cron',
  cron: '*/5 * * * *',
  machine: 'micro',
  maxDuration: 120,
  run: async () => {
    const admin = requireAdminClient()
    const { sent, failed } = await sweepPendingCallbacks(admin)
    if (sent || failed) console.log(`[proxy-callbacks] sent=${sent} failed=${failed}`)
    return { sent, failed }
  },
})
