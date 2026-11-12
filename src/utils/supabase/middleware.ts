import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { authCookieOptions, serverSupabaseUrl } from './env'

// Refresh the Supabase session ON TOP OF an already-built response.
//
// This is the composition seam with next-intl: the intl middleware runs first and
// its response carries a rewrite/redirect + the NEXT_LOCALE cookie. We must LAYER
// the auth cookies onto THAT response, not recreate it — recreating (the old
// `NextResponse.next()` on every setAll) would drop the intl rewrite. So `setAll`
// writes onto the shared `response` passed in.
//
// Returns the (mutated) response, or a redirect for unauthenticated /app requests.
export async function applySupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const url = serverSupabaseUrl()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Skip Supabase session handling if not configured
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // refreshing the auth token + checking the session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // protect the app: unauthenticated requests to /app/* go to /login?next=<path>
  const path = request.nextUrl.pathname
  if (!user && path.startsWith('/app')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

// Back-compat helper for callers that don't pre-build a response.
export async function updateSession(request: NextRequest) {
  return applySupabaseSession(request, NextResponse.next({ request }))
}
