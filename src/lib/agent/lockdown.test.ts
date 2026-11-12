import { describe, expect, it } from 'vitest'

import { buildChildEnv, LOCKDOWN_DISALLOWED_TOOLS, makeToolGate, PASSTHROUGH_ENV } from './lockdown'
import { ALLOWED_TOOLS as SQL_TOOLS } from './run-analysis'
import { ALLOWED_TOOLS as FIRESTORE_TOOLS } from '@/lib/firestore-agent/run-firestore-analysis'
import { CODE_TOOLS, DB_TOOLS } from '@/lib/code-agent/run-code-analysis'

/**
 * The agent-sandbox lockdown invariants (docs "Security invariants — do not regress").
 * These pin the exact env-replacement and tool-gating behavior every runner
 * (SQL / code / firestore) shares via lockdown.ts.
 */

describe('buildChildEnv — subprocess env replacement', () => {
  const SECRETS = {
    SUPABASE_SERVICE_ROLE_KEY: 'sr-secret',
    KEK_LOCAL_MASTER_KEY: 'kek-secret',
    KEK_GCP_KEY: 'projects/x/keys/y',
    DEMO_DATABASE_URL: 'postgres://demo',
    DATABASE_URL: 'postgres://tenant',
    PADDLE_API_KEY: 'pdl-secret',
    TRIGGER_SECRET_KEY: 'tr-secret',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN RSA-----',
    RESEND_API_KEY: 're-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
  }

  it('forwards ONLY PATH/HOME/ANTHROPIC_API_KEY when no passthrough vars are set', () => {
    const env = buildChildEnv({ PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-ant', ...SECRETS })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-ant' })
  })

  it('never leaks any secret env var, whatever else is set', () => {
    const env = buildChildEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      ANTHROPIC_API_KEY: 'sk-ant',
      HTTPS_PROXY: 'http://proxy:8080',
      ...SECRETS,
    })
    for (const key of Object.keys(SECRETS)) {
      expect(env).not.toHaveProperty(key)
    }
    // every key in the output is either a base key or an explicitly listed passthrough
    const allowed = new Set<string>(['PATH', 'HOME', 'ANTHROPIC_API_KEY', ...PASSTHROUGH_ENV])
    for (const key of Object.keys(env)) {
      expect(allowed.has(key)).toBe(true)
    }
  })

  it('forwards passthrough vars only when present', () => {
    const env = buildChildEnv({ PATH: '/p', ANTHROPIC_BASE_URL: 'https://gw', NO_PROXY: 'localhost' })
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw')
    expect(env.NO_PROXY).toBe('localhost')
    expect(env).not.toHaveProperty('HTTPS_PROXY')
  })

  it('PASSTHROUGH_ENV contains no secret-bearing names (regression pin)', () => {
    // adding a *_KEY / *_SECRET / *_TOKEN-style var here would leak it into the model's
    // subprocess. ANTHROPIC_AUTH_TOKEN is the deliberate exception (the gateway credential
    // that replaces ANTHROPIC_API_KEY, which is already forwarded by design).
    const suspicious = PASSTHROUGH_ENV.filter(
      (k) => k !== 'ANTHROPIC_AUTH_TOKEN' && /(_KEY|_SECRET|_TOKEN|PASSWORD|CREDENTIALS)$/i.test(k),
    )
    expect(suspicious).toEqual([])
  })
})

describe('makeToolGate — canUseTool deny-gate', () => {
  it('allows exactly the allow-listed tools and passes input through', async () => {
    const gate = makeToolGate(SQL_TOOLS)
    const input = { sql: 'select 1' }
    const res = await gate('mcp__supalens__execute_sql', input)
    expect(res).toEqual({ behavior: 'allow', updatedInput: input })
  })

  it('denies every built-in harness tool for every runner profile', async () => {
    for (const profile of [SQL_TOOLS, FIRESTORE_TOOLS, [...CODE_TOOLS, ...DB_TOOLS]]) {
      const gate = makeToolGate(profile)
      for (const tool of LOCKDOWN_DISALLOWED_TOOLS) {
        const res = await gate(tool, {})
        expect(res.behavior).toBe('deny')
      }
    }
  })

  it('denies cross-profile tools (firestore agent cannot run SQL and vice versa)', async () => {
    const fsGate = makeToolGate(FIRESTORE_TOOLS)
    expect((await fsGate('mcp__supalens__execute_sql', {})).behavior).toBe('deny')
    const sqlGate = makeToolGate(SQL_TOOLS)
    expect((await sqlGate('mcp__supalens_firestore__query_documents', {})).behavior).toBe('deny')
  })

  it('denies propose_kpi unless the extraction profile added it', async () => {
    expect((await makeToolGate(SQL_TOOLS)('mcp__supalens__propose_kpi', {})).behavior).toBe('deny')
    expect(
      (await makeToolGate([...SQL_TOOLS, 'mcp__supalens__propose_kpi'])('mcp__supalens__propose_kpi', {})).behavior,
    ).toBe('allow')
  })

  it('denies propose_monitor unless the goal-drafting profile added it', async () => {
    // Security review (goal monitors, 2026-09-27): propose_monitor reads ONLY the in-process result
    // store (like propose_kpi) and hands a draft to the host — it creates nothing. The monitor is
    // created later by the operator's approval through the member-gated createAlert action.
    expect((await makeToolGate(SQL_TOOLS)('mcp__supalens__propose_monitor', {})).behavior).toBe('deny')
    expect(
      (await makeToolGate([...SQL_TOOLS, 'mcp__supalens__propose_monitor'])('mcp__supalens__propose_monitor', {})).behavior,
    ).toBe('allow')
  })

  it('pins the exact allow-lists (a drift here is a deliberate security review, not a refactor)', () => {
    expect(SQL_TOOLS).toEqual([
      'mcp__supalens__execute_sql',
      'mcp__supalens__get_schema',
      'mcp__supalens__propose_visualization',
    ])
    expect(FIRESTORE_TOOLS).toEqual([
      'mcp__supalens_firestore__list_collections',
      'mcp__supalens_firestore__get_collection_schema',
      'mcp__supalens_firestore__query_documents',
      'mcp__supalens_firestore__aggregate',
      'mcp__supalens_firestore__propose_visualization',
    ])
    expect([...CODE_TOOLS, ...DB_TOOLS]).toEqual([
      'mcp__supalens_code__list_files',
      'mcp__supalens_code__read_file',
      'mcp__supalens_code__grep_code',
      'mcp__supalens_code__get_diff',
      'mcp__supalens__execute_sql',
      'mcp__supalens__get_schema',
    ])
    expect(LOCKDOWN_DISALLOWED_TOOLS).toEqual(['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Glob', 'Grep'])
  })
})
