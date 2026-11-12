import { afterEach, describe, expect, it, vi } from 'vitest'

import { privateHostsAllowed } from '@/lib/data-sources/ssrf'
import { emailConfigured, emailFrom } from '@/lib/email/resend'
import { connectDatabaseHref } from '@/lib/integrations/types'
import { githubAppConfigured } from '@/lib/github-app/config'
import { supabaseConnectConfigured } from '@/lib/supabase-oauth/config'

afterEach(() => vi.unstubAllEnvs())

const edition = (value: 'cloud' | 'selfhost') => vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', value)

describe('private database hosts', () => {
  it('hosted: blocked unless explicitly allowed', () => {
    edition('cloud')
    vi.stubEnv('ALLOW_PRIVATE_DB_HOSTS', '')
    expect(privateHostsAllowed()).toBe(false)
    vi.stubEnv('ALLOW_PRIVATE_DB_HOSTS', 'true')
    expect(privateHostsAllowed()).toBe(true)
  })

  it('self-hosted: allowed unless explicitly blocked', () => {
    edition('selfhost')
    vi.stubEnv('ALLOW_PRIVATE_DB_HOSTS', '')
    expect(privateHostsAllowed()).toBe(true)
    vi.stubEnv('ALLOW_PRIVATE_DB_HOSTS', 'false')
    expect(privateHostsAllowed()).toBe(false)
  })
})

describe('email transport', () => {
  it('is off with no transport, so the UI never claims email alerts', () => {
    vi.stubEnv('SMTP_URL', '')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', 'Supalens <bi@example.com>')
    expect(emailConfigured()).toBe(false)
  })

  it('needs a from-address as well as a transport', () => {
    vi.stubEnv('SMTP_URL', 'smtp://mail.example.com:587')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('RESEND_FROM_EMAIL', '')
    expect(emailFrom()).toBeNull() // never the resend.dev sender over someone's SMTP server
    expect(emailConfigured()).toBe(false)
    vi.stubEnv('EMAIL_FROM', 'Supalens <bi@example.com>')
    expect(emailConfigured()).toBe(true)
  })
})

describe('optional provider apps', () => {
  it('are off until every value is set', () => {
    for (const name of ['SUPA_CONNECT_CLIENT_ID', 'SUPA_CONNECT_CLIENT_SECRET', 'SUPA_CONNECT_REDIRECT_URI',
      'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET']) vi.stubEnv(name, '')
    expect(supabaseConnectConfigured()).toBe(false)
    expect(githubAppConfigured()).toBe(false)
    vi.stubEnv('SUPA_CONNECT_CLIENT_ID', 'id')
    vi.stubEnv('SUPA_CONNECT_CLIENT_SECRET', 'secret')
    expect(supabaseConnectConfigured()).toBe(false)
    vi.stubEnv('SUPA_CONNECT_REDIRECT_URI', 'https://bi.example.com/api/connect-supabase/callback')
    expect(supabaseConnectConfigured()).toBe(true)
  })

  it('"connect a database" goes to the direct form when there is no OAuth app', () => {
    const base = { github: false, slack: false, email: false }
    expect(connectDatabaseHref({ ...base, supabaseConnect: false })).toBe('/app/sources?connect=postgres')
    expect(connectDatabaseHref({ ...base, supabaseConnect: true })).toBe('/api/connect-supabase/authorize?returnTo=/app/setup')
  })
})
