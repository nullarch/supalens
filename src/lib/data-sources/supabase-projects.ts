// NOT `import 'server-only'` — the pure half is imported by the setup UI's test and the io half
// runs on the BFF only, but keeping the module Node-plain matches supabase-oauth/* (which the
// Trigger bundle pulls in). Same convention as utils/supabase/admin.ts.
import { requireAdminClient } from '@/utils/supabase/admin'
import { isReconnectRequired, getCachedAccessToken } from '@/lib/supabase-oauth/tokens'
import { isProjectBootstrappable } from '@/lib/supabase-oauth/bootstrap-projects'
import { SupabaseManagementClient, type SupabaseProject } from '@/lib/supabase-management/client'

/**
 * Which deployment a project looks like. The Management API's project payload carries
 * `{id, organization_id, name, region, status}` and NO environment field, so this is a
 * NAME heuristic and nothing more — the UI labels it as a guess, never as fact.
 */
export type ProjectEnvironment = 'production' | 'staging' | 'unknown'

const PRODUCTION_TOKENS = new Set(['prod', 'production', 'live', 'main', 'master'])
const STAGING_TOKENS = new Set([
  'staging',
  'stage',
  'stg',
  'dev',
  'development',
  'test',
  'testing',
  'qa',
  'sandbox',
  'preview',
  'demo',
  'local',
])

/**
 * Split on separators so "producer" never reads as "prod" and "my-app-staging" does read as
 * staging. Production wins a tie ("prod-test-restore" is likelier production than a scratch DB).
 */
export function guessEnvironment(name: string): ProjectEnvironment {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (tokens.some((tk) => PRODUCTION_TOKENS.has(tk))) return 'production'
  if (tokens.some((tk) => STAGING_TOKENS.has(tk))) return 'staging'
  return 'unknown'
}

/** Provisioning state of one project, as far as supalens's own tables can see it. */
export type ProjectState = 'none' | 'pending' | 'active' | 'error' | 'disabled'

/**
 * The stages the UI reports. Each one is OBSERVABLE from a row we actually write:
 *   authorized   — the provider_connection is active (true for every project in the list)
 *   roleCreated  — the bootstrap minted supalens_ro and stored its password (row went 'active')
 *   schemaScanned— data_source_schemas.status === 'fresh'
 * "Database reachable" is deliberately absent: minting runs SQL on the project DB, so it is the
 * same event as `roleCreated` — a separate tick would be decoration, not information.
 */
export interface ProjectStages {
  authorized: boolean
  roleCreated: boolean
  schemaScanned: boolean
}

export interface SupabaseProjectChoice {
  ref: string
  name: string
  region: string
  /** Management API status, e.g. ACTIVE_HEALTHY / INACTIVE. Null when the API omitted it. */
  status: string | null
  /** Only ACTIVE_HEALTHY projects have a Postgres we can mint the read-only role on. */
  bootstrappable: boolean
  env: ProjectEnvironment
  state: ProjectState
  dataSourceId: string | null
  errorCode: string | null
  stages: ProjectStages
}

export interface DataSourceRowForProject {
  id: string
  status: string
  last_error_code: string | null
  config: Record<string, unknown> | null
}

/**
 * Join the live project list to what supalens has provisioned. PURE so the picker's states can
 * be pinned without a Management API or a database.
 *
 * `schemaScanned` is passed in as a set of data-source ids with a fresh introspection cache.
 */
export function mergeProjectStates(
  projects: SupabaseProject[],
  rows: DataSourceRowForProject[],
  freshSchemaSourceIds: ReadonlySet<string> = new Set(),
): SupabaseProjectChoice[] {
  const byRef = new Map<string, DataSourceRowForProject>()
  for (const row of rows) {
    const ref = row.config?.project_ref
    if (typeof ref === 'string') byRef.set(ref, row)
  }

  return projects.map((p) => {
    const row = byRef.get(p.id)
    const state: ProjectState = !row
      ? 'none'
      : row.status === 'active' || row.status === 'pending' || row.status === 'error' || row.status === 'disabled'
        ? row.status
        : 'pending'
    return {
      ref: p.id,
      name: p.name,
      region: p.region,
      status: p.status ?? null,
      bootstrappable: isProjectBootstrappable(p),
      env: guessEnvironment(p.name),
      state,
      dataSourceId: row?.id ?? null,
      errorCode: row?.last_error_code ?? null,
      stages: {
        authorized: true,
        roleCreated: row?.status === 'active',
        schemaScanned: Boolean(row && freshSchemaSourceIds.has(row.id)),
      },
    }
  })
}

/**
 * Sort for the picker: bootstrappable first, then production → unknown → staging, then by name.
 * The production-first order is the recommendation ("watch the business", not the scratch DB).
 */
const ENV_RANK: Record<ProjectEnvironment, number> = { production: 0, unknown: 1, staging: 2 }

export function sortProjectChoices(list: SupabaseProjectChoice[]): SupabaseProjectChoice[] {
  return [...list].sort((a, b) => {
    if (a.bootstrappable !== b.bootstrappable) return a.bootstrappable ? -1 : 1
    if (ENV_RANK[a.env] !== ENV_RANK[b.env]) return ENV_RANK[a.env] - ENV_RANK[b.env]
    return a.name.localeCompare(b.name)
  })
}

export interface ConnectionProjects {
  connectionId: string
  projects: SupabaseProjectChoice[]
  /**
   * The stored OAuth grant is dead (revoked upstream, or a reuse was detected) — the projects
   * list could not be read and the user must re-authorize. A STATE, not an exception: this is a
   * normal end of the grant lifecycle and every caller has a reconnect affordance to show.
   */
  needsReconnect: boolean
}

/**
 * List the org's active Supabase connection and every project on it, annotated with what
 * supalens has provisioned so far. Returns null when the org has no active Supabase connection.
 *
 * Uses the CACHED access token: this is called on every setup render AND on every poll tick, and
 * `getValidAccessToken` rotates the single-use refresh token on each call (see tokens.ts).
 */
export async function listConnectionProjects(orgId: string): Promise<ConnectionProjects | null> {
  const admin = requireAdminClient()

  const { data: conns } = await admin
    .from('provider_connections')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', 'supabase')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const connectionId = (conns?.[0] as { id: string } | undefined)?.id
  if (!connectionId) return null

  let projects
  try {
    const accessToken = await getCachedAccessToken(connectionId)
    const mgmt = new SupabaseManagementClient(accessToken)
    projects = await mgmt.listProjects()
  } catch (err) {
    if (isReconnectRequired(err)) return { connectionId, projects: [], needsReconnect: true }
    throw err
  }

  const { data: sourceRows } = await admin
    .from('data_sources')
    .select('id, status, last_error_code, config')
    .eq('connection_id', connectionId)
    .is('deleted_at', null)
  const rows = (sourceRows ?? []) as DataSourceRowForProject[]

  // Schema-scan evidence for the rows we found (one query, not one per project).
  let fresh = new Set<string>()
  if (rows.length > 0) {
    const { data: schemaRows } = await admin
      .from('data_source_schemas')
      .select('data_source_id, status')
      .in(
        'data_source_id',
        rows.map((r) => r.id),
      )
      .eq('status', 'fresh')
    fresh = new Set(((schemaRows ?? []) as { data_source_id: string }[]).map((r) => r.data_source_id))
  }

  return {
    connectionId,
    projects: sortProjectChoices(mergeProjectStates(projects, rows, fresh)),
    needsReconnect: false,
  }
}
