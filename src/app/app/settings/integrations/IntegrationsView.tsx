'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, Plus } from 'lucide-react'
import { disconnectSupabaseAction, disconnectGithubAction, disconnectSlackAction, resyncSupabaseProjectsAction } from './actions'
import { ConnectionActions } from './ConnectionActions'
import { GithubReposList } from './GithubReposList'
import { SlackChannelScope } from './SlackChannelScope'
import { IntegrationReturnNotice } from './IntegrationReturnNotice'
import { connectionRecovery, type IntegrationReturnParams } from './presentation'
import { IntegrationStatus } from './IntegrationStatus'
import { PageHead } from '@/components/dashboard/PageHead'
import DatabaseLogo, { type DatabaseKey } from '@/components/brand/DatabaseLogo'
import type { ConnectionRow, DataSourceRow, GithubRepoRow } from './settings-data'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import s from './integrations.module.css'

export type SlackScopeSnapshot = { channels: Array<{ id: string; name: string }>; selected: string[]; unavailable: boolean }
export type IntegrationViewActions = {
  disconnect?: (data: FormData) => Promise<void>; resync?: (data: FormData) => Promise<void>
  scope?: (connectionId: string, ids: string[]) => Promise<unknown>; refresh?: () => void; reloadHref?: string
  repository?: Pick<ComponentProps<typeof GithubReposList>, 'toggleAction' | 'analyzeAction' | 'renderRun' | 'refresh' | 'reloadHref'>
}

function GithubLogo() {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  )
}

function SlackLogo() {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" aria-hidden>
      <path d="M5.04 15.16a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52Zm1.27 0a2.52 2.52 0 0 1 5.04 0v6.32a2.52 2.52 0 1 1-5.04 0v-6.32Z" fill="#E01E5A" />
      <path d="M8.83 5.04A2.52 2.52 0 1 1 11.35 2.52v2.52H8.83Zm0 1.27a2.52 2.52 0 0 1 0 5.04H2.52a2.52 2.52 0 1 1 0-5.04h6.31Z" fill="#36C5F0" />
      <path d="M18.96 8.83a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.83Zm-1.27 0a2.52 2.52 0 0 1-5.04 0V2.52a2.52 2.52 0 1 1 5.04 0v6.31Z" fill="#2EB67D" />
      <path d="M15.17 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52Zm0-1.27a2.52 2.52 0 0 1 0-5.04h6.31a2.52 2.52 0 1 1 0 5.04h-6.31Z" fill="#ECB22E" />
    </svg>
  )
}

function SupabaseLogo() {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13.2 1.6 4.4 12.5c-.62.78-.07 1.93.93 1.93h6.27v7.86c0 .9 1.18 1.27 1.7.54l8.8-10.9c.62-.78.07-1.93-.93-1.93h-6.27V2.14c0-.9-1.18-1.27-1.7-.54Z"
        fill="#3FCF8E"
      />
    </svg>
  )
}

function DatabaseGlyph() {
  return (
    <svg className={s.logo} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
      <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
    </svg>
  )
}

/**
 * One provider as a card: a one-line head (mark tile, name + summary pill, purpose, the connect
 * action on the right) and — only when something is connected — its body right under it, shaped
 * by what the provider holds: projects, repositories, channels, sources. Nothing connected = the
 * head alone (the pill and the button already say it; no empty well repeating them).
 */
function ProviderCard({ provider, titleId, logo, title, summary, sub, action, children }: {
  provider: string; titleId: string; logo: ReactNode; title: string; summary: ReactNode
  sub: ReactNode; action?: ReactNode; children?: ReactNode
}) {
  return (
    <section className={s.provider} aria-labelledby={titleId} data-provider={provider}>
      <div className={s.providerHead}>
        <span className={s.logoTile}>{logo}</span>
        <div className={s.providerText}>
          <div className={s.providerTitleRow}>
            <h3 className={s.providerTitle} id={titleId}>{title}</h3>
            {summary}
          </div>
          <p className={s.providerSub}>{sub}</p>
        </div>
        {action && <div className={s.providerAction}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** A connected account inside a provider card: a tinted bar (name, state, meta · actions) over its body. */
function AccountBar({ name, status, meta, actions }: { name: string; status: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.accountBar}>
      <div className={s.accountIdent}>
        <span className={s.accountName}>{name}</span>
        <IntegrationStatus status={status} />
        {meta && <span className={s.accountMeta}>{meta}</span>}
      </div>
      {actions && <div className={s.accountActions}>{actions}</div>}
    </div>
  )
}

const SOURCE_MARK: Record<string, DatabaseKey> = { postgres: 'postgresql', mysql: 'mysql', firestore: 'firestore' }
const ENGINE_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', firestore: 'Firestore' }

export function IntegrationsView({ orgId, conns, sources, repos, slackReady, slackScopes, canManage, canAnalyze, params = {}, actions }: {
  orgId: string; conns: ConnectionRow[]; sources: DataSourceRow[]; repos: GithubRepoRow[]
  slackReady: boolean; slackScopes: Record<string, SlackScopeSnapshot>; canManage: boolean; canAnalyze: boolean
  params?: IntegrationReturnParams; actions?: IntegrationViewActions
}) {
  const t = useTranslations('appIntegrations')
  const integrations = useIntegrations()
  const notRegistered = <span className={s.summary} data-warning>{t('page.slack.notConfiguredBadge')}</span>
  const id = useId()
  const supabaseConns = conns.filter(conn => conn.provider === 'supabase')
  const githubConns = conns.filter(conn => conn.provider === 'github')
  const slackConns = conns.filter(conn => conn.provider === 'slack')
  const directSources = sources.filter((row) => !row.connection_id)
  const activeDataSources = sources
    .filter((row) => row.status === 'active')
    .map((row) => ({ id: row.id, name: row.name }))

  // Summary pill beside a provider's name, from the recorded statuses (not a live check): green only
  // when every record is active, amber when any needs review, neutral when nothing is connected.
  const summary = (rows: Array<{ status: string }>, unit: 'connected' | 'sources' = 'connected') => {
    const review = rows.filter((row) => !['active', 'disabled'].includes(row.status)).length
    const active = rows.filter((row) => row.status === 'active').length
    if (rows.length === 0) return <span className={s.summary}>{t('summary.none')}</span>
    if (review > 0) return <span className={s.summary} data-warning>{t('summary.attention', { count: review })}</span>
    return <span className={s.summary} data-connected={active > 0 || undefined}>{t(`summary.${unit}`, { count: rows.length })}</span>
  }
  const connectLink = (href: string, label: string, primary: boolean) => (
    <Link className={`${primary ? 'dx-btn' : 'dx-btn-ghost'} ${s.cta}`} href={href}>
      <Plus size={15} strokeWidth={2} aria-hidden />
      {label}
    </Link>
  )
  // a data source as one row: engine mark, name, engine label, recorded state
  const sourceItem = (row: DataSourceRow, mark: DatabaseKey) => (
    <li key={row.id} className={s.item}>
      <span className={s.itemMark} aria-hidden><DatabaseLogo name={mark} size={14} /></span>
      <span className={s.itemName}>
        <span className={s.itemTitle}>{row.name}</span>
        <span className={s.engine}>{ENGINE_LABEL[row.engine] ?? row.engine}</span>
      </span>
      <IntegrationStatus status={row.status} />
    </li>
  )

  return (
    <main className={s.page} data-integration-view>
      <PageHead title={t('pageTitle')} subtitle={t('viewLede')} />
      {!canManage && <p className={s.roleHint}>{t('actionReadOnly')}</p>}

      <IntegrationReturnNotice params={params} />

      {/* Data — what the monitors read: Supabase accounts (their projects) and databases added directly. */}
      <section className={s.group} aria-labelledby={`${id}-data`}>
        <h2 className={s.groupTitle} id={`${id}-data`}>{t('groups.data')}</h2>
        <div className={s.cards}>
          <ProviderCard provider="supabase" titleId={`${id}-supabase`} logo={<SupabaseLogo />} title="Supabase"
            summary={integrations.supabaseConnect || supabaseConns.length > 0 ? summary(supabaseConns) : notRegistered} sub={t(integrations.supabaseConnect ? 'page.supabaseCard.sub' : 'page.supabaseCard.notRegistered')}
            action={integrations.supabaseConnect && canManage && connectLink('/api/connect-supabase/authorize?returnTo=/app/settings/integrations',
              t('connectSupabase'), supabaseConns.length === 0)}>
            {supabaseConns.length > 0 && (
              <ul className={s.accounts}>
                {supabaseConns.map((conn) => {
                  const connSources = sources.filter((row) => row.connection_id === conn.id)
                  const recovery = connectionRecovery(conn.status)
                  return (
                    <li key={conn.id} className={s.account}>
                      <AccountBar name={conn.display_name ?? conn.provider} status={conn.status}
                        meta={t('page.supabaseCard.projectMeta', { count: connSources.length })}
                        actions={<>
                          {['reconnect', 'error'].includes(recovery ?? '') && canManage && (
                            // Pending setup must not be described as a dead grant.
                            <Link
                              className={`dx-btn ${s.cta}`}
                              href={`/api/connect-supabase/authorize?${new URLSearchParams({ connectionId: conn.id, returnTo: '/app/settings/integrations' })}`}
                              prefetch={false}
                            >
                              {t('page.supabaseCard.reconnect')}
                            </Link>
                          )}
                          <ConnectionActions key={conn.id} connectionId={conn.id} name={conn.display_name ?? 'Supabase'} canManage={canManage} readOnlyNote={false} reloadHref={actions?.reloadHref}
                            disconnect={actions?.disconnect ?? disconnectSupabaseAction} disconnectMessage={t('page.supabaseCard.disconnectConfirm')}
                            resync={conn.status === 'active' ? actions?.resync ?? resyncSupabaseProjectsAction : undefined} />
                        </>} />
                      {recovery && <p className={s.connNote}>{t(`recovery.${recovery}`)}</p>}
                      {connSources.length > 0
                        ? <ul className={s.items}>{connSources.map((row) => sourceItem(row, 'supabase'))}</ul>
                        : !recovery && <p className={s.itemsEmpty}>{t('page.supabaseCard.noProjects')}</p>}
                    </li>
                  )
                })}
              </ul>
            )}
          </ProviderCard>

          {/* Added from Connections with host credentials or a service account; managed there, listed here. */}
          <ProviderCard provider="databases" titleId={`${id}-databases`} logo={<DatabaseGlyph />} title={t('page.databases.title')}
            summary={summary(directSources, 'sources')} sub={t('page.databases.sub')}
            action={
              <Link href="/app/sources" className={`dx-btn-ghost ${s.cta}`}>
                {/* nothing added yet → the action is to add one; otherwise to manage (or view) them */}
                {t(!canManage ? 'viewSources' : directSources.length ? 'manageSources' : 'page.databases.connect')}
                <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </Link>
            }>
            {directSources.length > 0 && (
              <ul className={`${s.items} ${s.itemsFlush}`}>
                {directSources.map((row) => sourceItem(row, SOURCE_MARK[row.engine] ?? 'postgresql'))}
              </ul>
            )}
          </ProviderCard>
        </div>
      </section>

      {/* Code — repositories: per-repo auto analysis and an on-demand run. */}
      <section className={s.group} aria-labelledby={`${id}-code`}>
        <h2 className={s.groupTitle} id={`${id}-code`}>{t('groups.code')}</h2>
        <div className={s.cards}>
          <ProviderCard provider="github" titleId={`${id}-github`} logo={<GithubLogo />} title="GitHub"
            summary={integrations.github || githubConns.length > 0 ? summary(githubConns) : notRegistered} sub={t(integrations.github ? 'page.github.sub' : 'page.github.notRegistered')}
            action={integrations.github && canManage && connectLink('/api/connect-github/authorize?returnTo=/app/settings/integrations',
              githubConns.length ? t('page.github.add') : t('page.github.connect'), githubConns.length === 0)}>
            {githubConns.length > 0 && (
              <ul className={s.accounts}>
                {githubConns.map((conn) => {
                  const connRepos = repos.filter((r) => r.connection_id === conn.id)
                  const onCount = connRepos.filter((r) => r.analysis_enabled).length
                  return (
                    <li key={conn.id} className={s.account}>
                      <AccountBar name={`@${conn.display_name ?? 'github'}`} status={conn.status}
                        meta={t('page.github.repoMeta', { repos: connRepos.length, on: onCount })}
                        actions={<>
                          {canManage && Number.isSafeInteger(conn.installation_id) && Number(conn.installation_id) > 0 && (
                            <a
                              className={s.barLink}
                              href={`https://github.com/settings/installations/${conn.installation_id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t('page.github.manage')}
                              <ExternalLink size={13} strokeWidth={2} aria-hidden />
                            </a>
                          )}
                          <ConnectionActions key={conn.id} connectionId={conn.id} name={conn.display_name ?? 'GitHub'} canManage={canManage} readOnlyNote={false} reloadHref={actions?.reloadHref}
                            disconnect={actions?.disconnect ?? disconnectGithubAction} disconnectMessage={t('page.github.disconnectConfirm')} />
                        </>} />
                      <div className={s.accountBody}>
                        <GithubReposList key={`${orgId}:${conn.id}`} repos={connRepos} dataSources={activeDataSources} canEdit={canAnalyze} unavailable={conn.status !== 'active'} {...actions?.repository} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </ProviderCard>
        </div>
      </section>

      {/* Messenger — where Supalens answers @mentions (alert delivery routing lives in Notifications). */}
      <section className={s.group} aria-labelledby={`${id}-messenger`}>
        <h2 className={s.groupTitle} id={`${id}-messenger`}>{t('groups.messenger')}</h2>
        <div className={s.cards}>
          <ProviderCard provider="slack" titleId={`${id}-slack`} logo={<SlackLogo />} title="Slack"
            summary={slackReady ? summary(slackConns) : <span className={s.summary} data-warning>{t('page.slack.notConfiguredBadge')}</span>}
            sub={t.rich('page.slack.sub', { code: (c) => <code>{c}</code> })}
            action={slackReady && canManage && connectLink('/api/connect-slack/authorize?returnTo=/app/settings/integrations',
              slackConns.length ? t('page.slack.add') : t('page.slack.connect'), slackConns.length === 0)}>
            {!slackReady && <p className={s.connNote}>{t('page.slack.notConfigured')}</p>}
            {slackConns.length > 0 && (
              <>
                <ul className={s.accounts}>
                  {slackConns.map((conn) => (
                    <li key={conn.id} className={s.account}>
                      <AccountBar name={conn.display_name ?? t('slackWorkspace')} status={conn.status}
                        actions={<ConnectionActions key={conn.id} connectionId={conn.id} name={conn.display_name ?? 'Slack'} canManage={canManage} readOnlyNote={false} reloadHref={actions?.reloadHref}
                          disconnect={actions?.disconnect ?? disconnectSlackAction} disconnectMessage={t('page.slack.disconnectConfirm')} />} />
                      {/* the channel scope is an owner/admin setting; the page hint already says so to everyone else */}
                      {canManage && (
                        <div className={s.accountBody}>
                          <SlackChannelScope key={`${orgId}:${conn.id}`} connectionId={conn.id} canManage={canManage}
                            saveAction={actions?.scope ? ids => actions.scope!(conn.id, ids) : undefined} refresh={actions?.refresh}
                            channels={slackScopes[conn.id]?.channels ?? []} selected={slackScopes[conn.id]?.selected ?? []}
                            unavailable={slackScopes[conn.id]?.unavailable ?? true} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className={s.cardFoot}>
                  {t('page.slack.alertsNote')}{' '}
                  <Link className={s.link} href="/app/settings/notifications">{t('page.slack.alertsLink')}</Link>
                </p>
              </>
            )}
          </ProviderCard>
        </div>
      </section>

      <p className={s.stateHint}>{t('recordedStateHint')}</p>
    </main>
  )
}
