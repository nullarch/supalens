import { schedules, task } from '@trigger.dev/sdk'

import './sentry'
import { runOrgWeeklyDigest, digestOrgTargets, type OrgDigestTarget } from '@/lib/digest/generate'

/**
 * Weekly AI digest (an opt-in paid-plan feature).
 *  - `weekly-digest-cron` (scheduled): discovers OPTED-IN paid orgs and fans out one child run
 *    per ORG (was per data source — that granularity sent one email per source, an inbox bomb
 *    for many-source orgs). `concurrencyKey: orgId` isolates each tenant.
 *  - `weekly-digest-org`: summarizes the last 7 days for each of the org's (capped) sources and
 *    sends ONE consolidated email to the org owner/admins. Retries OFF — it sends email, so a
 *    retry would double-send.
 */

export const weeklyDigestForOrgTask = task({
  id: 'weekly-digest-org',
  machine: 'medium-1x', // agent session + claude subprocess, run once per source in-process
  // up to MAX_DIGEST_SOURCES agent sessions run SEQUENTIALLY in one org run (was one source
  // per child at 900s each) — budget accordingly. Matches the analyze task's ceiling.
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 },
  retry: { maxAttempts: 1 },
  run: async (payload: OrgDigestTarget) => {
    return runOrgWeeklyDigest(payload)
  },
})

export const weeklyDigestCron = schedules.task({
  id: 'weekly-digest-cron',
  cron: '0 8 * * 1', // Monday 08:00 UTC
  run: async () => {
    const targets = await digestOrgTargets()
    if (targets.length === 0) return { fannedOut: 0 }
    await weeklyDigestForOrgTask.batchTrigger(
      targets.map((t) => ({ payload: t, options: { concurrencyKey: t.orgId } })),
    )
    return { fannedOut: targets.length }
  },
})
