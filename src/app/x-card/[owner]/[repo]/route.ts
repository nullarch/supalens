import { getTranslations } from 'next-intl/server'

import { isSupportedLocale } from '@/lib/i18n/negotiate'
import { parseRepoInput } from '@/lib/xray/repo-ref'
import { getRepoState, getScan, type XrayScanRow } from '@/lib/xray/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The X-ray share card (1200×630 PNG) — og:image / twitter:image of /x/<owner>/<repo> and the
 * "Download card" file. Deliberately a plain route OUTSIDE the [locale] segment: a file-convention
 * opengraph-image there is emitted as /en/x/… and 307-redirects, which some card crawlers won't
 * follow. `?v=<reportId>` pins one report version, so that URL is cached long; the unpinned URL is
 * cached briefly, and the "not X-rayed yet" card is never cached (a scan may finish any second).
 */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params
  const url = new URL(req.url)
  const localeParam = url.searchParams.get('locale')
  const locale = isSupportedLocale(localeParam) ? localeParam : 'en'
  const ref = parseRepoInput(`${owner}/${repo}`)
  if (!ref) return new Response('not found', { status: 404 })

  const version = url.searchParams.get('v')
  let row: XrayScanRow | null = null
  let pinned = false
  if (version) {
    const scan = await getScan(version)
    if (scan && scan.owner === ref.owner && scan.repo === ref.repo && scan.status === 'succeeded' && scan.report) {
      row = scan
      pinned = true
    }
  }
  if (!row) row = (await getRepoState(ref.owner, ref.repo, locale)).report

  const t = await getTranslations({ locale, namespace: 'xray' })
  const report = row?.report ?? { headline: t('card.noReport'), grade: '?', traps: [] }
  const { renderXrayCard } = await import('@/lib/xray/card')
  const bytes = await renderXrayCard({
    fullName: row?.fullName ?? `${ref.owner}/${ref.repo}`,
    locale,
    kicker: t('card.kicker'),
    footer: t('card.footer'),
    gradeLabel: t('report.gradeLabel').toUpperCase(),
    statLines: row?.report
      ? [
          t('report.traps.title', { count: row.report.traps.length }),
          t('card.rules', { count: row.report.rulesRead }),
          t('report.kpis.title', { count: row.report.kpis.length }),
        ]
      : [],
    report,
  })
  const cache = !row ? 'no-store' : pinned ? 'public, max-age=86400, s-maxage=2592000, immutable' : 'public, max-age=60, s-maxage=300'
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': cache,
      'Content-Disposition': `inline; filename="xray-${ref.owner}-${ref.repo}.png"`,
      'X-Robots-Tag': 'noindex',
    },
  })
}
