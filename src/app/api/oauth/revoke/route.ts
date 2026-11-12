import { revokeToken } from '@/lib/mcp/oauth'
import { clientIpOf, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

/**
 * OAuth token revocation (RFC 7009). Either token of a grant ends the whole grant — this is what
 * a client calls when the user disconnects. The answer is 200 whether or not the token existed,
 * as the RFC requires, so the endpoint cannot be used to probe which tokens are live.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`oauth-revoke:${clientIpOf(req)}`, 30, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec, CORS)

  const token = new URLSearchParams(await req.text()).get('token') ?? ''
  try {
    await revokeToken(token)
  } catch {
    return Response.json(
      { error: 'temporarily_unavailable', error_description: 'try again in a moment' },
      { status: 503, headers: { ...CORS, 'Cache-Control': 'no-store' } },
    )
  }
  return new Response(null, { status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' } })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
