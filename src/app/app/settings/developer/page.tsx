import { getTranslations } from 'next-intl/server'

import { isCloud } from '@/config/edition'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { listApiKeys, type ApiKeySummary } from '@/lib/mcp/keys'
import { createClient } from '@/utils/supabase/server'
import { PageHead } from '@/components/dashboard/PageHead'

import McpClient from './McpClient'

export const dynamic = 'force-dynamic'

export default async function DeveloperPage() {
  const t = await getTranslations('appMcp')
  // Canonical connect URL. Prod = the vanity host (mcp.supalens.ai/mcp — rewritten to
  // /api/mcp/mcp in next.config) so the URL users commit into .mcp.json never encodes
  // our internal route structure, and never rides the apex→www 307 that supalens.ai
  // adds. Dev/self-host fallback = the internal path on the app origin (no vanity
  // subdomain locally). NEXT_PUBLIC_MCP_URL overrides both.
  const endpoint =
    process.env.NEXT_PUBLIC_MCP_URL ??
    (process.env.NODE_ENV === 'production' && isCloud()
      ? 'https://mcp.supalens.ai/mcp'
      : `${(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/mcp/mcp`)

  let keys: ApiKeySummary[] = []
  // Mint/revoke are owner/admin/member (the API 403s viewers) — mirror that in the UI so a
  // viewer sees the endpoint + tools but not dead buttons.
  let canManage = false
  let workspaceId = 'unconfigured'
  const supabase = await createClient()
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const orgId = await ensurePrimaryOrg(supabase, user)
      workspaceId = orgId
      keys = await listApiKeys(orgId)
      canManage = await userHasOrgRole(supabase, orgId, user.id, ['owner', 'admin', 'member'])
    }
  }

  return (
    <main>
      <PageHead title={t('title')} subtitle={t('subtitle')} />
      <McpClient key={workspaceId} initialKeys={keys} endpoint={endpoint} canManage={canManage} />
    </main>
  )
}
