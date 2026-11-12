// Client ID Metadata Documents (CIMD): how an OAuth client introduces itself
// without registering first.
//
// The client's `client_id` is an HTTPS URL; the document at that URL lists its
// name and redirect URIs. Claude Code's is
// https://claude.ai/oauth/claude-code-client-metadata. We fetch it while
// showing the consent screen, so this module is also the one place where the
// server makes a request to an address a stranger chose — hence the checks
// before any byte is sent: HTTPS only, a hostname that resolves to public
// addresses only, no redirects, a short timeout and a small size cap.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ClientMetadata {
  clientId: string;
  /** Self-asserted. Shown under the client's host, never instead of it. */
  clientName: string | null;
  redirectUris: string[];
}

export class ClientMetadataError extends Error {}

const MAX_DOCUMENT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: ClientMetadata }>();

/** A client_id that can name a metadata document: https, a path, no credentials or fragment. */
export function parseClientIdUrl(raw: string): URL {
  if (raw.length > 2048) throw new ClientMetadataError('client_id is too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ClientMetadataError('client_id must be the HTTPS URL of a client metadata document');
  }
  if (url.protocol !== 'https:') throw new ClientMetadataError('client_id must use https');
  if (url.username || url.password) throw new ClientMetadataError('client_id must not carry credentials');
  if (url.hash) throw new ClientMetadataError('client_id must not carry a fragment');
  if (url.pathname === '/' || url.pathname === '') throw new ClientMetadataError('client_id must contain a path');
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new ClientMetadataError('client_id must use a hostname, not an address');
  return url;
}

// ── address checks (SSRF) ───────────────────────────────────────────────────

const BLOCKED_V4: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 0, 2, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [198, 51, 100, 0, 24],
  [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
];

function v4Blocked(address: string): boolean {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const value = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  return BLOCKED_V4.some(([a, b, c, d, bits]) => {
    const base = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(base / size);
  });
}

function v6Blocked(address: string): boolean {
  const a = address.toLowerCase();
  if (a === '::' || a === '::1') return true;
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  return (
    /^f[cd]/.test(a) || // fc00::/7 unique local
    /^fe[89ab]/.test(a) || // fe80::/10 link local
    /^ff/.test(a) || // multicast
    a.startsWith('2001:db8:') || // documentation
    a.startsWith('64:ff9b:') // NAT64, which can reach any IPv4 address
  );
}

/** False for loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !v4Blocked(address);
  if (family === 6) return !v6Blocked(address);
  return false;
}

// ── redirect URIs ───────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Schemes a browser would interpret itself rather than hand to a native app (RFC 8252 §7.1 allows the latter). */
const BROWSER_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:']);

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether a requested redirect_uri is one the client registered. Exact match,
 * except that a loopback redirect matches whatever port the native client
 * bound this time (RFC 8252 §7.3; Claude Code registers `http://localhost/callback`
 * and `http://127.0.0.1/callback` and listens on an ephemeral port).
 */
export function redirectUriAllowed(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopbackHttp(want) || want.username || want.password || want.hash) return false;
  return registered.some((candidate) => {
    try {
      const have = new URL(candidate);
      return (
        isLoopbackHttp(have) &&
        have.hostname === want.hostname &&
        have.pathname === want.pathname &&
        have.search === want.search
      );
    } catch {
      return false;
    }
  });
}

// ── fetching the document ───────────────────────────────────────────────────

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 80);
  return name.length > 0 ? name : null;
}

/** Validate a fetched document against the URL it was fetched from. */
export function validateClientMetadata(clientId: string, doc: unknown): ClientMetadata {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ClientMetadataError('client metadata is not a JSON object');
  const d = doc as Record<string, unknown>;
  if (d.client_id !== clientId) throw new ClientMetadataError('client metadata names a different client_id');
  const uris = d.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20 || !uris.every((u) => typeof u === 'string')) {
    throw new ClientMetadataError('client metadata must list redirect_uris');
  }
  for (const uri of uris as string[]) {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new ClientMetadataError('client metadata lists an invalid redirect_uri');
    }
    if (url.hash) throw new ClientMetadataError('a redirect_uri must not carry a fragment');
    if (url.protocol === 'http:' && !isLoopbackHttp(url)) {
      throw new ClientMetadataError('plain http redirect_uris are allowed only on loopback');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && BROWSER_SCHEMES.has(url.protocol)) {
      throw new ClientMetadataError('a redirect_uri must be https, loopback http, or an app scheme');
    }
  }
  const method = d.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none') {
    throw new ClientMetadataError('only public clients (token_endpoint_auth_method "none") are supported');
  }
  if (d.grant_types !== undefined && (!Array.isArray(d.grant_types) || !d.grant_types.includes('authorization_code'))) {
    throw new ClientMetadataError('client metadata does not allow the authorization_code grant');
  }
  return { clientId, clientName: cleanName(d.client_name), redirectUris: uris as string[] };
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new ClientMetadataError('client metadata document is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface FetchClientMetadataOptions {
  /** Injected in tests; production uses DNS and fetch. */
  resolve?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

/** Resolve, fetch and validate a client's metadata document, cached for five minutes. */
export async function fetchClientMetadata(clientId: string, options: FetchClientMetadataOptions = {}): Promise<ClientMetadata> {
  const url = parseClientIdUrl(clientId);
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const resolve =
    options.resolve ??
    (async (hostname: string) => (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address));
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new ClientMetadataError('the client metadata host does not resolve');
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new ClientMetadataError('the client metadata host resolves to a non-public address');
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json', 'user-agent': 'supalens-oauth/1' },
    });
  } catch {
    throw new ClientMetadataError('the client metadata document could not be fetched');
  }
  if (response.status !== 200) throw new ClientMetadataError(`the client metadata document answered ${response.status}`);
  let doc: unknown;
  try {
    doc = JSON.parse(await readCapped(response));
  } catch (error) {
    if (error instanceof ClientMetadataError) throw error;
    throw new ClientMetadataError('the client metadata document is not JSON');
  }
  const value = validateClientMetadata(clientId, doc);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(clientId, { at: Date.now(), value });
  return value;
}
