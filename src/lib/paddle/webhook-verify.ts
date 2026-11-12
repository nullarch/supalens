// NOT `import 'server-only'` — pure crypto helper (shared paddle-module convention);
// kept dependency-free so the signature scheme is directly unit-testable.
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify a Paddle-Signature header: `ts=<unix>;h1=<hex>`, HMAC-SHA256 over `${ts}:${rawBody}`.
 * The raw body must be used verbatim. During a webhook-secret ROTATION Paddle signs with both
 * secrets and sends MULTIPLE `h1` entries — accept if ANY matches, else valid events 401 for
 * the whole rotation window. event_id idempotency (in the route) covers true replays, so the
 * timestamp tolerance only needs to absorb clock skew.
 */
export function verifyPaddleSignature(secret: string, raw: string, header: string, nowMs = Date.now()): boolean {
  let ts: string | null = null
  const h1s: string[] = []
  for (const kv of header.split(';')) {
    const i = kv.indexOf('=')
    if (i <= 0) continue
    const key = kv.slice(0, i).trim()
    const value = kv.slice(i + 1).trim()
    if (key === 'ts') ts = value
    else if (key === 'h1') h1s.push(value)
  }
  if (!ts || h1s.length === 0) return false
  const age = Math.abs(nowMs / 1000 - Number(ts))
  if (!Number.isFinite(age) || age > 300) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex'))
  return h1s.some((h1) => {
    const candidate = Buffer.from(h1)
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
}
