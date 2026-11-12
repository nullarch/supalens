import { getTranslations } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import s from './LiveReplay.module.css'

type Kind = 'read' | 'search' | 'entity' | 'rule' | 'trap' | 'done'
type Line = { kind: Kind; text: string }

// The replayed scan is a real production X-ray (the first one, 2026-09-25); the link lets anyone
// open the report it produced. Lines live in the catalog so every locale replays in its language.
const REPLAY_REPO = 'vercel/nextjs-subscription-payments'

/**
 * The /x hero's terminal: a real scan replayed line by line on a 14-second CSS loop (no JS, no
 * data fetch). Reduced motion shows the finished log. Always dark, like the live scan panel.
 */
export default async function LiveReplay() {
  const t = await getTranslations('xray.landing.replay')
  const lines = t.raw('lines') as Line[]

  return (
    <figure className={s.window} aria-label={t('label')}>
      <div className={s.bar}>
        <span className={s.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={s.title}>x-ray · {REPLAY_REPO}</span>
        <span className={s.live}>
          <span className={s.liveDot} aria-hidden />
          LIVE
        </span>
      </div>
      <ol className={s.log}>
        {lines.map((line, index) => (
          <li key={index} className={s.line} data-kind={line.kind}>
            <span className={s.kind}>{t(`kinds.${line.kind}`)}</span>
            <span className={s.text}>{line.text}</span>
          </li>
        ))}
      </ol>
      <figcaption className={s.foot}>
        <span className={s.track} aria-hidden>
          <span className={s.fill} />
        </span>
        <span className={s.footRow}>
          <span>{t('readOnly')}</span>
          <Link href={`/x/${REPLAY_REPO}`} className={s.source}>
            {t('source')}
          </Link>
        </span>
      </figcaption>
    </figure>
  )
}
