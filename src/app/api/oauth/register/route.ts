import { registerClient } from '@/lib/mcp/oauth'
import { clientIpOf, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

/** Dynamic Client Registration (RFC 7591). Public PKCE clients only. */
export async function POST(req: Request) {
  // DCR is unauthenticated by spec → tight per-IP throttle (10/min) against registration spam
  const rl = rateLimit(`oauth-register:${clientIpOf(req)}`, 10, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec, CORS)

  let body: { redirect_uris?: unknown; client_name?: unknown; grant_types?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_client_metadata', error_description: 'invalid JSON' }, { status: 400, headers: CORS })
  }
  try {
    const client = await registerClient(body)
    return Response.json(
      {
        client_id: client.client_id,
        redirect_uris: client.redirect_uris,
        client_name: client.client_name,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        grant_types: client.grant_types,
        response_types: ['code'],
      },
      { status: 201, headers: CORS }
    )
  } catch (e) {
    return Response.json(
      { error: 'invalid_client_metadata', error_description: String(e instanceof Error ? e.message : e) },
      { status: 400, headers: CORS }
    )
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
