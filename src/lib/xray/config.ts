// NOT server-only — pure env config, read by the BFF route and the pages.
//
// X-ray is an ANONYMOUS LLM entry point. It has no org, so the per-org gate (checkUsageQuota)
// cannot apply; these limits are its equivalent and every one of them fails CLOSED in the API:
// a per-visitor window, a global daily budget (the cost ceiling) and an in-flight cap.

import { isCloud } from '@/config/edition'

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** Live scans need the Trigger worker and the service-role client. Hosted edition only: on a
 *  self-hosted install this would be an anonymous endpoint spending the operator's LLM key. */
export function xrayConfigured(): boolean {
  return isCloud() && Boolean(process.env.TRIGGER_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/** Live (non-cached) scans one visitor may start per 24h. */
export function xrayScansPerVisitorPerDay(): number {
  return intEnv('XRAY_SCANS_PER_VISITOR_PER_DAY', 3)
}

/** Global live-scan budget per 24h — the cost ceiling of the whole surface. */
export function xrayMaxScansPerDay(): number {
  return intEnv('XRAY_MAX_SCANS_PER_DAY', 60)
}

/** Concurrent scans (queued + running). Above it the visitor waits in line. */
export function xrayMaxInFlight(): number {
  return intEnv('XRAY_MAX_INFLIGHT', 4)
}

/** Repositories above this size (GitHub `size`, KB) are refused before any clone. */
export function xrayMaxRepoKb(): number {
  return intEnv('XRAY_MAX_REPO_KB', 250_000)
}

/** A queued/running scan older than this is dead (the task's maxDuration is 15 min). */
export const XRAY_STALE_MS = 20 * 60 * 1000

/** Agent budget per scan. */
export const XRAY_MAX_TURNS = 45
export const XRAY_MAX_TOTAL_TOKENS = 900_000
