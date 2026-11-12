import { getLocale, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { consentCopy } from '@/lib/mcp/consent-copy'
import { CONSENT_HEADERS, renderConsentDocument, renderConsentError } from '@/lib/mcp/consent-document'

export const dynamic = 'force-dynamic'

/** The same document renderer, without getClient/user/grant/auth-code operations.
 * Preview decisions are ordinary GETs back to this local fixture, never POSTs. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') notFound()
  const params = new URL(request.url).searchParams
  const mode = params.get('mode') || 'standard'
  if (!['standard', 'read', 'default', 'whitespace', 'long', 'escaped', 'error', 'expired'].includes(mode)) notFound()
  const locale = await getLocale()
  const t = await getTranslations('oauthConsent')
  if (mode === 'error' || mode === 'expired') return new Response(renderConsentError({ locale, preview: true, copy: {
    title: t('errorTitle'), message: mode === 'expired' ? t('sessionExpired') : '<Sample error> & "untrusted" '.repeat(12),
    hint: t('review.errorHint'), backHome: t('review.backHome'),
  } }), { headers: CONSENT_HEADERS })
  const long = mode === 'long'
  const escaped = mode === 'escaped'
  const clientName = escaped ? '<img src=x onerror="window.__injected=true"> & Sample app' : long ? 'International application 日本語 한국어 '.repeat(12) : 'Northstar Desktop'
  const decision = params.get('decision')
  const fields = {
    mode, response_type: 'code', client_id: long ? 'sample-client-'.repeat(18) : 'sample-client',
    redirect_uri: 'https://client.example.invalid/callback' + (long ? '?context=' + 'sample_context_'.repeat(30) : ''),
    code_challenge: 'sample-challenge-not-a-credential', code_challenge_method: 'S256',
    state: escaped ? 'sample<&"\'state>' : 'sample-state',
    scope: mode === 'read' ? 'read' : mode === 'default' ? '' : mode === 'whitespace' ? '   ' : long ? 'read write ' + 'custom-sample-scope-'.repeat(10) : 'read write',
    resource: 'https://supalens.example.invalid/mcp',
  }
  return new Response(renderConsentDocument({
    locale, copy: consentCopy(t, long ? 'sample-address-'.repeat(5) + '@example.invalid' : 'sample@example.invalid'),
    clientName, fields, preview: true, sampleDecision: decision === 'approve' || decision === 'deny' ? decision : undefined,
  }), { headers: CONSENT_HEADERS })
}
