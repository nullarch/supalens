// NOTE: intentionally NOT `import 'server-only'` — runnable from an ops script
// (scripts/rotate-kek.ts) or a one-off Trigger run, same convention as kek.ts.
import { requireAdminClient } from '@/utils/supabase/admin'
import { getKekProvider } from './kek'

/**
 * KEK rotation, phase 2: re-wrap every DEK under the CURRENT KEK.
 *
 * Rotation runbook (local provider):
 *   1. Set KEK_LOCAL_MASTER_KEY = <new key>, KEK_LOCAL_MASTER_KEY_PREVIOUS = <old key>
 *      on BOTH runtimes (Vercel + Trigger) and redeploy — unwrap now falls back to
 *      the old key, so nothing breaks while ciphertexts are mixed.
 *   2. Run this (npx tsx scripts/rotate-kek.ts) — every wrapped_dek is unwrapped
 *      (falling back to the previous key) and re-wrapped with the new key.
 *   3. Remove KEK_LOCAL_MASTER_KEY_PREVIOUS and redeploy.
 * For gcp_kms, KMS versioning handles old ciphertexts natively — this is only
 * needed when switching to a NEW key resource (update KEK_GCP_KEY first).
 *
 * Idempotent: re-wrapping an already-current DEK is a harmless rewrite.
 */
export interface RewrapReport {
  total: number
  rewrapped: number
  failed: Array<{ dekId: string; error: string }>
}

export async function rewrapAllDeks(): Promise<RewrapReport> {
  const admin = requireAdminClient()
  const kek = getKekProvider()
  const report: RewrapReport = { total: 0, rewrapped: 0, failed: [] }

  const { data, error } = await admin
    .from('data_encryption_keys')
    .select('id, wrapped_dek, state')
    .neq('state', 'destroyed')
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; wrapped_dek: string }>
  report.total = rows.length

  for (const row of rows) {
    try {
      const plain = await kek.unwrap(row.wrapped_dek)
      const rewrapped = await kek.wrap(plain)
      plain.fill(0) // drop the plaintext DEK from memory promptly
      const { error: upErr } = await admin
        .from('data_encryption_keys')
        .update({
          wrapped_dek: rewrapped,
          kek_provider: kek.name,
          kek_uri: kek.kekUri,
          rotated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (upErr) throw upErr
      report.rewrapped += 1
    } catch (e) {
      report.failed.push({ dekId: row.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return report
}
