import { describe, expect, it, vi } from 'vitest'
import { elements, oneElement, type RouteElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

describe('public-page composition keeps the approved story and real destinations', () => {
  for (const locale of ['en', 'ko', 'ja']) for (const route of ['home', 'supabase']) {
    it(`${route}/${locale}: consistent shared section order and request locale`, async () => {
      const setLocale = vi.fn()
      // Both pages use the editorial system (editorial design system); /supabase swaps in its own entry
      // sections and shares monitoring, security, pricing and the closing CTA with home.
      const components = route === 'home'
        ? ['RevealOnScroll', 'Header', 'Hero', 'Principles', 'Connections', 'Workflow', 'Monitoring', 'Security', 'Pricing', 'Faq', 'FinalCta', 'Footer']
        : ['RevealOnScroll', 'Header', 'SupabaseHero', 'ConnectFacts', 'SchemaVsCode', 'SupabaseSteps', 'Monitoring', 'Security', 'Pricing', 'FinalCta', 'Footer']
      const imports = Object.fromEntries(components.map(name => [`@/components/landing/editorial/${name}`, name]))
      const page = loadRoute(`[locale]/${route === 'home' ? '' : 'supabase/'}page.tsx`, {
        ...imports, '@/lib/metadata/public-origin': {},
        '@/components/landing/editorial/editorial.css': {}, '@/components/landing/editorial/fonts': { editorialFontVariables: 'fonts' },
        'next-intl/server': { setRequestLocale: setLocale },
      })
      const main = oneElement(await page.default({ params: Promise.resolve({ locale }) }), 'main')
      expect(main.props.className).toBe('ed fonts')
      expect((main.props.children as RouteElement[]).filter(Boolean).map(child => child.type)).toEqual(components)
      expect(setLocale).toHaveBeenCalledExactlyOnceWith(locale)
    })
  }
  for (const locale of ['en', 'ko', 'ja']) {
    it(`MCP docs/${locale}: exact commands, translated copy states and unchanged connect intent`, async () => {
      const t = Object.assign((key: string) => `${locale}:${key}`, { raw: () => ['Local sample bullet'] })
      const page = loadRoute('[locale]/docs/mcp/page.tsx', {
        'next/link': 'Link', 'next-intl/server': { getTranslations: async () => t, setRequestLocale: () => {} },
        '@/components/legal/LegalDoc': { LegalDoc: 'LegalDoc', Section: 'Section' }, './CopyBlock': { CopyBlock: 'CopyBlock' },
      })
      const tree = await page.default({ params: Promise.resolve({ locale }) })
      const blocks = elements(tree, 'CopyBlock')
      expect(blocks).toHaveLength(3)
      expect(blocks.map(block => block.props.label)).toEqual(['url.h', 'code.h', 'other.h'].map(key => `${locale}:${key}`))
      expect(blocks[0].props.code).toBe('https://mcp.supalens.ai/mcp')
      expect(blocks[1].props.code).toBe('claude mcp add --transport http supalens https://mcp.supalens.ai/mcp')
      expect(blocks[2].props.code).toContain('Authorization: Bearer sl_...')
      expect(blocks[2].props.code).toContain('"method":"tools/list"')
      for (const block of blocks) expect(block.props).toMatchObject({ copyLabel: `${locale}:copy`, copiedLabel: `${locale}:copied`, copyingLabel: `${locale}:copying`, failedLabel: `${locale}:copyFailed` })
      expect(elements(tree, 'Link').map(link => link.props.href)).toEqual(['/app/settings/developer', '/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase'])
    })
  }
})
