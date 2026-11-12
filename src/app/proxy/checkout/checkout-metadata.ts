import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const t = await getTranslations('proxyCheckout')
  return { title: t('metadataTitle'), robots: { index: false, follow: false } }
}
