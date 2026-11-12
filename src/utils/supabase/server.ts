import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { authCookieOptions, serverSupabaseUrl } from './env'

export async function createClient() {
  const url = serverSupabaseUrl()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return null
  }

  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}