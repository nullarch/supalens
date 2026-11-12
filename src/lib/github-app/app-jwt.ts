// NOT `import 'server-only'` — shared with the Trigger.dev runtime (see config.ts).
import { createSign } from 'crypto'

import { getGithubAppConfig } from './config'

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Sign a short-lived App JWT (RS256) to authenticate AS the GitHub App — used to mint
 * installation tokens and read app/installation metadata. GitHub caps the lifetime at
 * 10 minutes; we use 9 and back-date `iat` 60s to tolerate clock skew.
 *
 * Implemented with Node `crypto` (no `jsonwebtoken` dependency).
 */
export function mintAppJwt(): string {
  const cfg = getGithubAppConfig()
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: cfg.appId }))
  const signingInput = `${header}.${payload}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(cfg.privateKey)
  return `${signingInput}.${b64url(signature)}`
}
