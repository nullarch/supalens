import { schedules } from '@trigger.dev/sdk'

import './sentry'
import { runMaintenance } from '@/lib/maintenance/prune'

/**
 * Nightly retention prune + stuck-run reaper (see src/lib/maintenance/prune.ts).
 * Idempotent (pure deletes/updates against time cutoffs), so retries are safe.
 */
export const maintenanceCron = schedules.task({
  id: 'maintenance-cron',
  cron: '20 18 * * *', // 03:20 KST daily, off the peak hours
  machine: 'micro',
  maxDuration: 600,
  run: async () => runMaintenance(),
})
