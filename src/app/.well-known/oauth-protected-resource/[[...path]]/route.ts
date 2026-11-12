import { protectedResourceMetadata } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  // clients cache discovery for a few minutes; matching it keeps a change from lingering longer
  'Cache-Control': 'public, max-age=300',
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). Points MCP clients at the authorization
 * server. Served at the root well-known path AND the path-suffixed form
 * (`/.well-known/oauth-protected-resource/<mcp path>`) that clients try first — the MCP
 * endpoint's 401 points at the suffixed one.
 */
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(req), { headers: HEADERS })
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS })
}
