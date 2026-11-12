// NOT `import 'server-only'` — shared with the Trigger.dev runtime (see config.ts).
import { GITHUB } from './config'
import { mintAppJwt } from './app-jwt'

export class GithubAppError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GithubAppError'
  }
}

interface CachedToken {
  token: string
  /** epoch ms when GitHub says the token expires (~1h after mint). */
  expiresAt: number
}

// In-memory TTL cache, keyed by installation id — the structural analogue of the
// decrypted-credential cache in src/lib/query/dsn.ts. Installation tokens have NO
// refresh token: they are re-minted on demand from the App JWT.
const cache = new Map<number, CachedToken>()
// In-flight mints, so concurrent callers for the same installation share ONE GitHub
// API call instead of each minting their own. (Without it, parallel requests all hit
// GitHub and burn rate limit.)
const inflight = new Map<number, Promise<string>>()
const REFRESH_SKEW_MS = 5 * 60 * 1000 // re-mint 5 min before expiry

/**
 * Get a valid installation access token (~1h) for a GitHub App installation,
 * minting (and caching) one if needed. The App private key never leaves the host;
 * the returned token is the ONLY thing that should touch the clone path — and even
 * that must stay in the parent process (never the agent subprocess env). See docs/github.md §5–6.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  const hit = cache.get(installationId)
  if (hit && hit.expiresAt - REFRESH_SKEW_MS > Date.now()) return hit.token

  const pending = inflight.get(installationId)
  if (pending) return pending

  const promise = mintInstallationToken(installationId)
  inflight.set(installationId, promise)
  try {
    return await promise
  } finally {
    inflight.delete(installationId)
  }
}

async function mintInstallationToken(installationId: number): Promise<string> {
  const res = await fetch(
    `${GITHUB.apiBase}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintAppJwt()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB.apiVersion,
      },
      cache: 'no-store',
    }
  )

  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new GithubAppError(
      (json.message as string) || `installation token request failed (${res.status})`,
      res.status
    )
  }

  const token = json.token as string
  const expiresAt = new Date(json.expires_at as string).getTime()
  cache.set(installationId, { token, expiresAt })
  return token
}

/** Drop a cached installation token (e.g. on disconnect / installation removal). */
export function invalidateInstallationToken(installationId: number): void {
  cache.delete(installationId)
}
