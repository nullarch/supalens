// Pure env helpers shared by every Supabase client factory (browser, server, middleware, admin).
// No imports: this file is bundled into the edge middleware and the Trigger.dev tasks too.

/**
 * The Supabase URL SERVER code should call. In the bundled self-hosted stack the browser reaches
 * Supabase through the public origin while the web server reaches it on the Docker network
 * (SUPABASE_INTERNAL_URL) — it must not depend on its own public address resolving from inside
 * the container. Everywhere else this is simply NEXT_PUBLIC_SUPABASE_URL.
 */
export function serverSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
}

/**
 * @supabase/ssr derives the session cookie name from the Supabase URL's host. When the browser
 * and the server use different URLs they would look for different cookies, so a fixed name
 * (NEXT_PUBLIC_SUPABASE_COOKIE_NAME, inlined at build) keeps them on the same one.
 */
export function authCookieOptions(): { name: string } | undefined {
  const name = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME
  return name ? { name } : undefined
}
