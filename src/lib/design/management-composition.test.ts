import { describe, expect, it, vi } from 'vitest'
import { common, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

describe('management page assembly and workspace remount contracts', () => {
  for (const org of ['org-a', 'org-b']) for (const role of ['owner', 'viewer']) {
    it(`team passes caller role/records and remounts by workspace (${org}/${role})`, async () => {
      const { client } = localClient(), members = [{ userId: 'user-a', role }], invites = [{ id: 'invite-a' }]
      const listMembers = vi.fn(async () => members), listInvites = vi.fn(async () => invites)
      const page = loadRoute('app/settings/members/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => org, listOrgMembers: listMembers, listPendingInvitations: listInvites },
        '@/components/dashboard/PageHead': { PageHead: 'PageHead' }, './MembersManager': { MembersManager: 'MembersManager' },
      })
      const view = oneElement(await page.default(), 'MembersManager')
      expect(view.key).toBe(org)
      expect(view.props).toEqual({ orgId: org, meId: 'user-a', myRole: role, members, invites })
      expect(listMembers).toHaveBeenCalledExactlyOnceWith(client, org)
      expect(listInvites).toHaveBeenCalledExactlyOnceWith(client, org)
    })
  }
  for (const role of ['owner', 'admin', 'member', 'viewer', undefined]) {
    it(`notifications guard secret configuration and keep destination props (${role})`, async () => {
      const { client, calls } = localClient({ organization_members: role ? [{ role }] : [] })
      const config = { sample: 'local configuration' }, targets = { email: true }, readConfig = vi.fn(async () => config), readTargets = vi.fn(async () => targets)
      const page = loadRoute('app/settings/notifications/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
        '@/lib/alerts/server': { loadNotificationConfig: readConfig, getNotificationTargets: readTargets },
        '@/lib/slack-app/config': { slackConfigured: () => false }, '@/components/dashboard/PageHead': { PageHead: 'PageHead' },
        './NotificationsManager': { NotificationsManager: 'NotificationsManager' },
      })
      const view = oneElement(await page.default(), 'NotificationsManager'), manager = ['owner', 'admin'].includes(role ?? '')
      expect(view.key).toBe('org-a')
      expect(view.props).toEqual({ canConfigure: manager, config: manager ? config : null, targets, slackAppConfigured: false })
      expect(readConfig).toHaveBeenCalledTimes(manager ? 1 : 0)
      expect(readTargets).toHaveBeenCalledExactlyOnceWith('org-a')
      expect(calls).toContainEqual(['organization_members', 'eq', 'org_id', 'org-a'])
      expect(calls).toContainEqual(['organization_members', 'eq', 'user_id', 'user-a'])
    })
  }
  for (const org of ['org-a', 'org-b']) for (const role of ['member', 'viewer']) {
    it(`MCP keys remain workspace-keyed and role-gated (${org}/${role})`, async () => {
      const { client } = localClient(), keys = [{ id: 'local-key-summary' }]
      const list = vi.fn(async () => keys), check = vi.fn(async () => role === 'member')
      const page = loadRoute('app/settings/developer/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => org }, '@/lib/org/require-role': { userHasOrgRole: check },
        '@/lib/mcp/keys': { listApiKeys: list }, '@/components/dashboard/PageHead': { PageHead: 'PageHead' }, './McpClient': 'McpClient',
      }, { NODE_ENV: 'production', NEXT_PUBLIC_MCP_URL: 'https://example.invalid/mcp' })
      const view = oneElement(await page.default(), 'McpClient')
      expect(view.key).toBe(org)
      expect(view.props).toEqual({ initialKeys: keys, endpoint: 'https://example.invalid/mcp', canManage: role === 'member' })
      expect(list).toHaveBeenCalledExactlyOnceWith(org)
      expect(check).toHaveBeenCalledExactlyOnceWith(client, org, 'user-a', ['owner', 'admin', 'member'])
    })
  }
})
