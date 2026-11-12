// NOTE: intentionally NOT `import 'server-only'` — read by the middleware, client components
// and the Trigger.dev bundle. Pure env config, no io.
//
// One codebase, two editions:
//   cloud    — the hosted service (marketing site, billing, public demo, X-ray, support chat)
//   selfhost — a single-tenant install run by its operator (product only, no plan limits)
//
// NEXT_PUBLIC_SUPALENS_EDITION is inlined into the browser bundle at build time, so the edition
// of a build is fixed when it is built. Set the same value on the Trigger.dev host.

export type Edition = 'cloud' | 'selfhost'

// The repository default is the self-hosted product. The hosted deployment sets
// NEXT_PUBLIC_SUPALENS_EDITION=cloud explicitly on both runtimes.
const DEFAULT_EDITION: Edition = 'selfhost'

export function parseEdition(raw: string | null | undefined): Edition {
  const v = raw?.trim().toLowerCase()
  if (v === 'cloud') return 'cloud'
  if (v === 'selfhost' || v === 'self-hosted' || v === 'selfhosted') return 'selfhost'
  return DEFAULT_EDITION
}

export function edition(): Edition {
  return parseEdition(process.env.NEXT_PUBLIC_SUPALENS_EDITION)
}

export function isCloud(): boolean {
  return edition() === 'cloud'
}

export function isSelfHosted(): boolean {
  return edition() === 'selfhost'
}

const CLOUD_ORIGIN = 'https://supalens.ai'
const SELFHOST_FALLBACK_ORIGIN = 'http://localhost:3000'
let warnedMissingOrigin = false

/**
 * The origin every absolute link is built from (emails, Slack messages, share links, MCP text).
 * NEXT_PUBLIC_APP_URL wins. Without it the hosted edition falls back to its own domain; a
 * self-hosted install falls back to localhost and warns once, because links in mail sent from
 * the Trigger.dev host would otherwise point at someone else's site. Never throws: several
 * callers are email modules whose contract is to degrade, not fail.
 */
export function appOrigin(cloudFallback: string = CLOUD_ORIGIN): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (isCloud()) return cloudFallback
  if (!warnedMissingOrigin) {
    warnedMissingOrigin = true
    console.warn('[config] NEXT_PUBLIC_APP_URL is not set — links fall back to http://localhost:3000. Set it on the web server and the Trigger.dev host.')
  }
  return SELFHOST_FALLBACK_ORIGIN
}
