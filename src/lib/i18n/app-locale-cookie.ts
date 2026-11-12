// NOTE: intentionally NOT `import 'server-only'` — runs inside the edge middleware.
// Uses ONLY the anon (user-JWT) Supabase client — never the service-role admin client —
// so no privileged secret reaches the edge runtime; `profiles.prof_sel` RLS already lets
// a signed-in user read their own row.

import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'

import { routing } from '@/i18n/routing'
import { authCookieOptions, serverSupabaseUrl } from '@/utils/supabase/env'

import { isSupportedLocale, parseAcceptLanguage } from './negotiate'

/**
 * Resolve the locale to SEED for a non-marketing (`/app`, `/login`, …) request that has
 * no NEXT_LOCALE cookie yet. next-intl's Accept-Language detection is gated to the
 * marketing (path-routed) surface, so without this a first-time visitor to `/app` always
 * fell back to `en` regardless of browser language OR stored preference.
 *
 * Priority: signed-in user's `profiles.locale` → Accept-Language header → default locale.
 * (An existing valid cookie is handled by the caller and never reaches here — cookie wins.)
 *
 * MUST be called BEFORE the middleware builds its response, and the result written to
 * `request.cookies`, so the CURRENT render's `src/i18n/request.ts` reads it — a cookie set
 * only on the response would not reach this render, just the next request.
 *
 * Best-effort: any failure (Supabase unconfigured, expired session, unmigrated `locale`
 * column) degrades to the Accept-Language / default result. Never throws.
 */
export async function resolveAppRequestLocale(request: NextRequest): Promise<string> {
  const headerLocale =
    parseAcceptLanguage(request.headers.get('accept-language')) ?? routing.defaultLocale

  const url = serverSupabaseUrl()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return headerLocale

  try {
    // Read-only client: `setAll` is a no-op so it never writes auth cookies — the real
    // session refresh is left to `applySupabaseSession`, which runs after us on the same
    // request. This just reads the current user + their stored locale.
    const supabase = createServerClient(url, key, {
      cookieOptions: authCookieOptions(),
      cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
    })
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return headerLocale

    const { data } = await supabase
      .from('profiles')
      .select('locale')
      .eq('id', user.id)
      .limit(1)
    const stored = (data?.[0] as { locale?: string | null } | undefined)?.locale
    return isSupportedLocale(stored) ? stored : headerLocale
  } catch {
    return headerLocale
  }
}
