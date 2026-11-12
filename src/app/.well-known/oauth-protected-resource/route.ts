import { protectedResourceMetadata } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728). Points MCP clients at the AS. */
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(req), { headers: CORS })
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
