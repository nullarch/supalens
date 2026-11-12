import { createBrowserClient } from '@supabase/ssr'

import { authCookieOptions } from './env'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return null
  }

  return createBrowserClient(url, key, { cookieOptions: authCookieOptions() })
}