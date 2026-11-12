import { requestBase } from '@/lib/http/request-base'
import { getLocale, getTranslations } from 'next-intl/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { createAuthCode, getClient } from '@/lib/mcp/oauth'
import { createClient } from '@/utils/supabase/server'
import { CONSENT_HEADERS, renderConsentDocument, renderConsentError } from '@/lib/mcp/consent-document'
import { consentCopy } from '@/lib/mcp/consent-copy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function htmlError(message: string, status = 400) {
  const t = await getTranslations('oauthConsent')
  const key = new Map([
    ['missing client_id', 'review.missingClient'], ['unknown client_id', 'review.unknownClient'],
    ['redirect_uri not registered for this client', 'review.invalidReturn'],
  ]).get(message)
  return new Response(renderConsentError({ locale: await getLocale(), copy: {
    title: t('errorTitle'), message: key ? t(key) : message, hint: t('review.errorHint'), backHome: t('review.backHome'),
  } }), { status, headers: CONSENT_HEADERS })
}

function backToClient(redirectUri: string, params: Record<string, string>) {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  return Response.redirect(url.toString(), 302)
}

interface AuthzParams {
  response_type: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  state: string
  scope: string
  resource: string
}
function read(sp: URLSearchParams): AuthzParams {
  return {
    response_type: sp.get('response_type') ?? '',
    client_id: sp.get('client_id') ?? '',
    redirect_uri: sp.get('redirect_uri') ?? '',
    code_challenge: sp.get('code_challenge') ?? '',
    code_challenge_method: sp.get('code_challenge_method') ?? '',
    state: sp.get('state') ?? '',
    scope: sp.get('scope') ?? '',
    resource: sp.get('resource') ?? '',
  }
}

/** Validate the client + redirect_uri (the only errors we must NOT redirect for). */
async function validateClient(p: AuthzParams): Promise<string | null> {
  if (!p.client_id) return 'missing client_id'
  const client = await getClient(p.client_id)
  if (!client) return 'unknown client_id'
  if (!p.redirect_uri || !client.redirect_uris.includes(p.redirect_uri)) return 'redirect_uri not registered for this client'
  return null
}

/** GET: validate, require a logged-in supalens user, render the consent screen. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = read(url.searchParams)

  const clientErr = await validateClient(p)
  if (clientErr) return await htmlError(clientErr)
  if (p.response_type !== 'code') return backToClient(p.redirect_uri, { error: 'unsupported_response_type', state: p.state })
  if (!p.code_challenge || p.code_challenge_method !== 'S256')
    return backToClient(p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE S256 required', state: p.state })

  const supabase = await createClient()
  const user = supabase ? (await supabase.auth.getUser()).data.user : null
  if (!user) {
    const next = encodeURIComponent(`/api/oauth/authorize${url.search}`)
    return Response.redirect(new URL(`/login?next=${next}`, requestBase(req)).toString(), 302)
  }

  const t = await getTranslations('oauthConsent')
  const client = await getClient(p.client_id)
  return new Response(renderConsentDocument({
    locale: await getLocale(), copy: consentCopy(t, user.email ?? ''),
    clientName: client?.client_name || p.client_id, fields: { ...p },
  }), { headers: CONSENT_HEADERS })
}

/** POST: the consent decision. Approve → issue an auth code and redirect back. */
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text())
  const p = read(form)
  const decision = form.get('decision')

  const clientErr = await validateClient(p)
  if (clientErr) return await htmlError(clientErr)

  const supabase = await createClient()
  const user = supabase ? (await supabase.auth.getUser()).data.user : null
  if (!user) {
    const t = await getTranslations('oauthConsent')
    return await htmlError(t('sessionExpired'), 401)
  }

  if (decision !== 'approve') return backToClient(p.redirect_uri, { error: 'access_denied', state: p.state })

  const orgId = await ensurePrimaryOrg(supabase!, user)
  // Role-gate the granted scope: a viewer must not mint a write-capable token via consent when
  // the sl_-key mint path 403s them (the MCP tool gate re-checks role live, but the token's
  // scopes should reflect the grant honestly). No scope requested defaults to read+write for
  // member+, read-only for viewers.
  const { data: mem } = await supabase!
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (mem?.[0] as { role: string } | undefined)?.role
  const requested = (p.scope || 'read write').split(/\s+/).filter(Boolean)
  const granted = role === 'viewer' ? requested.filter((s) => s !== 'write') : requested
  const code = await createAuthCode({
    clientId: p.client_id,
    orgId,
    userId: user.id,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    scope: granted.join(' ') || 'read',
    resource: p.resource || null,
  })
  return backToClient(p.redirect_uri, { code, state: p.state })
}
