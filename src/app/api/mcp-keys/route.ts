import { ensurePrimaryOrg } from '@/lib/org/server'
import { listApiKeys, mintApiKey, revokeApiKey } from '@/lib/mcp/keys'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['owner', 'admin', 'member']

async function authed() {
  const supabase = await createClient()
  if (!supabase) return { error: Response.json({ error: 'supabase_not_configured' }, { status: 500 }) }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  const orgId = await ensurePrimaryOrg(supabase, user)
  const { data: m } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (m?.[0] as { role: string } | undefined)?.role
  return { supabase, user, orgId, role }
}

/** List the workspace's sl_ keys (no secret material). */
export async function GET() {
  const a = await authed()
  if (a.error) return a.error
  return Response.json({ keys: await listApiKeys(a.orgId!) })
}

/** Mint a new sl_ key — plaintext returned ONCE. */
export async function POST() {
  const a = await authed()
  if (a.error) return a.error
  if (!a.role || !WRITE_ROLES.includes(a.role)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const minted = await mintApiKey({ orgId: a.orgId!, createdBy: a.user!.id })
  return Response.json({ token: minted.token, id: minted.id, prefix: minted.prefix, lastFour: minted.lastFour })
}

/** Revoke a key by id (?id=...). */
export async function DELETE(req: Request) {
  const a = await authed()
  if (a.error) return a.error
  if (!a.role || !WRITE_ROLES.includes(a.role)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })
  const okRevoked = await revokeApiKey(a.orgId!, id)
  return Response.json({ revoked: okRevoked })
}
