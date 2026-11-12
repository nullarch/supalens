// Pure parser for a pasted database connection URL. No io — safe in the browser.

/** verify = TLS with certificate verification · require = TLS without it · off = no TLS. */
export type SslMode = 'verify' | 'require' | 'off'

export interface ParsedConnection {
  host: string
  port: string
  database: string
  user: string
  password: string
  ssl: SslMode
}

const SCHEMES: Record<'postgres' | 'mysql', string[]> = {
  postgres: ['postgres:', 'postgresql:'],
  mysql: ['mysql:'],
}

function sslFrom(params: URLSearchParams): SslMode | null {
  const mode = (params.get('sslmode') ?? params.get('ssl-mode') ?? params.get('ssl') ?? '').toLowerCase()
  if (!mode) return null
  if (['disable', 'disabled', 'false', '0', 'off'].includes(mode)) return 'off'
  if (['verify-full', 'verify-ca', 'verify_identity', 'verify_ca'].includes(mode)) return 'verify'
  return 'require' // require / prefer / allow / true / required
}

/**
 * Split `postgresql://user:pass@host:5432/db?sslmode=require` (or `mysql://…`) into form fields.
 * Returns null for anything that is not a complete URL of the expected engine, so a half-typed
 * value never overwrites what the user already entered.
 */
export function parseConnectionString(raw: string, engine: 'postgres' | 'mysql'): ParsedConnection | null {
  const value = raw.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!SCHEMES[engine].includes(url.protocol)) return null
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!url.hostname || !database || !url.username) return null
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || (engine === 'mysql' ? '3306' : '5432'),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: sslFrom(url.searchParams) ?? 'verify',
  }
}
