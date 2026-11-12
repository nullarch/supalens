import type { CSSProperties } from 'react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Check, Database } from 'lucide-react'

import { CONNECT_HREF } from '@/components/landing/headers/shared'
import { productNameFor } from '@/lib/xray/repo-ref'
import { displayGrade, type VerifiedTrap, type XrayReport } from '@/lib/xray/schema'
import XrayForm from '../../XrayForm'
import CopyButton from './CopyButton'
import RescanButton from './RescanButton'
import ShareBar from './ShareBar'
import s from './report.module.css'

export interface ReportViewModel {
  owner: string
  repo: string
  fullName: string
  defaultBranch: string | null
  commitSha: string | null
  completedAt: string | null
  report: XrayReport
}

const HIDE_EMAIL = 'admin@supalens.ai'
const OTHER_DB_HREF = '/login?next=%2Fapp%2Fsources'
const AREA_WIDTH: Record<string, string> = { split: '35%', needs_data: '65%', consistent: '100%' }

function blobUrl(fullName: string, sha: string | null, path: string, start?: number, end?: number): string {
  const ref = sha ?? 'HEAD'
  const safePath = path.split('/').map(encodeURIComponent).join('/')
  const anchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ''}` : ''
  return `https://github.com/${fullName}/blob/${ref}/${safePath}${anchor}`
}

function fixText(trap: VerifiedTrap): string {
  return (trap.fix?.lines ?? []).map((line) => `${line.op === ' ' ? ' ' : line.op} ${line.text}`).join('\n')
}

/** The public X-ray report. Pure render of a stored, verified report — no live queries. */
export default async function ReportView({ model, pageUrl, cardUrl }: { model: ReportViewModel; pageUrl: string; cardUrl: string }) {
  const t = await getTranslations('xray.report')
  const format = await getFormatter()
  const { report } = model
  const name = productNameFor(model.owner, model.repo, report.productName)
  const sha7 = model.commitSha?.slice(0, 7) ?? '—'
  const when = model.completedAt ? format.relativeTime(new Date(model.completedAt), new Date()) : ''
  const grade = displayGrade(report.grade)
  const steps = report.moneyFlow.steps
  const branches = report.moneyFlow.branches ?? []
  const checks = t.raw('cta.checks') as string[]

  return (
    <article className={s.report}>
      <section className={`ed-wide ${s.head}`}>
        <div className={s.repoRow}>
          <span className={s.avatar} aria-hidden>
            {model.owner.slice(0, 2)}
          </span>
          <a className={s.repoName} href={`https://github.com/${model.fullName}`} rel="noopener noreferrer" target="_blank">
            {model.fullName.replace('/', ' / ')}
          </a>
          <span className={s.pill}>{t('public')}</span>
          <span className={`${s.pill} ${s.mono}`}>
            {model.defaultBranch ?? 'main'} @ {sha7}
          </span>
          {when && <span className={s.muted}>{t('scanned', { when })}</span>}
          <RescanButton repo={`${model.owner}/${model.repo}`} label={t('rescan')} variant="link" />
        </div>

        <div className={s.heroGrid}>
          <div className={s.heroCopy}>
            <span className={s.kicker}>{t('tag')}</span>
            <h1 className={s.headline} data-long={report.headline.length > 70 || undefined}>
              {report.headline}
            </h1>
            <p className={s.summary}>{report.summary}</p>
            <p className={s.model}>{report.businessModel}</p>
          </div>

          <div className={s.plate}>
            <div className={s.plateTop}>
              <span className={s.plateLabel}>{t('gradeLabel')}</span>
              <details className={s.how}>
                <summary>{t('gradeHow')}</summary>
                <p>{t('gradeHowBody')}</p>
              </details>
            </div>
            <span className={s.grade} aria-label={`${t('gradeLabel')}: ${grade}`}>
              {grade}
            </span>
            {report.areas.length > 0 && (
              <ul className={s.areas}>
                {report.areas.map((area) => (
                  <li key={area.name} className={s.area} data-status={area.status}>
                    <span className={s.areaName}>{area.name}</span>
                    <span className={s.areaTrack} aria-hidden>
                      <span className={s.areaFill} style={{ width: AREA_WIDTH[area.status] } as CSSProperties} />
                    </span>
                    <span className={s.areaNote}>{area.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <ShareBar
          pageUrl={pageUrl}
          cardUrl={cardUrl}
          postText={t('share.post', { name, grade, headline: report.headline })}
          labels={{
            title: t('share.title'),
            note: t('share.note'),
            x: t('share.x'),
            linkedin: t('share.linkedin'),
            copy: t('share.copy'),
            copied: t('share.copied'),
            download: t('share.download'),
          }}
        />
      </section>

      <section className={`ed-wide ${s.section}`} aria-labelledby="xr-money">
        <div className={s.money}>
          <div className={s.sectionHead}>
            <h2 id="xr-money" className={s.sectionTitle}>
              {t('money.title', { name })}
            </h2>
            <span className={s.muted}>{t('money.note', { sha: sha7 })}</span>
          </div>
          <ol className={s.flow} style={{ '--xr-steps': steps.length } as CSSProperties}>
            {steps.map((step, index) => (
              <li
                key={`${step.label}-${index}`}
                className={index === steps.length - 1 ? `${s.flowStep} ${s.flowStepLast}` : s.flowStep}
                style={{ gridColumn: index + 1, gridRow: 1 }}
              >
                <span className={s.flowLabel}>{step.label}</span>
                {step.entity && <span className={s.flowEntity}>{step.entity}</span>}
                {step.ref && <span className={s.flowRef}>{step.ref}</span>}
              </li>
            ))}
            {branches.map((branch, index) => (
              <li
                key={`${branch.label}-${index}`}
                className={branch.trap ? `${s.flowBranch} ${s.flowBranchTrap}` : s.flowBranch}
                style={{ gridColumn: branch.under, gridRow: 2 }}
              >
                <span className={s.flowBranchLabel}>{branch.label}</span>
                <span className={s.flowBranchDetail}>{branch.detail}</span>
              </li>
            ))}
          </ol>
          {report.moneyFlow.note && (
            <p className={s.flowNote}>
              <span className={s.codeChip}>{report.moneyFlow.note.label}</span>
              <span>{report.moneyFlow.note.text}</span>
              {report.moneyFlow.note.ref && <span className={s.mono}>{report.moneyFlow.note.ref}</span>}
            </p>
          )}
        </div>
      </section>

      <section className={`ed-wide ${s.section}`} aria-labelledby="xr-traps">
        <div className={s.sectionHead}>
          <div className={s.sectionHeadCopy}>
            <h2 id="xr-traps" className={s.sectionTitle}>
              {t('traps.title', { count: report.traps.length })}
            </h2>
            <p className={s.sectionSub}>{report.traps.length ? t('traps.sub') : t('traps.subNone')}</p>
          </div>
          {report.traps.length > 0 && (
            <div className={s.legend}>
              <span>
                <i className={s.dotTrap} aria-hidden />
                {t('traps.certain')}
              </span>
              <span>
                <i className={s.dotWarn} aria-hidden />
                {t('traps.needsData')}
              </span>
            </div>
          )}
        </div>

        <div className={s.traps}>
          {report.traps.map((trap, index) => {
            const wrong = trap.sides.find((side) => side.verdict === 'wrong') ?? trap.sides[trap.sides.length - 1]
            return (
              <details key={`${trap.title}-${index}`} className={s.trap} open={index === 0}>
                <summary className={s.trapHead}>
                  <div className={s.trapCopy}>
                    <div className={s.trapChips}>
                      <span className={s.trapIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <span className={trap.severity === 'certain' ? s.chipTrap : s.chipWarn}>
                        {trap.severity === 'certain' ? t('traps.certain') : t('traps.needsData')}
                      </span>
                      {[trap.area, ...(trap.impact ?? [])]
                        .filter((tag, i, all) => all.indexOf(tag) === i)
                        .slice(0, 3)
                        .map((tag) => (
                          <span key={tag} className={s.chipTag}>
                            {tag}
                          </span>
                        ))}
                    </div>
                    <h3 className={s.trapTitle}>{trap.title}</h3>
                    <p className={s.trapBody}>{trap.explanation}</p>
                    <p className={s.trapRefs}>{trap.sides.map((side) => `${side.path}:${side.startLine}`).join('  ·  ')}</p>
                  </div>
                  <span className={s.toggle}>
                    <span className={s.toggleShow}>{t('traps.show')}</span>
                    <span className={s.toggleHide}>{t('traps.hide')}</span>
                  </span>
                </summary>

                <div className={s.trapBodyWrap}>
                  <div className={trap.sides.length > 1 ? s.panes : `${s.panes} ${s.panesSingle}`}>
                    {trap.sides.map((side) => (
                      <figure key={`${side.path}:${side.startLine}`} className={s.pane}>
                        <figcaption className={s.paneHead}>
                          <span>{side.path}</span>
                          <span data-verdict={side.verdict} className={s.verdict}>
                            {side.label} · {t(`traps.${side.verdict}`)}
                          </span>
                        </figcaption>
                        <pre className={s.code}>
                          {side.lines.map((line) => (
                            <span key={line.n} className={s.codeLine} data-mark={line.mark}>
                              <span className={s.gutter}>{line.n}</span>
                              <span className={s.codeText}>{line.text || ' '}</span>
                            </span>
                          ))}
                        </pre>
                      </figure>
                    ))}
                  </div>

                  {trap.fix && (
                    <div className={s.fix}>
                      <div className={s.fixHead}>
                        <span className={s.fixTitle}>{t('traps.fix', { path: trap.fix.path })}</span>
                        <div className={s.fixActions}>
                          <a
                            className={s.ghostButton}
                            href={blobUrl(model.fullName, model.commitSha, wrong.path, wrong.startLine, wrong.endLine)}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {t('traps.openGithub')}
                          </a>
                          <CopyButton text={fixText(trap)} label={t('traps.copyFix')} copiedLabel={t('traps.copied')} />
                        </div>
                      </div>
                      <pre className={s.code}>
                        {trap.fix.lines.map((line, lineIndex) => (
                          <span key={lineIndex} className={s.codeLine} data-op={line.op === ' ' ? undefined : line.op === '+' ? 'add' : 'del'}>
                            <span className={s.gutter}>{line.op === ' ' ? '' : line.op === '+' ? '+' : '−'}</span>
                            <span className={s.codeText}>{line.text || ' '}</span>
                          </span>
                        ))}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      </section>

      {report.kpis.length > 0 && (
        <section className={`ed-wide ${s.section}`} aria-labelledby="xr-kpis">
          <h2 id="xr-kpis" className={`${s.sectionTitle} ${s.sectionTitleSolo}`}>
            {t('kpis.title', { count: report.kpis.length })}
          </h2>
          <ul className={s.kpis}>
            {report.kpis.map((kpi) => (
              <li key={kpi.name} className={s.kpi}>
                <span className={s.kpiName}>{kpi.name}</span>
                {kpi.ref && <span className={s.flowRef}>{kpi.ref}</span>}
                <span className={kpi.watch === 'anomaly' ? s.watchAnomaly : s.watchThreshold}>
                  {kpi.watch === 'anomaly' ? t('kpis.anomaly') : t('kpis.threshold')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`ed-wide ${s.section}`} aria-labelledby="xr-cta">
        <div className={s.cta}>
          <div className={s.ctaCopy}>
            <span className={s.ctaFound}>
              <Database size={20} strokeWidth={1.8} aria-hidden />
              {report.supabase.found ? t('cta.found') : t('cta.notFound')}
              {report.supabase.found && report.supabase.evidence?.length ? (
                <span className={s.ctaEvidence}>{report.supabase.evidence.slice(0, 2).join(' · ')}</span>
              ) : null}
            </span>
            <h2 id="xr-cta" className={s.ctaTitle}>
              {t('cta.title')}
            </h2>
            <ul className={s.ctaChecks}>
              {checks.map((check) => (
                <li key={check}>
                  <Check size={16} strokeWidth={2.4} aria-hidden />
                  {check}
                </li>
              ))}
            </ul>
          </div>
          <div className={s.ctaAction}>
            <a className={s.ctaButton} href={report.supabase.found ? CONNECT_HREF : OTHER_DB_HREF}>
              {report.supabase.found ? t('cta.button') : t('cta.buttonOther')}
            </a>
            <span className={s.ctaNote}>{t('cta.note')}</span>
          </div>
        </div>
      </section>

      <section className={`ed-wide ${s.another}`} aria-label={t('another')}>
        <span className={s.anotherTitle}>{t('another')}</span>
        <div className={s.anotherForm}>
          <XrayForm compact inputId="xray-another" />
        </div>
      </section>

      <p className={`ed-wide ${s.provenance}`}>
        {t('footer', { sha: sha7 })}{' '}
        <a href={`mailto:${HIDE_EMAIL}?subject=${encodeURIComponent(`Hide X-ray: ${model.fullName}`)}`}>{t('hide')}</a>
      </p>
    </article>
  )
}
