import { describe, expect, it } from 'vitest'

import {
  guessEnvironment,
  mergeProjectStates,
  sortProjectChoices,
  type DataSourceRowForProject,
} from './supabase-projects'
import type { SupabaseProject } from '@/lib/supabase-management/client'

const project = (id: string, name: string, status = 'ACTIVE_HEALTHY'): SupabaseProject => ({
  id,
  organization_id: 'org',
  name,
  region: 'ap-northeast-2',
  status,
})

const row = (over: Partial<DataSourceRowForProject> & { ref: string }): DataSourceRowForProject => ({
  id: over.id ?? `ds-${over.ref}`,
  status: over.status ?? 'active',
  last_error_code: over.last_error_code ?? null,
  config: { project_ref: over.ref },
})

describe('guessEnvironment', () => {
  it('reads production markers as production', () => {
    expect(guessEnvironment('my-app-prod')).toBe('production')
    expect(guessEnvironment('Acme Production')).toBe('production')
    expect(guessEnvironment('live_db')).toBe('production')
  })

  it('reads staging markers as staging', () => {
    expect(guessEnvironment('app-staging')).toBe('staging')
    expect(guessEnvironment('dev')).toBe('staging')
    expect(guessEnvironment('acme_qa_2')).toBe('staging')
  })

  it('never matches a marker inside a longer word', () => {
    expect(guessEnvironment('producer-events')).toBe('unknown')
    expect(guessEnvironment('devotion')).toBe('unknown')
    expect(guessEnvironment('liverpool')).toBe('unknown')
  })

  it('falls back to unknown, and production wins a mixed name', () => {
    expect(guessEnvironment('supalens')).toBe('unknown')
    expect(guessEnvironment('prod-restore-test')).toBe('production')
  })
})

describe('mergeProjectStates', () => {
  const projects = [project('a', 'acme-prod'), project('b', 'acme-staging'), project('c', 'paused', 'INACTIVE')]

  it('marks an unprovisioned project as none with only the authorized stage', () => {
    const [a] = mergeProjectStates([projects[0]], [])
    expect(a.state).toBe('none')
    expect(a.dataSourceId).toBeNull()
    expect(a.stages).toEqual({ authorized: true, roleCreated: false, schemaScanned: false })
  })

  it('reports roleCreated only once the data source went active', () => {
    const pending = mergeProjectStates([projects[0]], [row({ ref: 'a', status: 'pending' })])[0]
    expect(pending.state).toBe('pending')
    expect(pending.stages.roleCreated).toBe(false)

    const active = mergeProjectStates([projects[0]], [row({ ref: 'a' })])[0]
    expect(active.state).toBe('active')
    expect(active.stages.roleCreated).toBe(true)
  })

  it('reports schemaScanned only for sources with a fresh introspection cache', () => {
    const rows = [row({ ref: 'a', id: 'ds-a' })]
    expect(mergeProjectStates([projects[0]], rows).at(0)?.stages.schemaScanned).toBe(false)
    expect(mergeProjectStates([projects[0]], rows, new Set(['ds-a'])).at(0)?.stages.schemaScanned).toBe(true)
  })

  it('surfaces the failure code of an errored row', () => {
    const [a] = mergeProjectStates(
      [projects[0]],
      [row({ ref: 'a', status: 'error', last_error_code: 'mint_readonly_role_failed' })],
    )
    expect(a.state).toBe('error')
    expect(a.errorCode).toBe('mint_readonly_role_failed')
  })

  it('flags a non-ACTIVE_HEALTHY project as not bootstrappable', () => {
    const [c] = mergeProjectStates([projects[2]], [])
    expect(c.bootstrappable).toBe(false)
  })

  it('ignores rows whose config carries no project_ref', () => {
    const orphan: DataSourceRowForProject = { id: 'x', status: 'active', last_error_code: null, config: {} }
    expect(mergeProjectStates([projects[0]], [orphan])[0].state).toBe('none')
  })
})

describe('sortProjectChoices', () => {
  it('puts bootstrappable production first and paused projects last', () => {
    const merged = mergeProjectStates(
      [project('b', 'acme-staging'), project('c', 'paused-prod', 'INACTIVE'), project('a', 'acme-prod')],
      [],
    )
    expect(sortProjectChoices(merged).map((p) => p.ref)).toEqual(['a', 'b', 'c'])
  })
})
