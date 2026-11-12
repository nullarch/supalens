// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// process-revocations task (plain Node bundle), same convention as utils/supabase/admin.ts.
import { SUPABASE_OAUTH } from '@/lib/supabase-oauth/config'

export class ManagementApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'ManagementApiError'
  }
}

export interface SupabaseOrganization {
  id: string
  name: string
  slug?: string
}

export interface SupabaseProject {
  id: string // project ref
  organization_id: string
  name: string
  region: string
  status?: string
  database?: { host?: string; version?: string }
}

export interface PoolerConfig {
  connectionString?: string
  db_host?: string
  db_port?: number
  db_name?: string
  db_user?: string
  pool_mode?: string
  identifier?: string
  database_type?: 'PRIMARY' | 'READ_REPLICA'
  [key: string]: unknown
}

/**
 * Thin wrapper over the Supabase Management API (api.supabase.com/v1), authenticated
 * with an OAuth access token acting on behalf of a connected user. See docs/supabase.md §4.
 */
export class SupabaseManagementClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${SUPABASE_OAUTH.managementBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
    })

    if (res.status === 429) {
      const reset = Number(res.headers.get('X-RateLimit-Reset') ?? res.headers.get('Retry-After') ?? '0')
      throw new ManagementApiError('rate limited', 429, Number.isFinite(reset) ? reset : undefined)
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ManagementApiError(`management API ${res.status}: ${body.slice(0, 300)}`, res.status)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  listOrganizations(): Promise<SupabaseOrganization[]> {
    return this.request<SupabaseOrganization[]>('/organizations')
  }

  listProjects(): Promise<SupabaseProject[]> {
    return this.request<SupabaseProject[]>('/projects')
  }

  /**
   * Supavisor pooler config. The endpoint returns ONE ENTRY PER DATABASE (the PRIMARY plus
   * any read replicas) — an ARRAY, not a single object. Treating it as an object was a real
   * bug: `.db_host` read undefined off the array, so every OAuth-connected source was stored
   * host-less (and unusable) while still bootstrapping to 'active'.
   */
  getPoolerConfigs(ref: string): Promise<PoolerConfig[]> {
    return this.request<PoolerConfig[]>(`/projects/${ref}/config/database/pooler`)
  }

  /**
   * Run elevated SQL via the Management API (no DB password needed). Database write scope.
   * `readOnly: true` makes Supabase run the statement(s) in a READ ONLY transaction
   * server-side (owner-level execution, so tenant RLS does NOT restrict results) — the
   * query transport for Supabase-OAuth data sources (src/lib/query/supabase-api.ts).
   */
  runQuery<T = unknown>(ref: string, query: string, opts?: { readOnly?: boolean }): Promise<T> {
    return this.request<T>(`/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query, ...(opts?.readOnly ? { read_only: true } : {}) }),
    })
  }
}
