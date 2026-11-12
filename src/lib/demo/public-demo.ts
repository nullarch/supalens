// NOT `import 'server-only'` — the maintenance prune task (Trigger.dev bundle) reads
// publicDemoOrgId() for the demo-run retention block (same convention as utils/supabase/admin.ts).
// Pure config + helpers only; the DB io lives in service.ts.
import { createHmac } from 'crypto'

import { isCloud } from '@/config/edition'

/** The platform-owned org that backs the anonymous /demo surface (no members — invisible to
 *  every user via RLS; service_role writes its runs). Unset → the public demo is inert. */
export function publicDemoOrgId(): string | null {
  const v = process.env.PUBLIC_DEMO_ORG_ID?.trim()
  return v || null
}

/** The public demo needs both the backing org AND the shared demo database. Hosted edition
 *  only — it is an anonymous LLM entry point. */
export function publicDemoConfigured(): boolean {
  return isCloud() && Boolean(publicDemoOrgId() && process.env.DEMO_DATABASE_URL)
}

/** Free-text cap — chips are short canonical strings, and 300 chars is plenty for a real
 *  question while keeping hostile prompt payloads small. */
export const DEMO_MAX_QUESTION_CHARS = 300

/** Cached answers stay servable this long (agent_runs IS the cache — see service.ts). */
export const DEMO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Anchor day of demo/seed.sql (`demo_data.meta.anchor`). The public demo views move the data
 *  forward in whole weeks from this UTC day, so answers stay true for one week at a time. */
export const DEMO_DATA_ANCHOR = '2026-09-17'

/** When the current demo dataset went live. Older cached answers describe the retired dataset. */
export const DEMO_DATA_RELEASED_AT = '2026-09-17T00:00:00Z'

const DAY_MS = 24 * 60 * 60 * 1000

/** UTC midnight that starts the week of data the demo views show at `now`
 *  (mirrors `floor((current_date - anchor) / 7) * 7` in the seed's window_shift view). */
export function demoDataWindowStart(now: Date): Date {
  const anchor = Date.parse(`${DEMO_DATA_ANCHOR}T00:00:00Z`)
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS
  const weeks = Math.floor((today - anchor) / (7 * DAY_MS))
  return new Date(anchor + weeks * 7 * DAY_MS)
}

/** Oldest creation time a cached demo answer may have: inside the TTL, the current data week and
 *  the current dataset. Anything older would quote numbers the demo database no longer shows. */
export function demoCacheCutoff(now: Date): Date {
  return new Date(Math.max(
    now.getTime() - DEMO_CACHE_TTL_MS,
    demoDataWindowStart(now).getTime(),
    Date.parse(DEMO_DATA_RELEASED_AT),
  ))
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** Live (non-cached) runs one visitor may start per 24h. */
export function demoRunsPerVisitorPerDay(): number {
  return intEnv('DEMO_RUNS_PER_VISITOR_PER_DAY', 5)
}

/** Global live-run budget per 24h. Deliberately below MAX_RUNS_PER_ORG_PER_DAY (200) so the
 *  public demo can never exhaust the org-level abuse cap on its own. */
export function demoMaxRunsPerDay(): number {
  return intEnv('DEMO_MAX_RUNS_PER_DAY', 150)
}

/** Concurrent live demo runs (queued+running). Above this the API answers `busy` and the UI
 *  steers visitors to the cached suggested questions. */
export function demoMaxInFlight(): number {
  return intEnv('DEMO_MAX_INFLIGHT', 4)
}

/**
 * Cache/dedupe key normalization: trim + collapse internal whitespace. Chips send canonical
 * strings so they always collide into one cached run; free text gets whitespace-insensitive
 * reuse. Deliberately NOT lowercased — SQL-relevant identifiers users type (table names,
 * 'KRW') read back verbatim in the transcript.
 */
export function normalizeDemoQuestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Privacy-preserving visitor key: HMAC(ip) with a server-side key, so the ledger never holds
 * raw IPs (7-day retention on top). Key falls back to the service-role key — it only needs to
 * be secret + stable across instances, never reversible.
 */
export function hashDemoIp(ip: string): string {
  const key = process.env.DEMO_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'supalens-demo'
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32)
}

/** First hop of x-forwarded-for (Vercel-appended), else x-real-ip, else a shared bucket. */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * Spread anonymous runs across N queue keys instead of the default concurrencyKey:
 * dataSourceId — one shared demo source would otherwise serialize every public run behind a
 * single key (the analyze queue allows 2 per key). Total parallelism is still bounded by the
 * in-flight cap above, so buckets only remove the single-file line, not the ceiling.
 */
export function demoConcurrencyKey(seed: string, buckets = 4): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return `demo-${Math.abs(h) % Math.max(1, buckets)}`
}
