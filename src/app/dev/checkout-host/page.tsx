import { notFound } from 'next/navigation'
import { CheckoutHostPreview } from './CheckoutHostPreview'

export const metadata = { title: 'Checkout host fixtures', robots: { index: false, follow: false } }
const CHECKOUT_HOST_MODES = ['open', 'long', 'loading', 'opening', 'closed', 'completed', 'error', 'undefined', 'open-throw', 'navigation-failed', 'stale'] as const

export default async function CheckoutHostPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'open' } = await searchParams
  if (!(CHECKOUT_HOST_MODES as readonly string[]).includes(mode)) notFound()
  return <CheckoutHostPreview key={mode} mode={mode} />
}
