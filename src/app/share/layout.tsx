import { NextIntlClientProvider } from 'next-intl'

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>
}
