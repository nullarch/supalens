// NOT `import 'server-only'` — runs on the Trigger.dev host (lifecycle sweep),
// same convention as lib/digest/generate.ts. Uses the untyped service-role admin
// client (lifecycle_email_log is service-role write, no client policy).
import type { createAdminClient } from '@/utils/supabase/admin'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/**
 * Claim the right to send one nudge, atomically. Inserts the ledger row with
 * `on conflict (user_id, dedupe_key) do nothing` — so a concurrent or retried
 * sweep that races on the same (user, nudge) loses and gets `false`. Only the
 * winner (a row came back) proceeds to actually send.
 *
 * Ordering the claim BEFORE the send means a send that errors afterwards is
 * "lost" (never retried) — acceptable for best-effort nudges, and strictly
 * preferable to double-sending.
 */
export async function claimSend(
  admin: Admin,
  args: { orgId: string; userId: string; kind: string; dedupeKey: string },
): Promise<boolean> {
  const { data, error } = await admin
    .from('lifecycle_email_log')
    .upsert(
      { org_id: args.orgId, user_id: args.userId, kind: args.kind, dedupe_key: args.dedupeKey },
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error('[lifecycle] claim failed:', error.message)
    return false // fail closed: a claim we can't record must not send (would re-send forever)
  }
  return (data?.length ?? 0) > 0
}

/** Release a claim (delete the ledger row) — used to roll back when the send fails hard. */
export async function releaseClaim(
  admin: Admin,
  args: { userId: string; dedupeKey: string },
): Promise<void> {
  const { error } = await admin
    .from('lifecycle_email_log')
    .delete()
    .eq('user_id', args.userId)
    .eq('dedupe_key', args.dedupeKey)
  if (error) console.error('[lifecycle] release failed:', error.message)
}

/** How many lifecycle emails this user has received in the last N days (frequency cap). */
export async function sentCountLastNDays(admin: Admin, userId: string, days: number): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { count } = await admin
    .from('lifecycle_email_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('sent_at', since)
  return count ?? 0
}
