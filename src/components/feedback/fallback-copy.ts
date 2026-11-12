/** Tiny provider-independent copy capsule for a failed root layout. No intl/router IO. */
export const FALLBACK_COPY = {
  en: { title: 'This page could not load', body: 'Try again, or return home to continue. Your last action may not have completed; check its status before repeating it.', retry: 'Try again', home: 'Go to home' },
  ko: { title: '화면을 불러오지 못했습니다', body: '다시 시도하거나 홈으로 이동해 주세요. 마지막 작업이 완료되지 않았을 수 있으니, 반복하기 전에 상태를 확인해 주세요.', retry: '다시 시도', home: '홈으로 이동' },
  ja: { title: 'ページを読み込めませんでした', body: '再試行するか、ホームに戻ってください。直前の操作が完了していない可能性があります。繰り返す前に状態を確認してください。', retry: '再試行', home: 'ホームに戻る' },
} as const
export type FallbackLocale = keyof typeof FALLBACK_COPY

export function fallbackLocale(pathname: string, cookie: string): FallbackLocale {
  const segment = pathname.split('/')[1]
  const choice = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('NEXT_LOCALE='))?.slice(12)
  for (const candidate of [segment, choice]) if (candidate === 'en' || candidate === 'ko' || candidate === 'ja') return candidate
  return 'en'
}

export const fallbackHome = (locale: FallbackLocale) => locale === 'en' ? '/' : `/${locale}`
