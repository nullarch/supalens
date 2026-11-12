import { authServerMetadata } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=300',
}

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414). The issuer is the site origin, so the
 * canonical location is the root well-known path; the catch-all also answers the path-suffixed
 * probes some clients make.
 */
export function GET(req: Request) {
  return Response.json(authServerMetadata(req), { headers: HEADERS })
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS })
}
