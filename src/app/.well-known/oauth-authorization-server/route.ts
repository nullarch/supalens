import { authServerMetadata } from '@/lib/mcp/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export function GET(req: Request) {
  return Response.json(authServerMetadata(req), { headers: CORS })
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
