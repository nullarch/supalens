import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { LoginPreview } from './LoginPreview'

export const metadata = { title: 'Entry design fixtures', robots: { index: false, follow: false } }
const LOGIN_MODES = ['success', 'failure', 'throw', 'malformed', 'pending', 'retry', 'rate-limit', 'invalid', 'unavailable', 'unconfigured'] as const

export default async function EntryPreview({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'success' } = await searchParams
  if (!(LOGIN_MODES as readonly string[]).includes(mode)) notFound()
  const t = await getTranslations('appAuth')
  return <main style={{ maxWidth: 480, padding: '32px 24px 64px', margin: '0 auto' }}>
    <p style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 24 }}>DESIGN FIXTURE · Local responses only. No sign-in, navigation or email delivery.</p>
    <h1 style={{ fontSize: 28, lineHeight: 1.3, marginBottom: 24 }}>{t('login.title')}</h1>
    <LoginPreview key={mode} mode={mode} />
  </main>
}
