// NOT `import 'server-only'`: this module is shared with the Trigger.dev agent
// runtime (a plain Node bundle where the server-only guard throws). It reads
// GITHUB_APP_* server env (never exposed to the browser), so it is inert if ever
// bundled client-side. Keep client components from importing it via the ESLint
// no-restricted-imports rule (same convention as src/utils/supabase/admin.ts).

/** GitHub endpoints. App + user-to-server OAuth share github.com/login/oauth/*. */
export const GITHUB = {
  apiBase: 'https://api.github.com',
  apiVersion: '2022-11-28',
  oauthAuthorizeUrl: 'https://github.com/login/oauth/authorize',
  oauthTokenUrl: 'https://github.com/login/oauth/access_token',
} as const

// NOTE: no clientId/clientSecret here — the user-to-server OAuth flow (docs/github.md auth #3)
// is not implemented; v1 uses installation tokens only. Add them back WITH the flow, not before.
export interface GithubAppConfig {
  appId: string
  slug: string
  /** PEM private key (RS256) used to sign the App JWT. HOST secret — never per-tenant. */
  privateKey: string
  webhookSecret: string
  redirectUri?: string
}

export function getGithubAppConfig(): GithubAppConfig {
  const appId = process.env.GITHUB_APP_ID
  const slug = process.env.GITHUB_APP_SLUG
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!appId || !slug || !privateKeyRaw || !webhookSecret) {
    throw new Error(
      'GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET.'
    )
  }
  // Allow the PEM to be supplied on a single line with literal "\n" escapes.
  const privateKey = privateKeyRaw.includes('\\n') ? privateKeyRaw.replace(/\\n/g, '\n') : privateKeyRaw
  return {
    appId,
    slug,
    privateKey,
    webhookSecret,
    redirectUri: process.env.GITHUB_APP_REDIRECT_URI,
  }
}

/**
 * Installation URL the user is sent to. GitHub echoes `state` back to the Setup URL
 * (our callback) alongside `installation_id` + `setup_action`. See docs/github.md §0.1
 * for the user-authorization alternative if state echo proves unreliable.
 */
export function installUrl(slug: string, state: string): string {
  const u = new URL(`https://github.com/apps/${slug}/installations/new`)
  u.searchParams.set('state', state)
  return u.toString()
}

/**
 * The App's public page. A user WITHOUT admin rights on the target GitHub org cannot install
 * from `installUrl` — GitHub turns the button into a request that the org's owners approve.
 * This is that entry point; it is only ever surfaced as a fallback next to the install CTA.
 */
export function appPublicUrl(slug: string): string {
  return `https://github.com/apps/${slug}`
}

/**
 * The App slug alone, WITHOUT the throw that `getGithubAppConfig()` raises when the private
 * key or webhook secret is missing. UI that only needs to build a github.com link (the
 * install / request-install affordances) must not depend on the host secrets being present.
 * Returns null when unset, so the caller hides the link rather than rendering a broken one.
 */
export function githubAppSlug(): string | null {
  return process.env.GITHUB_APP_SLUG || null
}

/** Whether the GitHub App is registered for this install (all four values). UI must hide the
 *  "attach repository" paths when it is not. */
export function githubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_WEBHOOK_SECRET,
  )
}

export const GH_OAUTH_COOKIE = {
  state: 'gh_oauth_state',
  returnTo: 'gh_oauth_return_to',
} as const

export { isSafeReturnTo } from '@/lib/http/safe-return-to'
