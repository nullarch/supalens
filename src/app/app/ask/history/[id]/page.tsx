import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { SavedRunView } from '@/components/agent/SavedRunView'

export const dynamic = 'force-dynamic'

/** Read-only view of one past run's persisted answer + charts (RLS-scoped to org members). */
export default async function AskRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('appAsk')
  const supabase = await createClient()
  if (!supabase) return <main style={{ padding: 40 }}>{t('supabaseNotConfigured')}</main>
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/ask/history/${id}`)

  const { data } = await supabase
    .from('agent_runs')
    .select('id, question, status, result, error, created_at, data_sources(name)')
    .eq('id', id)
    .limit(1)
  const run = data?.[0] as
    | {
        question: string
        status: string
        result: { text?: string; visualizations?: unknown[] } | null
        error: string | null
        created_at: string
        data_sources: { name: string | null } | null
      }
    | undefined
  if (!run) notFound()

  return <SavedRunView run={run} />
}
