// NOTE: intentionally NOT `import 'server-only'` — reachable from the MCP handler and
// other non-request paths; kept runtime-agnostic like the rest of src/lib/i18n.

import { createAdminClient } from '@/utils/supabase/admin'

const DEFAULT_LOCALE = 'en'
const VALID = new Set(['en', 'ko', 'ja'])

/**
 * Resolve a user's stored UI locale from `profiles.locale` for paths WITHOUT a request
 * (MCP tools, cron). Best-effort: any failure (unmigrated column, missing profile, no
 * admin client) degrades to the app default. Never throws.
 */
export async function resolveUserLocale(userId?: string | null): Promise<string> {
  if (!userId) return DEFAULT_LOCALE
  try {
    const admin = createAdminClient()
    if (!admin) return DEFAULT_LOCALE
    const { data } = await admin
      .from('profiles')
      .select('locale')
      .eq('id', userId)
      .limit(1)
    const loc = (data?.[0] as { locale?: string | null } | undefined)?.locale
    return loc && VALID.has(loc) ? loc : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * Org-level locale for cron/notification paths that send ONE message to the whole org
 * (alerts, weekly digest): the owner's stored locale. Best-effort → default. This is a
 * deliberate simplification over per-recipient locale (org admins usually share a language);
 * a per-recipient loop can refine it later without changing callers.
 */
export async function resolveOrgLocale(orgId?: string | null): Promise<string> {
  if (!orgId) return DEFAULT_LOCALE
  try {
    const admin = createAdminClient()
    if (!admin) return DEFAULT_LOCALE
    const { data } = await admin
      .from('organization_members')
      .select('role, profiles(locale)')
      .eq('org_id', orgId)
      .eq('role', 'owner')
      .limit(1)
    const loc = (data?.[0] as { profiles?: { locale?: string | null } | null } | undefined)?.profiles
      ?.locale
    return loc && VALID.has(loc) ? loc : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}
