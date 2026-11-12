import type { AuthInfo } from '@modelcontextprotocol/server'

import { requireAdminClient } from '@/utils/supabase/admin'

import { verifyApiKey } from './keys'
import { ACCESS_PREFIX, verifyAccessToken } from './oauth'

/**
 * Context we attach to a verified MCP request and read back inside every tool handler
 * via `extra.authInfo.extra`. The data source is NEVER taken from this — only the org —
 * so a token can only ever reach data sources its own org owns.
 */
export interface McpAuthContext {
  orgId: string
  apiKeyId: string
  createdBy: string | null
  /**
   * The creator's CURRENT role in the org, re-verified on every request (never trusted from
   * mint time — a member who was removed or downgraded must lose access immediately, not keep
   * a mint-time capability forever). `null` only for a legacy creator-less org key, which is
   * treated as member-level.
   */
  role: string | null
  /** token scopes ('read' / 'write') — write tools require 'write'. */
  scopes: string[]
}

/**
 * `withMcpAuth` verifier. Resolves a bearer token to its org context, or returns
 * `undefined` (→ 401) when it's missing/unknown/revoked/expired. Accepts BOTH a long-lived
 * `sl_` API key and an OAuth 2.1 `slat_` access token — they collapse to the same
 * `McpAuthContext`, so no tool code differs.
 *
 * Beyond the token row itself, the CREATOR's membership is re-verified live: a token whose
 * creator is no longer a member of the org no longer authenticates (the "removed member keeps
 * an sl_ key forever" hole). Tokens with no recorded creator skip that check (org-level keys).
 */
export async function verifyMcpToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  const verified = bearerToken.startsWith(ACCESS_PREFIX)
    ? await verifyAccessToken(bearerToken)
    : await verifyApiKey(bearerToken)
  if (!verified) return undefined

  let role: string | null = null
  if (verified.createdBy) {
    const { data } = await requireAdminClient()
      .from('organization_members')
      .select('role')
      .eq('org_id', verified.orgId)
      .eq('user_id', verified.createdBy)
      .limit(1)
    role = (data?.[0] as { role: string } | undefined)?.role ?? null
    if (!role) return undefined // creator left / was removed → the token dies with the membership
  }

  const extra: McpAuthContext = {
    orgId: verified.orgId,
    apiKeyId: verified.apiKeyId,
    createdBy: verified.createdBy,
    role,
    scopes: verified.scopes,
  }
  return {
    token: bearerToken,
    clientId: verified.apiKeyId,
    scopes: verified.scopes,
    extra: extra as unknown as Record<string, unknown>,
  }
}

const WRITE_ROLES = ['owner', 'admin', 'member']

/**
 * Gate for MCP tools that MUTATE workspace resources (dashboards, widgets, queries, alerts,
 * KPI apply/extract). Mirrors the web RLS boundary (member+ write; viewer excluded — a viewer
 * authoring queries/alerts is a data-exfil path) plus the token's own scope grant. Throws a
 * plain Error — tool handlers surface it as an MCP error result.
 */
export function assertMcpWriteAllowed(ctx: McpAuthContext): void {
  if (!ctx.scopes.includes('write')) {
    throw new Error('this token does not have the "write" scope — re-issue it with write access')
  }
  // role === null → creator-less org key (mint path already requires member+) → allowed
  if (ctx.role && !WRITE_ROLES.includes(ctx.role)) {
    throw new Error('your workspace role (viewer) cannot create or modify resources')
  }
}
