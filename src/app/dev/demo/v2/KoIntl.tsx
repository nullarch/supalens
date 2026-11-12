'use client'

import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'

import messages from '../../../../../messages/ko.json'

// /dev has no NEXT_LOCALE cookie, so the root provider resolves to `en` — which makes the
// REAL WidgetRenderer format values the English way (₩856.3M, "Jun 23"). This variation mocks
// the KOREAN demo page, so we nest a ko provider around the preview: setVizLocale(useLocale())
// then yields ₩8.6억 / 6월 23일, exactly like the shipped ko page. Dev-only; bundling the full
// ko catalog client-side is fine here.
export function KoIntl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  )
}
