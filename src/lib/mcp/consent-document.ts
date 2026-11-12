import { CONSENT_CSS, CONSENT_THEME_SCRIPT } from './consent-style'

export interface ConsentCopy {
  title: string; description: string; clientLabel: string; clientIdLabel: string; returnTo: string
  permissions: string; scopeNote: string; accessNote: string; confirmNote: string
  approve: string; deny: string; loggedInAs: string; backHome: string
}
export interface ConsentErrorCopy { title: string; message: string; hint: string; backHome: string }

export const CONSENT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin',
} as const

export const escapeConsentHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Presentation of the existing POST default only; this does not compute a grant. */
export function requestedConsentScopes(scope?: string) {
  const scopes = (scope || 'read write').split(/\s+/).filter(Boolean)
  return scopes.length ? scopes : ['read']
}

function documentShell(locale: string, title: string, backHome: string, content: string) {
  const lang = ['en', 'ko', 'ja'].includes(locale) ? locale : 'en'
  const home = lang === 'en' ? '/' : `/${lang}`
  // Same native three-circle mark as components/brand/LogoMark; not a new logo.
  const mark = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="28" r="13" fill="currentColor"/><circle cx="35" cy="15" r="7.5" fill="var(--brand)"/><circle cx="38" cy="34" r="3.6" fill="currentColor" opacity=".5"/></svg>'
  // strict-origin omits request parameters without turning native POST Origin into null.
  // No external font: this standalone document uses the system sans stack.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="strict-origin"><title>${escapeConsentHtml(title)} · Supalens</title><script>${CONSENT_THEME_SCRIPT}</script><style>${CONSENT_CSS}</style></head><body><main class="page"><a class="brand" href="${home}" aria-label="${escapeConsentHtml(backHome)}">${mark}<span>supalens</span></a>${content}</main></body></html>`
}

export function renderConsentDocument({ locale, copy, clientName, fields, preview = false, sampleDecision }: {
  locale: string; copy: ConsentCopy; clientName: string; fields: Readonly<Record<string, string>>
  preview?: boolean; sampleDecision?: 'approve' | 'deny'
}) {
  const esc = escapeConsentHtml
  const hidden = Object.entries(fields).map(([key, value]) => `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`).join('')
  const scopes = requestedConsentScopes(fields.scope).map(scope => `<li><code>${esc(scope)}</code></li>`).join('')
  const previewNote = preview ? `<p class="preview"${sampleDecision ? ' role="status"' : ''}>LOCAL PREVIEW · Sample data only. No authorization or client redirect.${sampleDecision ? ` Simulated decision: ${esc(sampleDecision)}.` : ''}</p>` : ''
  return documentShell(locale, copy.title, copy.backHome, `${previewNote}<article class="card" aria-labelledby="consent-title">
    <h1 id="consent-title">${esc(copy.title)}</h1><p class="description">${esc(copy.description)}</p>
    <section class="request" aria-labelledby="client-heading"><h2 id="client-heading">${esc(copy.clientLabel)}</h2><p class="client-name"><bdi>${esc(clientName)}</bdi></p>
      <dl><div><dt>${esc(copy.clientIdLabel)}</dt><dd><code dir="ltr">${esc(fields.client_id ?? '')}</code></dd></div><div><dt>${esc(copy.returnTo)}</dt><dd><code dir="ltr">${esc(fields.redirect_uri ?? '')}</code></dd></div></dl>
    </section>
    <section class="scope-section" aria-labelledby="scope-heading"><h2 id="scope-heading">${esc(copy.permissions)}</h2><ul class="scopes">${scopes}</ul><p class="note">${esc(copy.scopeNote)}</p><p class="note">${esc(copy.accessNote)}</p></section>
    <p class="account">${esc(copy.loggedInAs)}</p>
    <form method="${preview ? 'get' : 'post'}"${preview ? ' action="/dev/entry/consent"' : ''} aria-label="${esc(copy.title)}"><div class="actions">${hidden}<button class="approve" type="submit" name="decision" value="approve">${esc(copy.approve)}</button><button class="deny" type="submit" name="decision" value="deny">${esc(copy.deny)}</button></div></form>
    <p class="note">${esc(copy.confirmNote)}</p>
  </article>`)
}

export function renderConsentError({ locale, copy, preview = false }: { locale: string; copy: ConsentErrorCopy; preview?: boolean }) {
  const esc = escapeConsentHtml
  const home = ['ko', 'ja'].includes(locale) ? `/${locale}` : '/'
  return documentShell(locale, copy.title, copy.backHome, `${preview ? '<p class="preview">LOCAL PREVIEW · Sample data only. No authentication or authorization performed.</p>' : ''}<article class="card" aria-labelledby="consent-title"><h1 id="consent-title">${esc(copy.title)}</h1><p class="error" role="alert">${esc(copy.message)}</p><p class="note">${esc(copy.hint)}</p><a class="button error-action" href="${home}">${esc(copy.backHome)}</a></article>`)
}
