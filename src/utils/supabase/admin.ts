// NOTE: intentionally NOT `import 'server-only'` — this module is shared with the
// Trigger.dev agent runtime (a plain Node bundle where the server-only guard throws).
// It is safe regardless: it requires SUPABASE_SERVICE_ROLE_KEY (a server-only env var
// never exposed to the browser), so it is inert if ever bundled client-side. Keep client
// components from importing it via the ESLint no-restricted-imports rule.
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

import { serverSupabaseUrl } from './env'

/**
 * Service-role Supabase client (BYPASSRLS).
 *
 * Use ONLY in trusted server code (server actions, route handlers, workers) for
 * privileged operations the user JWT cannot perform: the secrets vault, minting
 * data sources, writing the audit log. Never import this from client components.
 *
 * Returns null when env is missing so the app can still boot for local dev.
 */
let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient | null {
  if (cached) return cached

  const url = serverSupabaseUrl()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) return null

  cached = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'supalens-admin' } },
  })
  return cached
}

/** Same as createAdminClient but throws when not configured — for code paths that require it. */
export function requireAdminClient(): SupabaseClient {
  const client = createAdminClient()
  if (!client) {
    throw new Error(
      'Admin Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    )
  }
  return client
}
