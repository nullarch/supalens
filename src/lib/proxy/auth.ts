// NOT `import 'server-only'` — shared with route handlers and (potentially) the
// Trigger.dev runtime, same convention as lib/paddle/*. Uses the service-role
// client only; never import from client components.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProxyPartner {
  id: string
  name: string
  code: string
  api_key: string
  api_key_previous: string | null
  api_secret: string
  callback_url: string | null
  allowed_origins: string[]
  is_test: boolean
  is_active: boolean
}

/**
 * Authenticate a partner from the X-API-Key header. Accepts the current key OR the
 * previous key (rotation window: partner deploys the new key at their own pace, then
 * ops clears api_key_previous). Inactive partners never authenticate.
 */
export async function authenticatePartner(admin: SupabaseClient, req: Request): Promise<ProxyPartner | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null
  const current = await admin.from('proxy_partners').select('*').eq('api_key', apiKey).eq('is_active', true).limit(1)
  let partner = current.data?.[0] as ProxyPartner | undefined
  if (!partner) {
    const previous = await admin
      .from('proxy_partners')
      .select('*')
      .eq('api_key_previous', apiKey)
      .eq('is_active', true)
      .limit(1)
    partner = previous.data?.[0] as ProxyPartner | undefined
  }
  return partner ?? null
}

/**
 * Exact-origin allowlist check for partner-supplied redirect URLs (open-redirect
 * guard — the checkout page redirects the buyer's browser to these). Test partners
 * may additionally use http://localhost[:port] for local dev.
 */
export function isAllowedReturnUrl(partner: Pick<ProxyPartner, 'allowed_origins' | 'is_test'>, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (partner.allowed_origins.includes(parsed.origin)) {
    // https required for real partners; a listed http origin only works for test partners
    return parsed.protocol === 'https:' || (partner.is_test && parsed.protocol === 'http:')
  }
  if (partner.is_test && parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return true
  }
  return false
}

/** Standard proxy-API error body ({error} code string, mirroring the one-off payment proxy contract). */
export function proxyError(status: number, code: string, detail?: string): Response {
  return Response.json(detail ? { error: code, detail } : { error: code }, { status })
}
