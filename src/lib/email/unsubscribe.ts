// NOTE: intentionally NOT `import 'server-only'` — tokens are SIGNED on the
// Trigger.dev host (where digest/alert emails are sent) and VERIFIED on Vercel
// (the /api/email/unsubscribe route), same convention as email/alert.ts.
import { appOrigin } from '@/config/edition'
import { createHmac, hkdfSync, timingSafeEqual } from 'crypto'

/**
 * Signed one-click unsubscribe tokens for the recurring emails (digest, alert).
 *
 * The HMAC key is HKDF-derived from SUPABASE_SERVICE_ROLE_KEY (already present
 * on BOTH runtimes) with a dedicated info label, so no new env var is needed
 * and the derived key is useless outside this purpose. Token = base64url(JSON
 * payload) + '.' + base64url(HMAC-SHA256) — no PII beyond opaque uuids.
 */

export type UnsubKind = 'digest' | 'alert' | 'lifecycle'

export interface UnsubPayload {
  /** profiles.id of the recipient */
  userId: string
  orgId: string
  kind: UnsubKind
  /** expiry, epoch seconds */
  exp: number
}

/** 180 days — emails sit in inboxes; Gmail may fire one-click long after delivery. */
const TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60

function deriveKey(): Buffer | null {
  const master = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!master) return null
  return Buffer.from(hkdfSync('sha256', master, 'supalens', 'email-unsub-v1', 32))
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

/**
 * Sign an unsubscribe token for one recipient. Returns null when the signing
 * key is unavailable (unconfigured env) — callers then omit the unsubscribe
 * header/link rather than fail the send (never-throw email contract).
 */
export function signUnsubToken(
  args: { userId: string; orgId: string; kind: UnsubKind },
  nowMs = Date.now(),
): string | null {
  const key = deriveKey()
  if (!key) return null
  const payload: UnsubPayload = {
    userId: args.userId,
    orgId: args.orgId,
    kind: args.kind,
    exp: Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${body}.${b64url(hmac(key, body))}`
}

/** Verify a token: signature + expiry + shape. Returns the payload or null. */
export function verifyUnsubToken(token: string, nowMs = Date.now()): UnsubPayload | null {
  const key = deriveKey()
  if (!key) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const body = token.slice(0, dot)
  let sig: Buffer
  try {
    sig = Buffer.from(token.slice(dot + 1), 'base64url')
  } catch {
    return null
  }
  const expected = hmac(key, body)
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const p = payload as Partial<UnsubPayload>
  if (
    typeof p.userId !== 'string' ||
    typeof p.orgId !== 'string' ||
    (p.kind !== 'digest' && p.kind !== 'alert' && p.kind !== 'lifecycle') ||
    typeof p.exp !== 'number'
  ) {
    return null
  }
  if (p.exp * 1000 < nowMs) return null
  return p as UnsubPayload
}

/** Absolute one-click unsubscribe URL for an email header/footer. Null when unsignable. */
export function unsubscribeUrl(args: { userId: string; orgId: string; kind: UnsubKind }): string | null {
  const token = signUnsubToken(args)
  if (!token) return null
  // www fallback, not apex — the apex 307s and a redirect would break the
  // mailbox provider's one-click POST (same convention as messenger/answer.ts)
  const base = appOrigin('https://www.supalens.ai')
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`
}
