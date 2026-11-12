import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { consentCopy } from './consent-copy'
import { CONSENT_CSS, CONSENT_THEME_SCRIPT } from './consent-style'
import { CONSENT_HEADERS, escapeConsentHtml, renderConsentDocument, renderConsentError, requestedConsentScopes } from './consent-document'

const fields = { response_type: 'code', client_id: 'sample-id', redirect_uri: 'https://client.example.invalid/callback', code_challenge: 'sample-challenge', code_challenge_method: 'S256', state: '<&"\'>', scope: 'read write', resource: 'https://resource.example.invalid/mcp' }
const copy = consentCopy(key => key, 'sample@example.invalid')

describe('standalone consent presentation', () => {
  it('keeps the original native POST contract and all opaque fields', () => {
    const html = renderConsentDocument({ locale: 'en', copy, clientName: 'Sample', fields })
    expect(html).toContain('<form method="post" aria-label=')
    expect(html).not.toContain('action=')
    for (const [name, value] of Object.entries(fields)) expect(html).toContain(`name="${name}" value="${escapeConsentHtml(value)}"`)
    expect(html).toContain('name="decision" value="approve"')
    expect(html).toContain('name="decision" value="deny"')
    expect(html).not.toContain('LOCAL PREVIEW')
  })
  it('keeps preview transport local and non-mutating', () => {
    const html = renderConsentDocument({ locale: 'en', copy, clientName: 'Sample', fields, preview: true, sampleDecision: 'deny' })
    expect(html).toContain('method="get" action="/dev/entry/consent"')
    expect(html).toContain('Simulated decision: deny.')
  })
  it.each(['<script>bad()</script>', '"><img src=x onerror=bad()>', '& < > " \'', '</title><script>bad()</script>'])('escapes visible copy and field attributes: %s', hostile => {
    const html = renderConsentDocument({ locale: hostile, copy: { ...copy, title: hostile, loggedInAs: hostile }, clientName: hostile, fields: { ...fields, [hostile]: hostile, client_id: hostile } })
    expect(html).toContain('<html lang="en">')
    expect(html).toContain(escapeConsentHtml(hostile))
    expect(html).not.toContain(hostile)
  })
  it.each(['en', 'ko', 'ja'])('sets document language and local home path: %s', locale => {
    const html = renderConsentError({ locale, copy: { title: 'Error', message: 'Sample', hint: 'Retry from client', backHome: 'Home' } })
    expect(html).toContain(`<html lang="${locale}">`)
    expect(html).toContain(`href="${locale === 'en' ? '/' : '/' + locale}"`)
    expect(html).toContain('name="viewport"')
    expect(html).not.toContain('<form')
  })
  it('escapes error messages instead of interpreting provider HTML', () => {
    const html = renderConsentError({ locale: 'en', copy: { title: 'Error', message: '<img src=x onerror=bad()>', hint: 'Retry', backHome: 'Home' } })
    expect(html).toContain('&lt;img src=x onerror=bad()&gt;')
    expect(html).not.toContain('<img')
  })
  it.each([[undefined, ['read', 'write']], ['', ['read', 'write']], ['   ', ['read']], ['read', ['read']], ['write custom:scope read', ['write', 'custom:scope', 'read']]] as const)('shows existing scope defaults without granting/filtering: %s', (scope, expected) => {
    expect(requestedConsentScopes(scope)).toEqual(expected)
  })
  it('does not cache sensitive request documents or send their URL as a referrer', () => {
    expect(CONSENT_HEADERS['Cache-Control']).toBe('no-store')
    expect(CONSENT_HEADERS['Referrer-Policy']).toBe('strict-origin')
    const html = renderConsentDocument({ locale: 'en', copy, clientName: 'Sample', fields })
    expect(html).toContain('<meta name="referrer" content="strict-origin">')
    // the document loads nothing from another origin, so there is no third-party request to leak a referrer to
    expect(html).not.toMatch(/<link[^>]+href="https?:/)
    expect(CONSENT_THEME_SCRIPT).not.toMatch(/fetch|location|submit|sendBeacon/)
  })
})

function palette(css: string, selector: string) {
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2].toLowerCase()]))
}
describe.each(['light', 'dark'])('consent tokens / %s', theme => {
  it('matches the same operational/action tokens as the real app', () => {
    const global = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
    const expected = palette(global, theme === 'light' ? ':root {' : '[data-theme="dark"] {')
    const actual = palette(CONSENT_CSS, theme === 'light' ? ':root {' : ':root[data-theme="dark"] {')
    expect(Object.keys(actual).length).toBe(13)
    for (const [key, value] of Object.entries(actual)) expect(value, key).toBe(expected[key])
  })
})
