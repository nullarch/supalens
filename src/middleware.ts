import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'

import { isSelfHosted } from '@/config/edition'
import { routing } from '@/i18n/routing'
import { resolveAppRequestLocale } from '@/lib/i18n/app-locale-cookie'
import { isSupportedLocale } from '@/lib/i18n/negotiate'
import { applySupabaseSession } from '@/utils/supabase/middleware'

const intlMiddleware = createMiddleware(routing)

// Paths that participate in LOCALE routing (path-prefixed marketing surface):
//   - `/`               → landing (default locale, unprefixed)
//   - `/ko`, `/ja`, `/en` (+ subpaths) → locale-prefixed
//   - `/privacy|terms|refund|docs|demo|supabase` (+ their locale-prefixed forms)
// Everything else — /app, /api, /auth, /dev, /test, /share, /logos, /login,
// .well-known — is NOT locale-routed (it resolves locale from the NEXT_LOCALE
// cookie instead) and must be kept OUT of the intl middleware.
const INTL_PATH = /^\/(ko|ja|en)(\/.*)?$|^\/(privacy|terms|refund|docs|demo|supabase|x)(\/.*)?$|^\/$/

const CLOUD_ONLY_PATH = /^\/(api\/proxy|proxy|api\/xray|api\/demo|api\/paddle|x-card)(\/.*)?$/

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isIntl = INTL_PATH.test(pathname)

  // A self-hosted install is the product only: the marketing site, pricing, public demo,
  // X-ray and the hosted service's legal pages do not exist there. Everything locale-routed
  // lands on the app (which sends a signed-out visitor to /login).
  if (isSelfHosted()) {
    if (isIntl) return NextResponse.redirect(new URL('/app', request.url))
    // Hosted-only machine surfaces: the partner payment gateway and the X-ray share card.
    if (CLOUD_ONLY_PATH.test(pathname)) return new NextResponse(null, { status: 404 })
  }

  // Non-marketing paths (/app, /login, …) never pass through next-intl, so its
  // Accept-Language detection doesn't run — a first-time visitor with no NEXT_LOCALE
  // cookie always fell back to `en` regardless of browser language or stored preference.
  // Seed the cookie here, in priority order: existing cookie (wins, untouched) →
  // signed-in user's profiles.locale → Accept-Language → default.
  //
  // Written to request.cookies BEFORE building the response so THIS render's
  // src/i18n/request.ts reads it (a response-only cookie reaches the next request, not
  // this one), and mirrored onto response.cookies below so it persists for the browser.
  let seededLocale: string | null = null
  if (!isIntl && !isSupportedLocale(request.cookies.get('NEXT_LOCALE')?.value)) {
    seededLocale = await resolveAppRequestLocale(request)
    request.cookies.set('NEXT_LOCALE', seededLocale)
  }

  // intl runs first (produces the rewrite/redirect + NEXT_LOCALE cookie for
  // marketing); for every other path we start from a plain pass-through.
  const response = isIntl ? intlMiddleware(request) : NextResponse.next({ request })

  if (seededLocale) {
    response.cookies.set('NEXT_LOCALE', seededLocale, {
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
    })
  }

  // Then layer the Supabase session refresh onto that same response.
  return applySupabaseSession(request, response)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
