'use server'

import { createClient } from '@/utils/supabase/server'
import { routing } from '@/i18n/routing'

/**
 * Persist the signed-in user's locale choice to `profiles.locale` (source of truth for
 * recipient-context paths that have no request — emails, cron alerts; see P3). The cookie
 * (written client-side by the LanguageSwitcher) already drives the live UI; this is the
 * durable copy. Best-effort: a failure (e.g. the column not yet migrated) must never break
 * the language switch, so it degrades silently.
 */
export async function setUserLocale(locale: string): Promise<{ ok: boolean }> {
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    return { ok: false }
  }
  try {
    const supabase = await createClient()
    if (!supabase) return { ok: false }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false }
    // RLS `prof_upd` allows a user to update their own profile row.
    // `locale` column is added in 20260708033606_profiles_locale.sql; the cast bridges
    // until `npm run db:types` regenerates the typed schema post-push (then it can drop).
    const { error } = await supabase
      .from('profiles')
      .update({ locale } as never)
      .eq('id', user.id)
    return { ok: !error }
  } catch {
    return { ok: false }
  }
}
