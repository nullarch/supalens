import { describe, expect, it, vi } from 'vitest'
import { common, elements, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'
import { homeChecklistCoversOnboarding } from '@/lib/onboarding/logic'

describe('actual Ask and saved/share entry assembly, no provisioning or query IO', () => {
  for (const showWizard of [true, false]) {
    it(`Ask retains source provenance and tour inputs, and carries NO setup guide (${showWizard})`, async () => {
      const { client } = localClient({ data_sources: [
        { id: 'real', name: 'Production', engine: 'postgres', provider: 'supabase', repo_id: 'repo-a', is_demo: false },
        { id: 'demo', name: 'Sample', engine: 'postgres', provider: 'neon', repo_id: null, is_demo: true },
      ], data_source_context: [{ data_source_id: 'real', source_repo_id: 'repo-a' }, { data_source_id: 'demo', source_repo_id: null }] })
      const ensureDemo = vi.fn(async () => {})
      const spec = { type: 'sample-spec' }
      const page = loadRoute('app/ask/page.tsx', {
        ...common, 'next/link': 'Link', './ask.module.css': {}, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' }, '@/lib/data-sources/demo': { ensureDemoSource: ensureDemo },
        '@/lib/onboarding/logic': { shouldShowWizard: () => showWizard, wizardMode: () => 'tour', homeChecklistCoversOnboarding },
        '@/lib/onboarding/wizard-specs': { wizardSpec: () => spec },
        '@/components/agent/AnalyzeClient': { AnalyzeClient: 'AnalyzeClient' }, '@/components/agent/AskEmptyState': { AskEmptyState: 'AskEmptyState' },
        '@/components/onboarding/OnboardingWizard': { OnboardingWizard: 'OnboardingWizard' },
      })
      const tree = await page.default({ searchParams: Promise.resolve({ wizard: 'resume' }) })
      expect(ensureDemo).toHaveBeenCalledExactlyOnceWith('org-a')
      expect(oneElement(tree, 'AnalyzeClient').props.dataSources).toEqual([
        { id: 'real', name: 'Production', engine: 'postgres', provider: 'supabase', context: 'code', isDemo: false, hasRepo: true },
        { id: 'demo', name: 'Sample', engine: 'postgres', provider: 'neon', context: 'schema', isDemo: true, hasRepo: false },
      ])
      expect(elements(tree, 'OnboardingWizard')).toHaveLength(showWizard ? 1 : 0)
      expect(elements(tree, 'AskEmptyState')).toHaveLength(0)
      if (showWizard) expect(oneElement(tree, 'OnboardingWizard').props).toMatchObject({ resume: true, realSources: [{ id: 'real', name: 'Production' }], userId: 'user-a', sampleSpecs: [spec, spec, spec] })
      // PIN: the setup guide lives on the home screen ONLY — Ask must not grow a second one.
      expect(oneElement(tree, 'AnalyzeClient').props.children).toBeUndefined()
    })
  }
  for (const role of ['owner', 'member']) {
    it(`nothing connected: the home checklist replaces the full wizard for those who can connect (${role})`, async () => {
      const { client } = localClient({
        data_sources: [{ id: 'demo', name: 'Sample', engine: 'postgres', provider: 'neon', repo_id: null, is_demo: true }],
        organization_members: [{ role }],
      })
      const page = loadRoute('app/ask/page.tsx', {
        ...common, 'next/link': 'Link', './ask.module.css': {}, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' }, '@/lib/data-sources/demo': { ensureDemoSource: async () => {} },
        '@/lib/onboarding/logic': { shouldShowWizard: () => true, wizardMode: () => 'full', homeChecklistCoversOnboarding },
        '@/lib/onboarding/wizard-specs': { wizardSpec: () => ({}) },
        '@/components/agent/AnalyzeClient': { AnalyzeClient: 'AnalyzeClient' }, '@/components/agent/AskEmptyState': { AskEmptyState: 'AskEmptyState' },
        '@/components/onboarding/OnboardingWizard': { OnboardingWizard: 'OnboardingWizard' },
      })
      const tree = await page.default({ searchParams: Promise.resolve({}) })
      expect(elements(tree, 'OnboardingWizard')).toHaveLength(role === 'owner' ? 0 : 1)
    })
  }
  it('zero sources renders the actual empty-state component without a fake composer source', async () => {
    const { client } = localClient()
    const page = loadRoute('app/ask/page.tsx', {
      ...common, 'next/link': 'Link', './ask.module.css': {}, '@/utils/supabase/server': { createClient: async () => client },
      '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' }, '@/lib/data-sources/demo': { ensureDemoSource: async () => {} },
      '@/lib/onboarding/logic': { shouldShowWizard: () => false, homeChecklistCoversOnboarding },
      '@/lib/onboarding/wizard-specs': {}, '@/components/agent/AnalyzeClient': { AnalyzeClient: 'AnalyzeClient' },
      '@/components/agent/AskEmptyState': { AskEmptyState: 'AskEmptyState' },
      '@/components/onboarding/OnboardingWizard': {},
    })
    const tree = await page.default({ searchParams: Promise.resolve({}) })
    expect(elements(tree, 'AskEmptyState')).toHaveLength(1)
    expect(elements(tree, 'AnalyzeClient')).toHaveLength(0)
  })
  for (const found of [true, false]) {
    it(`saved detail preserves the exact stored run or returns not-found (${found})`, async () => {
      const run = { question: 'Sample', status: 'failed', result: { text: 'Persisted partial text' }, error: 'Stored error', created_at: '2026-09-08T00:00:00Z' }
      const { client, calls } = localClient({ agent_runs: found ? [run] : [] })
      const page = loadRoute('app/ask/history/[id]/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client }, '@/components/agent/SavedRunView': { SavedRunView: 'SavedRunView' },
      })
      const result = page.default({ params: Promise.resolve({ id: 'run-a' }) })
      if (found) expect(oneElement(await result, 'SavedRunView').props.run).toBe(run)
      else await expect(result).rejects.toThrow('NOT_FOUND')
      expect(calls).toContainEqual(['agent_runs', 'eq', 'id', 'run-a'])
    })
  }
  for (const mode of ['found', 'missing', 'unconfigured']) {
    it(`shared answer keeps token-scoped read and stored content (${mode})`, async () => {
      const run = { question: 'Sample', result: { text: 'Stored answer', visualizations: [{ type: 'sample' }] } }
      const { client, calls } = localClient({ agent_runs: mode === 'found' ? [run] : [] })
      const page = loadRoute('share/[token]/page.tsx', {
        ...common, '@/utils/supabase/admin': { createAdminClient: () => mode === 'unconfigured' ? null : client },
        '@/components/agent/SharedAnswer': { SharedAnswer: 'SharedAnswer' },
      })
      const result = page.default({ params: Promise.resolve({ token: 'local-sample-token' }) })
      if (mode === 'found') expect(oneElement(await result, 'SharedAnswer').props).toEqual(run)
      else await expect(result).rejects.toThrow('NOT_FOUND')
      if (mode === 'unconfigured') expect(client.from).not.toHaveBeenCalled()
      else expect(calls).toEqual([
        ['agent_runs', 'select', 'question, result'], ['agent_runs', 'eq', 'share_token', 'local-sample-token'], ['agent_runs', 'limit', 1],
      ])
    })
  }
})
