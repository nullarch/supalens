import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createElement as h, type CSSProperties } from 'react'
import satori, { type Font, type SatoriOptions } from 'satori'
import { Resvg } from '@resvg/resvg-js'

import { imageExcerpt, SHARE_IMAGE_COPY, SHARE_IMAGE_SIZE, type ShareImageLocale } from './image-copy'

// Standalone raster surface: mirror the app's neutral light tokens.
export const SHARE_IMAGE_COLORS = {
  paper: '#fbfcfc', ink: '#191c20', muted: '#5e646d', brand: '#b94d32', line: '#e2e5e8',
} as const

let fontPromise: Promise<Font[]> | undefined
/** Shared with the X-ray card renderer (lib/xray/card.ts): same bundled Noto files, one cache. */
export function loadFonts(): Promise<Font[]> {
  if (!fontPromise) {
    const regional = (['KR', 'JP'] as const).flatMap(region =>
      ([400, 700] as const).map(async weight => ({
        name: `Noto${region}`, weight, style: 'normal' as const,
        data: await readFile(join(process.cwd(), 'assets/fonts/share', `NotoSans${region}-${weight === 700 ? 'Bold' : 'Regular'}.otf`)),
      })),
    )
    fontPromise = Promise.all([...regional, readFile(join(process.cwd(), 'assets/fonts/share/NotoEmoji-Regular.ttf')).then(data => ({
      name: 'NotoEmoji', weight: 400 as const, style: 'normal' as const, data,
    }))]).catch(error => {
      fontPromise = undefined
      throw error
    })
  }
  return fontPromise
}

type ImageInput = { locale: ShareImageLocale; question?: unknown; answer?: unknown }
type TextStyle = CSSProperties & { lineClamp?: number }

export async function renderShareImageSvg(input: ImageInput, onNodeDetected?: SatoriOptions['onNodeDetected']) {
  const copy = SHARE_IMAGE_COPY[input.locale]
  const colors = SHARE_IMAGE_COLORS
  const text = (key: string, content: string, style: TextStyle) => h('div', { key, style }, content)
  const document = h('div', { style: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    padding: '48px 64px', background: colors.paper, color: colors.ink,
    fontFamily: input.locale === 'ja' ? 'NotoJP, NotoKR, NotoEmoji' : 'NotoKR, NotoJP, NotoEmoji',
    fontSize: 24, fontWeight: 400,
  } },
  h('div', { key: 'header', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 48, flexShrink: 0 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h('svg', { width: 44, height: 44, viewBox: '0 0 48 48' },
        h('circle', { cx: 18, cy: 28, r: 13, fill: colors.ink }),
        h('circle', { cx: 35, cy: 15, r: 7.5, fill: colors.brand }),
        h('circle', { cx: 38, cy: 34, r: 3.6, fill: colors.ink, opacity: 0.5 }),
      ),
      text('wordmark', 'supalens', { fontSize: 32, fontWeight: 700, letterSpacing: -1 }),
    ),
    text('signature', 'Business signals. Clear answers.', { fontSize: 19, color: colors.muted }),
  ),
  text('label', copy.label, { color: colors.brand, fontSize: 18, fontWeight: 700, letterSpacing: 1.2, marginTop: 32, marginBottom: 14 }),
  text('question', imageExcerpt(input.question, copy.question, 180), {
    display: 'block', fontSize: 44, fontWeight: 700, lineHeight: 1.25,
    lineClamp: 3, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word',
    height: 166, flexShrink: 0, letterSpacing: -0.8,
  }),
  text('answer', imageExcerpt(input.answer, copy.answer, 240), {
    display: 'block', fontSize: 25, lineHeight: 1.5, color: colors.muted,
    lineClamp: 2, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word',
    height: 76, flexShrink: 0, marginTop: 16,
  }),
  h('div', { key: 'footer', style: {
    marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 20, borderTop: `1px solid ${colors.line}`, fontSize: 18, color: colors.muted,
  } }, text('excerpt', copy.excerpt, {}), text('brand', 'SUPALENS / SHARED', { fontSize: 15, letterSpacing: 1 })),
  )

  // next/og's bundled fallback loader can send missing customer glyphs to
  // Google Fonts even with local fonts. No remote images or asset loader here.
  return satori(document, { ...SHARE_IMAGE_SIZE, fonts: await loadFonts(), embedFont: true, onNodeDetected })
}

export async function renderShareImage(input: ImageInput) {
  const svg = await renderShareImageSvg(input)
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()
}
