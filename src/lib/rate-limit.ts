// NOTE: intentionally NOT `import 'server-only'` — pure in-memory utility, testable
// under vitest and usable from any runtime.

/**
 * In-memory sliding-window rate limiter (per serverless instance). Best-effort by
 * design: Vercel instances don't share state, so this is an abuse *dampener* — it
 * turns an unthrottled endpoint into one a single client can't hammer thousands of
 * times per minute through one warm instance. Good enough for the OAuth/DCR/MCP
 * surfaces; upgrade to a shared store (Upstash/Postgres) if real limits are needed.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 10_000 // memory backstop; oldest-window entries get dropped opportunistically

export interface RateLimitResult {
  allowed: boolean
  /** seconds until the window resets (for Retry-After) */
  retryAfterSec: number
}

/** Consume one hit for `key`. Allows `limit` hits per `windowMs` window. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k)
        if (buckets.size < MAX_KEYS) break
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSec: 0 }
  }
  b.count += 1
  if (b.count <= limit) return { allowed: true, retryAfterSec: 0 }
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
}

/** Best-effort client IP for keying (x-forwarded-for is set by Vercel's proxy). */
export function clientIpOf(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : 'unknown'
}

/** Standard 429 response with Retry-After. */
export function tooManyRequests(retryAfterSec: number, headers: Record<string, string> = {}): Response {
  // English on purpose: error_description is an OAuth/API protocol field consumed by clients
  // and MCP hosts (kept-English bucket), not UI copy.
  return Response.json(
    { error: 'rate_limited', error_description: 'Too many requests. Try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec), ...headers } },
  )
}

/** test hook */
export function _resetRateLimiter(): void {
  buckets.clear()
}
