import { lookup } from 'dns/promises'
import net from 'net'

import { isSelfHosted } from '@/config/edition'

/**
 * SSRF guard for user-supplied DB hosts. A tenant registers an arbitrary host:port that
 * the server (and the privileged Trigger.dev agent host holding SERVICE_ROLE/KEK) connects
 * to. Without this, a tenant could point us at loopback, cloud metadata (169.254.169.254),
 * or internal services and exfiltrate creds / reach internal infra.
 *
 * Defenses:
 *  - robust IPv4 + IPv6 classification (incl. hex v4-mapped / v4-compatible / NAT64),
 *  - resolve-and-PIN: we resolve the host ourselves, reject if ANY resolved address is
 *    private, and connect to the validated IP literal so the driver cannot re-resolve
 *    (defeats DNS-rebinding TOCTOU). Used at registration AND on every query (dsn.ts).
 *
 * Set ALLOW_PRIVATE_DB_HOSTS=true for local dev / self-hosted networks.
 */
export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeHostError'
  }
}

function isPrivateV4Parts(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // 169.254/16 link-local (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 0) return true // 192.0.0/24 + 192.0.2/24
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmark
  if (a >= 224) return true // multicast / reserved / broadcast
  return false
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4) return true
  return isPrivateV4Parts(p[0], p[1], p[2], p[3])
}

/** Parse an IPv6 literal (incl. :: compression and embedded dotted v4) into 16 bytes. */
function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase().split('%')[0] // strip zone id
  // embedded dotted v4 in the last 32 bits → rewrite as two hextets
  const dot = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dot) {
    const parts = dot[1].split('.').map(Number)
    if (parts.some((n) => Number.isNaN(n) || n > 255)) return null
    const h1 = ((parts[0] << 8) | parts[1]).toString(16)
    const h2 = ((parts[2] << 8) | parts[3]).toString(16)
    s = s.slice(0, s.length - dot[1].length) + h1 + ':' + h2
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length
    if (missing < 0) return null
    groups = [...head, ...Array(missing).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function isPrivateV6(ip: string): boolean {
  const b = parseIPv6(ip)
  if (!b) return true // unparseable → treat as unsafe
  if (b.every((x) => x === 0)) return true // :: unspecified
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true // ::1 loopback
  // v4-mapped ::ffff:0:0/96
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff)
    return isPrivateV4Parts(b[12], b[13], b[14], b[15])
  // NAT64 well-known prefix 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0))
    return isPrivateV4Parts(b[12], b[13], b[14], b[15])
  // v4-compatible ::a.b.c.d (deprecated)
  if (b.slice(0, 12).every((x) => x === 0)) return isPrivateV4Parts(b[12], b[13], b[14], b[15])
  if ((b[0] & 0xfe) === 0xfc) return true // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
  return false
}

function isBlocked(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip)
  if (net.isIPv6(ip)) return isPrivateV6(ip)
  return true // not an IP → unsafe
}

/**
 * Whether databases on private / loopback addresses may be connected.
 * Hosted: only with ALLOW_PRIVATE_DB_HOSTS=true (local development).
 * Self-hosted: allowed unless ALLOW_PRIVATE_DB_HOSTS=false — an internal tool exists to read
 * internal databases, and every account on it was created by an admin. Operators who let less
 * trusted people add sources should turn it off (see SECURITY.md).
 */
export function privateHostsAllowed(): boolean {
  const flag = process.env.ALLOW_PRIVATE_DB_HOSTS
  if (flag === 'true') return true
  if (flag === 'false') return false
  return isSelfHosted()
}

/**
 * Resolve a host and validate every resolved address, returning a single validated IP to
 * connect to (pin). Throws UnsafeHostError if the host is private / unresolvable.
 */
export async function resolveSafeHost(host: string): Promise<{ ip: string; original: string }> {
  const trimmed = host.trim()
  if (!trimmed) throw new UnsafeHostError('empty host')

  if (privateHostsAllowed()) {
    return { ip: trimmed, original: trimmed } // no pinning
  }

  let ips: string[]
  if (net.isIP(trimmed)) {
    ips = [trimmed]
  } else {
    try {
      ips = (await lookup(trimmed, { all: true })).map((a) => a.address)
    } catch {
      throw new UnsafeHostError(`could not resolve host: ${trimmed}`)
    }
  }
  if (ips.length === 0) throw new UnsafeHostError(`host did not resolve: ${trimmed}`)
  for (const ip of ips) {
    if (isBlocked(ip)) throw new UnsafeHostError(`host ${trimmed} resolves to a blocked/private address`)
  }
  return { ip: ips[0], original: trimmed } // pin to a validated IP (driver won't re-resolve)
}

/** Boolean-style guard (throws on unsafe). Prefer resolveSafeHost when you will connect. */
export async function assertSafeHost(host: string): Promise<void> {
  await resolveSafeHost(host)
}

// exported for unit tests
export const _internal = { isPrivateV4, isPrivateV6, isBlocked, parseIPv6 }
