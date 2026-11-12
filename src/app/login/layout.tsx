import { NextIntlClientProvider } from 'next-intl'

/** Resolve cookie-driven client messages when entering from locale-routed pages.
 * The shared root may still have the messages from before a language change.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>
}
