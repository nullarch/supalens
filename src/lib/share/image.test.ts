import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import type { SatoriNode } from 'satori'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { imageExcerpt, shareImageLocale, shareImageMetadata, SHARE_IMAGE_COPY, SHARE_IMAGE_LOCALES } from './image-copy'
import { renderShareImage, renderShareImageSvg, SHARE_IMAGE_COLORS } from './image-renderer'

afterEach(() => vi.unstubAllGlobals())

describe('share image content', () => {
  it.each([undefined, null, 4, {}, '', ' \n '])('uses safe defaults for absent or invalid text: %s', value => {
    expect(imageExcerpt(value, 'Fallback', 20)).toBe('Fallback')
  })
  it('normalizes whitespace without interpreting markup', () => {
    expect(imageExcerpt(' \n<x> a\t b </x> ', '', 50)).toBe('<x> a b </x>')
  })
  it('does not split emoji families, accents or surrogate pairs', () => {
    expect(imageExcerpt('👨‍👩‍👧‍👦e\u0301한国', '', 2)).toBe('👨‍👩‍👧‍👦e\u0301…')
    expect(imageExcerpt('abc', '', 3)).toBe('abc')
    expect(imageExcerpt('x'.repeat(50000), '', 180)).toBe(`${'x'.repeat(180)}…`)
  })
  it.each(SHARE_IMAGE_LOCALES)('keeps all image IDs valid with %s preferred', locale => {
    const metadata = shareImageMetadata(locale)
    expect(metadata[0].id).toBe(locale)
    expect(metadata.map(item => item.id).sort()).toEqual(['en', 'ja', 'ko'])
    for (const item of metadata) {
      expect(item.alt).toBe(SHARE_IMAGE_COPY[item.id].alt)
      expect(item.size).toEqual({ width: 1200, height: 630 })
    }
  })
  it('never uses arbitrary IDs as font paths or locale keys', () => {
    expect(shareImageLocale('../../private')).toBe('en')
    expect(shareImageMetadata(undefined)[0].id).toBe('en')
  })
  it('mirrors the global neutral light tokens', async () => {
    const css = await readFile('src/app/globals.css', 'utf8')
    for (const [name, token] of [['paper', 'paper'], ['ink', 'ink'], ['muted', 'ink-2'], ['brand', 'brand'], ['line', 'line']] as const) {
      expect(css).toContain(`--${token}: ${SHARE_IMAGE_COLORS[name]};`)
    }
  })
  it('keeps vendored font/license bytes identical to their pinned sources', async () => {
    const manifest = await readFile('assets/fonts/share/README.md', 'utf8')
    const entries = [...manifest.matchAll(/^([0-9a-f]{64})  ([\w.-]+)$/gm)]
    expect(entries).toHaveLength(7)
    for (const [, digest, name] of entries) {
      const bytes = await readFile(join('assets/fonts/share', name))
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(digest)
    }
  })
})

const samples = {
  standard: { question: 'Why did successful payments not create access?', answer: '3 completed orders have no matching active entitlement. These records do not establish the cause. Review provisioning logs next.' },
  korean: { question: '결제는 완료됐는데 왜 이용 권한이 없나요?', answer: '완료된 주문 3건에 활성 이용 권한이 없습니다. 원인은 아직 확인되지 않았습니다. 권한 생성 작업의 로그를 확인하세요.' },
  japanese: { question: '決済が完了したのに、なぜ利用できないのですか？', answer: '決済済みの注文3件に有効な利用権限がありません。原因はまだ確認されていません。権限付与処理のログを確認してください。' },
  long: { question: '결제 完了 paid without access? '.repeat(40), answer: 'Evidence is not proof of root cause. 未検証 가설 '.repeat(40) },
  unbroken: { question: 'W'.repeat(800), answer: 'transaction_'.repeat(200) },
  symbols: { question: '한글 日本語 café e\u0301 → 42% € £ 👨‍👩‍👧‍👦 🚀', answer: '<script>not executable</script> https://example.invalid/private-glyph-sentinel & unverified' },
  empty: { question: '', answer: null },
  malformed: { question: { text: 'not a string' }, answer: 42 },
}

describe.each(SHARE_IMAGE_LOCALES)('offline share image / %s', locale => {
  it.each(Object.entries(samples))('renders bounded real SVG and PNG: %s', async (name, sample) => {
    const network = vi.fn(() => { throw new Error('Image rendering must be offline') })
    vi.stubGlobal('fetch', network)
    const nodes: SatoriNode[] = []
    const svg = await renderShareImageSvg({ locale, ...sample }, node => nodes.push(node))
    expect(network).not.toHaveBeenCalled()
    expect(/<script|<foreignObject|<text\b|(?:href|src)=["']https?:/i.test(svg)).toBe(false)
    const images = [...svg.matchAll(/<image[^>]+href="([^"]+)"/g)]
    expect(images).toHaveLength(1)
    expect(images[0][1].startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(decodeURIComponent(images[0][1]).match(/<circle /g)).toHaveLength(3)
    const keys = ['header', 'label', 'question', 'answer', 'footer']
    const boxes = keys.map(key => {
      const box = nodes.find(node => node.key === key)
      expect(box, key).toBeDefined()
      expect(box!.left).toBeGreaterThanOrEqual(63)
      expect(box!.left + box!.width).toBeLessThanOrEqual(1137)
      expect(box!.top).toBeGreaterThanOrEqual(47)
      expect(box!.top + box!.height).toBeLessThanOrEqual(583)
      return box!
    })
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].top + boxes[index - 1].height - 1)
    }
    const png = await renderShareImage({ locale, ...sample })
    expect(png.equals(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng())).toBe(true)
    expect(network).not.toHaveBeenCalled()
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    expect(png.length).toBeGreaterThan(10000)
    expect(png.length).toBeLessThan(500000)
    const output = process.env.SHARE_IMAGE_ARTIFACT_DIR
    if (output) {
      await writeFile(join(output, `${locale}-${name}.png`), png)
      await writeFile(join(output, `${locale}-${name}.json`), JSON.stringify({ locale, name, boxes, sha256: createHash('sha256').update(png).digest('hex') }, null, 2))
    }
  }, 30000)
})
