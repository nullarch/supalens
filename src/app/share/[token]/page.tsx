import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createAdminClient } from '@/utils/supabase/admin'
import { SharedAnswer } from '@/components/agent/SharedAnswer'

export const dynamic = 'force-dynamic'

/** Dynamic OG/Twitter tags so a shared link previews nicely on Slack / X / etc. (viral loop). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const admin = createAdminClient()
  const { data } = admin
    ? await admin.from('agent_runs').select('question, result').eq('share_token', token).limit(1)
    : { data: null }
  const run = data?.[0] as { question: string; result: { text?: string } | null } | undefined
  // `/share` is outside INTL_PATH, so the request resolver falls back to the NEXT_LOCALE
  // cookie (en for a first-time visitor) — right for an unlisted link with no locale segment.
  const t = await getTranslations('share')
  const title = run ? `${run.question} · Supalens` : t('metaTitle')
  const description = (run?.result?.text ?? t('metaDescription')).trim().slice(0, 160)
  return {
    title,
    description,
    // Shared answers are unlisted: reachable by the unguessable token, never indexed.
    robots: { index: false, follow: false },
    // og:image / twitter:image are wired automatically by the sibling opengraph-image.tsx.
    openGraph: { title, description, type: 'article', siteName: 'Supalens' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Public page for a shared analysis answer. Reads ONLY the run with this exact share_token
 *  (unguessable); no auth, no other org data. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  if (!admin) notFound()

  const { data } = await admin
    .from('agent_runs')
    .select('question, result')
    .eq('share_token', token)
    .limit(1)
  const run = data?.[0] as
    | { question: string; result: { text?: string; visualizations?: unknown[] } | null }
    | undefined
  if (!run) notFound()

  return <SharedAnswer question={run.question} result={run.result} />
}
