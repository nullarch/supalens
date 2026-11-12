import 'server-only'

// The X-ray share card (Open Graph 1200×630): the grade plate, the headline and the first three
// traps. Findings and the grade only — no numbers, no code. Rendered locally with satori + resvg
// and the bundled Noto fonts (same pipeline as lib/share/image-renderer.ts); no remote assets.
import { createElement as h, type CSSProperties } from 'react'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'

import { loadFonts } from '@/lib/share/image-renderer'
import { displayGrade, type XrayReport } from './schema'

export const XRAY_CARD_SIZE = { width: 1200, height: 630 } as const

const C = {
  plate: '#0f2b84',
  ink: '#ffffff',
  muted: '#c7cdf0',
  soft: '#d9ddf5',
  trap: '#ffb4a8',
  warn: '#ffd98a',
  line: 'rgba(255,255,255,0.25)',
} as const

export interface XrayCardInput {
  fullName: string
  locale: string
  kicker: string
  footer: string
  gradeLabel: string
  statLines: string[]
  report: Pick<XrayReport, 'headline' | 'grade' | 'traps'>
}

type TextStyle = CSSProperties & { lineClamp?: number }

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export async function renderXrayCardSvg(input: XrayCardInput): Promise<string> {
  const text = (key: string, content: string, style: TextStyle) => h('div', { key, style }, content)
  const fontFamily = input.locale === 'ja' ? 'NotoJP, NotoKR, NotoEmoji' : 'NotoKR, NotoJP, NotoEmoji'
  const traps = input.report.traps.slice(0, 3)

  const left = h(
    'div',
    { key: 'left', style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 } },
    h(
      'div',
      { key: 'top', style: { display: 'flex', flexDirection: 'column', gap: 20 } },
      h(
        'div',
        { key: 'brand', style: { display: 'flex', alignItems: 'center', gap: 14 } },
        h(
          'svg',
          { width: 30, height: 30, viewBox: '0 0 24 24' },
          h('circle', { cx: 12, cy: 12, r: 4.2, fill: C.ink }),
          h('ellipse', { cx: 12, cy: 12, rx: 10.5, ry: 4.4, stroke: '#e08a6f', strokeWidth: 1.6, fill: 'none', transform: 'rotate(-24 12 12)' }),
        ),
        text('word', 'supalens', { fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }),
        text('kicker', input.kicker, {
          fontSize: 14, letterSpacing: 1.5, padding: '6px 12px', borderRadius: 999, border: `1px solid ${C.line}`, color: C.ink,
        }),
      ),
      text('repo', input.fullName, { fontSize: 22, color: C.muted }),
      text('headline', clip(input.report.headline, 120), {
        display: 'block', fontSize: input.report.headline.length > 72 ? 40 : 48, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.8,
        lineClamp: 3, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 660,
      }),
    ),
    h(
      'div',
      { key: 'traps', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      ...traps.map((trap, index) =>
        h(
          'div',
          { key: `t${index}`, style: { display: 'flex', gap: 14, alignItems: 'baseline', fontSize: 20 } },
          text('n', String(index + 1).padStart(2, '0'), { fontSize: 15, color: trap.severity === 'certain' ? C.trap : C.warn }),
          text('t', clip(trap.title, 58), { color: C.ink }),
        ),
      ),
    ),
    text('footer', input.footer, { fontSize: 17, color: C.muted }),
  )

  const plate = h(
    'div',
    {
      key: 'plate',
      style: {
        width: 330, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 32, borderRadius: 28, border: `1px solid ${C.line}`, backgroundColor: 'rgba(255,255,255,0.07)',
      },
    },
    text('label', input.gradeLabel, { fontSize: 14, letterSpacing: 1.6, color: C.muted }),
    text('grade', displayGrade(input.report.grade), { fontSize: 196, fontWeight: 700, lineHeight: 1, letterSpacing: -8 }),
    h(
      'div',
      { key: 'stats', style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 16, borderTop: `1px solid ${C.line}` } },
      ...input.statLines.map((line, index) => text(`s${index}`, line, { fontSize: 17, color: C.soft })),
    ),
  )

  const document = h(
    'div',
    {
      style: {
        width: '100%', height: '100%', display: 'flex', gap: 44, padding: '52px 56px', color: C.ink, fontFamily,
        backgroundColor: C.plate,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      },
    },
    left,
    plate,
  )

  return satori(document, { ...XRAY_CARD_SIZE, fonts: await loadFonts(), embedFont: true })
}

export async function renderXrayCard(input: XrayCardInput): Promise<Uint8Array> {
  const svg = await renderXrayCardSvg(input)
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()
}
