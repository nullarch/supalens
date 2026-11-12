import { consumeAuthCode, getClient, issueTokens, refreshTokens } from '@/lib/mcp/oauth'
import { clientIpOf, rateLimit, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

const fail = (error: string, desc?: string, status = 400) =>
  Response.json({ error, error_description: desc }, { status, headers: CORS })

/** OAuth token endpoint: authorization_code (PKCE) + refresh_token grants. */
export async function POST(req: Request) {
  // token endpoint = credential-guessing surface → per-IP throttle (30/min)
  const rl = rateLimit(`oauth-token:${clientIpOf(req)}`, 30, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec, CORS)

  const form = new URLSearchParams(await req.text())
  const grantType = form.get('grant_type')
  const clientId = form.get('client_id') ?? ''

  if (!clientId || !(await getClient(clientId))) return fail('invalid_client', 'unknown client_id', 401)

  if (grantType === 'authorization_code') {
    const code = form.get('code')
    const redirectUri = form.get('redirect_uri')
    const codeVerifier = form.get('code_verifier')
    if (!code || !redirectUri || !codeVerifier) return fail('invalid_request', 'code, redirect_uri, code_verifier required')
    try {
      const { orgId, userId, scope } = await consumeAuthCode(code, { clientId, redirectUri, codeVerifier })
      const tokens = await issueTokens({ orgId, userId, clientId, scope })
      return Response.json(tokens, { headers: { ...CORS, 'Cache-Control': 'no-store' } })
    } catch (e) {
      return fail('invalid_grant', String(e instanceof Error ? e.message : e))
    }
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token')
    if (!refreshToken) return fail('invalid_request', 'refresh_token required')
    try {
      const tokens = await refreshTokens(refreshToken, clientId)
      return Response.json(tokens, { headers: { ...CORS, 'Cache-Control': 'no-store' } })
    } catch (e) {
      return fail('invalid_grant', String(e instanceof Error ? e.message : e))
    }
  }

  return fail('unsupported_grant_type', `unsupported grant_type: ${grantType}`)
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
