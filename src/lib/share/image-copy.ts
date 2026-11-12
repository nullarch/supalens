export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 }
export const SHARE_IMAGE_LOCALES = ['en', 'ko', 'ja'] as const
export type ShareImageLocale = (typeof SHARE_IMAGE_LOCALES)[number]

// Image URLs carry the locale explicitly: crawlers do not share visitor cookies.
export const SHARE_IMAGE_COPY = {
  en: {
    alt: 'Shared analysis · Supalens', label: 'SHARED ANALYSIS',
    question: 'A clearer view of your data.',
    answer: 'Ask your database in plain language with Supalens.',
    excerpt: 'Answer excerpt · open the shared link for context',
  },
  ko: {
    alt: '공유된 분석 · Supalens', label: '공유된 분석',
    question: '데이터를 더 명확하게 이해하세요.',
    answer: 'Supalens에서 자연어로 데이터베이스에 질문하세요.',
    excerpt: '답변 발췌 · 전체 맥락은 공유 링크에서 확인하세요',
  },
  ja: {
    alt: '共有された分析 · Supalens', label: '共有された分析',
    question: 'データをもっと明確に。',
    answer: 'Supalensでデータベースに自然な言葉で質問できます。',
    excerpt: '回答の抜粋 · 詳細は共有リンクで確認できます',
  },
} as const

export function shareImageLocale(value: unknown): ShareImageLocale {
  return value === 'ko' || value === 'ja' ? value : 'en'
}

export function shareImageMetadata(preferred: unknown) {
  const first = shareImageLocale(preferred)
  return [first, ...SHARE_IMAGE_LOCALES.filter(locale => locale !== first)].map(id => ({
    id, alt: SHARE_IMAGE_COPY[id].alt, size: SHARE_IMAGE_SIZE, contentType: 'image/png',
  }))
}

/** Bound image work and never split a grapheme. The page retains full content. */
export function imageExcerpt(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  let result = ''
  let count = 0
  const normalized = value.replace(/\s+/gu, ' ').trim()
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized)
  for (const { segment } of segments) {
    if (count >= maximum) return `${result.trimEnd()}…`
    result += segment
    count++
  }
  return result || fallback
}
