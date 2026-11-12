import { isSelfHosted } from '@/config/edition'

/** Sign-in methods the login form can offer. Each must also be enabled in the Supabase project
 *  (Authentication → Providers); this list only decides what the form shows. */
export const AUTH_METHODS = ['google', 'kakao', 'github', 'email_link', 'password'] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

const CLOUD_DEFAULT: readonly AuthMethod[] = ['google', 'kakao', 'github', 'email_link']
// Email + password needs no OAuth app and no mail server.
const SELFHOST_ONLY: readonly AuthMethod[] = ['password']

export function parseAuthMethods(raw: string | null | undefined, fallback: readonly AuthMethod[]): readonly AuthMethod[] {
  const wanted = (raw ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is AuthMethod => (AUTH_METHODS as readonly string[]).includes(v))
  const unique = AUTH_METHODS.filter((m) => wanted.includes(m))
  return unique.length > 0 ? unique : fallback
}

/** The methods the login form offers.
 *  Self-hosted: always email + password with internal accounts — no social login and no emailed
 *  link, whatever the environment says.
 *  Hosted: NEXT_PUBLIC_AUTH_PROVIDERS (e.g. `google,github,email_link`), else the default. */
export function enabledAuthMethods(): readonly AuthMethod[] {
  if (isSelfHosted()) return SELFHOST_ONLY
  return parseAuthMethods(process.env.NEXT_PUBLIC_AUTH_PROVIDERS, CLOUD_DEFAULT)
}
