// NOTE: intentionally NOT `import 'server-only'` — pure Node crypto helpers imported by
// tokens.ts, which is shared with the Trigger.dev runtime (plain Node bundle), same
// convention as utils/supabase/admin.ts.
import { createHash, randomBytes } from 'crypto'

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** PKCE code_verifier — kept secret, stored in an httpOnly cookie until the callback. */
export const newVerifier = (): string => b64url(randomBytes(64))

/** code_challenge = BASE64URL(SHA256(code_verifier)), method S256. */
export const challenge = (verifier: string): string =>
  b64url(createHash('sha256').update(verifier).digest())

/** CSRF state value. */
export const newState = (): string => b64url(randomBytes(16))

/** Base64url SHA-256 of an arbitrary string (used for refresh-token reuse detection). */
export const sha256b64 = (value: string): string =>
  b64url(createHash('sha256').update(value).digest())
