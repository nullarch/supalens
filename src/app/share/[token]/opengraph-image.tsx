import { getLocale } from 'next-intl/server'

import { shareImageLocale, shareImageMetadata } from '@/lib/share/image-copy'
import { createAdminClient } from '@/utils/supabase/admin'

export const runtime = 'nodejs'

export async function generateImageMetadata() {
  // Every stable ID remains valid even for crawlers without the visitor's cookie.
  return shareImageMetadata(await getLocale())
}

export default async function Image({ params, id }: { params: Promise<{ token: string }>; id: string }) {
  const { token } = await params
  const admin = createAdminClient()
  const { data } = admin
    ? await admin.from('agent_runs').select('question, result').eq('share_token', token).limit(1)
    : { data: null }
  const run = data?.[0] as { question: string; result: { text?: string } | null } | undefined

  // Page metadata needs only copy/IDs, not the native renderer or its WASM.
  const { renderShareImage } = await import('@/lib/share/image-renderer')
  const bytes = await renderShareImage({ locale: shareImageLocale(id), question: run?.question, answer: run?.result?.text })
  return new Response(new Uint8Array(bytes), { headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  } })
}
