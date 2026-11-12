import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import '@/app/app/dashboard.css'
import { AppSurface } from '@/components/dashboard/AppSurface'
import s from '@/app/app/business-model/business-model.module.css'
import { parseSupalensMd } from '@/lib/context/parse'
import { BASELINE_TIER, REPO_TIER } from '@/lib/context/__fixtures__/supalens-md'
import { PageHead } from '@/components/dashboard/PageHead'
import { StateDot, TierChip } from '@/app/app/business-model/Bits'
import type { ContextState } from '@/app/app/business-model/data'
import { DevThemeToggle } from '../modals/DevThemeToggle'
import { ContextPreview } from './ContextPreview'
import { BusinessModelIndex } from '@/app/app/business-model/BusinessModelIndex'
import type { BusinessModelRow } from '@/app/app/business-model/data'

export default async function DevBusinessModelPage({ searchParams }: { searchParams: Promise<{ mode?: string; view?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'stale', view = 'detail' } = await searchParams
  if (!['fresh', 'stale', 'generating', 'failed', 'none', 'long', 'invalid-time', 'success', 'failure', 'throw', 'limit', 'quota', 'running', 'malformed'].includes(mode)) notFound()
  const t = await getTranslations('appBusinessModel')
  const state: ContextState = ['fresh', 'stale', 'generating', 'failed', 'none'].includes(mode) ? mode as ContextState : 'stale'
  if (!['detail', 'index'].includes(view)) notFound()
  if (view === 'index') {
    const rows: BusinessModelRow[] = mode === 'none' ? [] : (['fresh', 'stale', 'generating', 'failed', 'none'] as const).map((status, index) => ({
      id: 'sample-source-' + index, name: mode === 'long' ? 'SampleInternationalBusinessSource_'.repeat(8) : 'Sample source ' + index,
      engine: 'postgres', isDemo: index === 4, repoId: index === 1 ? 'sample-repo' : null,
      state: status, tier: status === 'none' ? null : index === 1 ? 'repo' : 'schema',
      generatedAt: status === 'none' ? null : mode === 'invalid-time' ? 'invalid' : '2026-09-07T12:00:00Z',
      counts: status === 'none' ? null : { entities: 12, rules: 8, metrics: 3, gotchas: 2 },
    }))
    return <AppSurface><main style={{ padding: 'clamp(32px, 5vw, 48px) clamp(20px, 3.4vw, 36px) 80px', maxWidth: 1096, margin: '0 auto' }}><DevThemeToggle /><p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Sample source list · No account writes.</p><BusinessModelIndex rows={rows} /></main></AppSurface>
  }
  return <AppSurface><main style={{ padding: 'clamp(32px, 5vw, 48px) clamp(20px, 3.4vw, 36px) 80px', maxWidth: 1096, margin: '0 auto' }}>
    <DevThemeToggle />
    <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Sample documents · Local responses only. No generation, database or account writes.</p>
    {[REPO_TIER, BASELINE_TIER].map((document, index) => {
      const parsed = parseSupalensMd(mode === 'none' ? '' : document)
      if (mode === 'long') {
        parsed.overview = 'Sample context description. '.repeat(20)
        parsed.entities.push({ name: 'InternationalBusinessConcept_'.repeat(6), table: 'sample_schema.sample_table_'.repeat(8), description: 'SampleEntityDescription_'.repeat(20) })
        parsed.rules.push({ section: 'filters', text: 'SampleUnverifiedBusinessRule_'.repeat(18), confidence: 'unconfirmed', evidence: ['sample/very_long_module_name_'.repeat(5) + 'rules.ts:120'] })
        parsed.metrics.push({ name: 'SampleInternationalBusinessMetric_'.repeat(8), definition: 'SampleDefinition_'.repeat(24), sql: 'select ' + 'sample_column_'.repeat(40) })
        parsed.raw += '\n' + 'sample_long_document_line_'.repeat(900)
      }
      return <section key={mode + '-' + index} style={{ marginBottom: 96, minWidth: 0 }}>
        <PageHead title={index ? 'Sample analytics — staging' : 'Sample commerce — production'} subtitle={parsed.title || t('subtitle')} actions={<span className={s.headMeta}><StateDot state={state} label={t('state.' + state)} /><TierChip tier={index ? 'schema' : 'repo'} label={t(index ? 'tier.schema' : 'tier.repo')} /></span>} />
        <ContextPreview mode={mode} sourceId={'sample-context-' + index} parsed={parsed} state={state}
          metricLinks={{ mrr: { status: 'accepted', title: 'MRR' }, refundrate: { status: 'proposed', title: 'Refund rate' } }}
          generatedAt={mode === 'none' ? null : mode === 'invalid-time' ? 'invalid' : '2026-09-07T12:00:00Z'}
          generatedFromSha={index ? null : 'a18f21c9b4e77d10'} schemaHash={mode === 'none' ? null : '9f2c4b71aa03e5d6'}
          model={index ? null : 'sample-model'} error={mode === 'failed' ? 'Sample generation failure; no live request was made.' : null}
          repoName={index ? null : mode === 'long' ? 'sample/repository_'.repeat(20) : 'sample/commerce'} />
      </section>
    })}
  </main></AppSurface>
}
