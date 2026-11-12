import { createMcpHandler, withMcpAuth } from 'mcp-handler'

import { verifyMcpToken } from '@/lib/mcp/auth'
import { clientIpOf, rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { registerSupalensTools } from '@/lib/mcp/tools'

// The query engine uses `pg` + the secrets vault + KMS — strictly Node, never Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * supalens remote MCP server (Streamable HTTP).
 *
 * One hosted endpoint every AI client (Claude Code, Cursor, …) connects to. Tools are
 * thin transports over the SAME read-only query engine, viz spec, and dashboards tables
 * the web app and the Trigger.dev agent use — see docs/mcp-implementation-plan.md.
 *
 * Stateless (no Redis, SSE disabled): each tool call is an independent authenticated POST.
 * Connect URL → `<origin>/api/mcp/mcp`  (prod: rewrite mcp.supalens.ai/mcp → here).
 */
const handler = createMcpHandler(
  (server) => registerSupalensTools(server),
  { serverInfo: { name: 'supalens', version: '1.0.0' } },
  { basePath: '/api/mcp', disableSse: true, verboseLogs: false }
)

// Every request must carry a valid bearer (sl_ key OR OAuth slat_ token) → org context.
// resourceMetadataPath makes the 401 advertise the OAuth discovery doc so clients that
// don't have a key can start the OAuth 2.1 (PKCE) flow.
const authed = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
})

// Per-credential throttle (120 req/min per bearer, per-IP for unauthenticated probes).
// The quota gate bounds LLM spend; this bounds raw request volume on the query engine.
const limited = (req: Request, ctx: unknown) => {
  const bearer = req.headers.get('authorization') ?? ''
  const key = bearer ? `mcp:${bearer.slice(-24)}` : `mcp-ip:${clientIpOf(req)}`
  const rl = rateLimit(key, 120, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec)
  return (authed as unknown as (r: Request, c: unknown) => Promise<Response>)(req, ctx)
}

export { limited as GET, limited as POST, limited as DELETE }
