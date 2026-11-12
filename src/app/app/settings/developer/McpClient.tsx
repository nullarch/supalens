'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { BaseModal, ModalButton } from '@/components/modals'
import type { ApiKeySummary } from '@/lib/mcp/keys'
import { isRevoked, keyLastUsed, readKeyList, readMintedToken } from './key-response'
import s from './mcp.module.css'

const requestKeys = (url: string, init?: RequestInit) => fetch(url, init)
const copyText = (value: string) => navigator.clipboard.writeText(value)

// Full set registered by the MCP server (keep in sync with src/lib/mcp/tools.ts). Only the
// three entry-point tools show by default — the rest sit behind a disclosure so the page
// reads as "connect and ask" rather than a 19-chip API reference.
const TOOLS = [
  'get_setup_status',
  'list_data_sources',
  'get_schema',
  'execute_sql',
  'register_query',
  'list_collections',
  'get_collection_schema',
  'query_documents',
  'aggregate',
  'create_dashboard',
  'add_widget',
  'list_dashboards',
  'list_widgets',
  'list_alerts',
  'create_alert',
  'toggle_alert',
  'delete_alert',
  'ask',
  'get_analysis',
]
// The "start here" entry-point tools — accented so newcomers know where to begin.
const CORE_TOOLS = new Set(['get_setup_status', 'ask', 'list_alerts'])
// Monitoring-centric example prompts (the tool each one lands on, for the mono tag).
const EXAMPLES = ['listMonitors', 'askMetric', 'reuseKpi'] as const

/** Copy-to-clipboard button with transient "Copied" feedback. `className` lets the caller
 *  style it for a light surface (.dx-btn-ghost) or the ink endpoint band (s.endpointCopy). */
function CopyButton({ value, className, ariaLabel, copy = copyText }: { value: string; className: string; ariaLabel?: string; copy?: typeof copyText }) {
  const t = useTranslations('appMcp')
  const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
  const generation = useRef(0)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const current = ++generation.current
    busy.current = false
    setStatus('idle')
    return () => { generation.current = current + 1; if (timer.current) clearTimeout(timer.current) }
  }, [value])
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel ? `${ariaLabel}: ${t(status === 'idle' ? 'copy' : status === 'pending' ? 'copying' : status === 'failed' ? 'copyFailed' : 'copied')}` : undefined}
      aria-live="polite"
      disabled={status === 'pending'}
      onClick={async () => {
        if (busy.current) return
        busy.current = true
        const current = generation.current
        if (timer.current) clearTimeout(timer.current)
        setStatus('pending')
        try {
          await copy(value)
          if (current !== generation.current) return
          setStatus('copied')
          timer.current = setTimeout(() => setStatus('idle'), 2000)
        } catch {
          if (current === generation.current) setStatus('failed')
        } finally {
          if (current === generation.current) busy.current = false
        }
      }}
    >
      {t(status === 'idle' ? 'copy' : status === 'pending' ? 'copying' : status === 'failed' ? 'copyFailed' : 'copied')}
    </button>
  )
}

/** A mono, horizontally-scrolling code field + a ghost copy button. */
function CopyField({ value, label, copy }: { value: string; label: string; copy: typeof copyText }) {
  return (
    <div className={s.copyField}>
      <code className={s.code} tabIndex={0} role="region" aria-label={label}>{value}</code>
      <CopyButton value={value} ariaLabel={label} copy={copy} className={`dx-btn-ghost ${s.copyBtn}`} />
    </div>
  )
}

export default function McpClient({
  initialKeys,
  endpoint,
  canManage,
  request = requestKeys,
  copy = copyText,
}: {
  initialKeys: ApiKeySummary[]
  endpoint: string
  canManage: boolean
  request?: typeof requestKeys
  copy?: typeof copyText
}) {
  const t = useTranslations('appMcp')
  const common = useTranslations('appCommon')
  const sectionId = useId()
  const locale = useLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const [keys, setKeys] = useState<ApiKeySummary[]>(initialKeys)
  const [minting, setMinting] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [allTools, setAllTools] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  const keyHeading = useRef<HTMLHeadingElement>(null)
  const revokeTrigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const pending = minting || revoking || syncing

  async function refresh() {
    const response = await request('/api/mcp-keys', { cache: 'no-store' })
    const list = response.ok ? readKeyList(await response.json()) : null
    if (!list) throw new Error('key_list_unconfirmed')
    if (mounted.current) { setKeys(list); setNeedsRefresh(false) }
  }

  async function retryRefresh() {
    if (busy.current) return
    busy.current = true
    setSyncing(true)
    try {
      await refresh()
      if (mounted.current) { setError(null); setNotice(t('listRefreshed')) }
    } catch {
      if (mounted.current) setError(t('refreshFailed'))
    } finally {
      busy.current = false
      if (mounted.current) setSyncing(false)
    }
  }

  async function mint() {
    if (!canManage || busy.current || fresh || needsRefresh) return
    busy.current = true
    setMinting(true)
    setError(null)
    setNotice(null)
    let confirmed = false
    try {
      const res = await request('/api/mcp-keys', { method: 'POST' })
      const token = res.ok ? readMintedToken(await res.json()) : null
      if (!token) throw new Error('key_mint_unconfirmed')
      confirmed = true
      if (!mounted.current) return
      setFresh(token)
      setNotice(t('mintConfirmed'))
      await refresh()
    } catch {
      if (mounted.current) {
        setError(t(confirmed ? 'mintRefreshFailed' : 'mintUnconfirmed'))
        setNeedsRefresh(true)
      }
    } finally {
      busy.current = false
      if (mounted.current) setMinting(false)
    }
  }

  async function doRevoke() {
    if (!canManage || !confirmId || busy.current || needsRefresh || fresh) return
    busy.current = true
    setRevoking(true)
    setRevokeError(null)
    setNotice(null)
    let confirmed = false
    try {
      const res = await request(`/api/mcp-keys?id=${encodeURIComponent(confirmId)}`, { method: 'DELETE' })
      if (!res.ok || !isRevoked(await res.json())) throw new Error('key_revoke_unconfirmed')
      confirmed = true
      if (!mounted.current) return
      setConfirmId(null)
      setError(null)
      setNotice(t('revokeConfirmed'))
      await refresh()
    } catch {
      if (mounted.current) {
        if (confirmed) setError(t('revokeRefreshFailed'))
        else setRevokeError(t('revokeUnconfirmed'))
        setNeedsRefresh(true)
      }
    } finally {
      busy.current = false
      if (mounted.current) setRevoking(false)
    }
  }

  const claudeCmd = `claude mcp add --transport http supalens ${endpoint} --header "Authorization: Bearer ${
    fresh ?? '<YOUR_KEY>'
  }"`
  const jsonSnippet = `{
  "mcpServers": {
    "supalens": {
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ${fresh ?? '<YOUR_KEY>'}" }
    }
  }
}`

  return (
    <div className={s.stack}>
      {/* the canonical endpoint — the connection's identity */}
      <section className={s.endpoint}>
        <span className={s.endpointLabel}>{t('endpointEyebrow')}</span>
        <div className={s.endpointRow}>
          <span className={s.endpointUrl}>{endpoint}</span>
          <CopyButton value={endpoint} copy={copy} className={`dx-btn-ghost ${s.endpointCopy}`} ariaLabel={t('endpointEyebrow')} />
        </div>
      </section>

      <div className={s.doc}>
        {/* Step 1 — API keys */}
        <section className={s.row} aria-labelledby={`${sectionId}-keys`}>
          <div className={s.rowHead}>
            <div className={s.headText}>
              <h2 ref={keyHeading} tabIndex={-1} id={`${sectionId}-keys`} className={s.rowTitle}>{t('step1.heading')}</h2>
              {!canManage && <p className={s.desc}>{t('viewerNote')}</p>}
            </div>
            {canManage && (
              <button type="button" className={`dx-btn ${s.mint}`} onClick={mint} disabled={pending || !!fresh || needsRefresh}>
                {minting ? t('step1.minting') : t('step1.mint')}
              </button>
            )}
          </div>
          <div className={s.rowBody}>
            {notice && <p className={s.notice} role="status">{notice}</p>}
            {error && <p className={s.error} role="alert">{error}</p>}
            {needsRefresh && <div className={s.refreshNote}>
              <p>{t('staleList')}</p>
              <button type="button" className="dx-btn-ghost" disabled={pending} onClick={retryRefresh}>{syncing ? common('processing') : t('refreshList')}</button>
            </div>}

            {fresh && (
              <div className={s.freshCallout}>
                <div className={s.freshHead}>
                  <span className={s.freshWarn}>{t('step1.onceWarning')}</span>
                  <button type="button" className="dx-btn-ghost" disabled={pending} onClick={() => { setFresh(null); setNotice(null) }}>
                    {t('step1.dismiss')}
                  </button>
                </div>
                <CopyField value={fresh} label={t('step1.colKey')} copy={copy} />
              </div>
            )}

            {keys.length === 0 ? (
              <p className={s.empty}>{t('step1.empty')}</p>
            ) : (
              <div className={s.tableCard}>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label={t('step1.heading')}>
                  <table className={`dx-table ${s.table}`}>
                    <thead>
                      <tr>
                        <th>{t('step1.colKey')}</th>
                        <th>{t('step1.colLastUsed')}</th>
                        <th>{t('step1.colStatus')}</th>
                        <th aria-label={t('step1.revoke')} />
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.id} data-revoked={k.revokedAt ? true : undefined}>
                          <td className={s.keyCell}>
                            {k.prefix}…{k.lastFour}
                          </td>
                          <td className={s.lastUsed}>{k.lastUsedAt ? keyLastUsed(k.lastUsedAt, intlLocale) ?? t('unknownDate') : t('step1.unused')}</td>
                          <td>
                            {k.revokedAt ? (
                              <span className="dx-badge">{t('step1.revoked')}</span>
                            ) : (
                              <span className="dx-status">
                                <span className="dx-dot dx-dot-ok" />
                                {t('step1.active')}
                              </span>
                            )}
                          </td>
                          <td className={s.rowAction}>
                            {!k.revokedAt && canManage && (
                              <button type="button" className={s.revokeBtn} disabled={pending || needsRefresh || !!fresh} onClick={event => { revokeTrigger.current = event.currentTarget; setRevokeError(null); setConfirmId(k.id) }}>
                                {t('step1.revoke')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Step 2 — connect an AI client */}
        <section className={s.row} aria-labelledby={`${sectionId}-connect`}>
          <div className={s.rowHead}>
            <div className={s.headText}>
              <h2 id={`${sectionId}-connect`} className={s.rowTitle}>{t('step2.heading')}</h2>
              <p className={s.desc}>
                {t.rich('step2.description', {
                  code: (c) => <code>{c}</code>,
                })}
              </p>
            </div>
          </div>
          <div className={s.rowBody}>
            <div className={s.snippet}>
              <span className={s.snippetLabel}>{t('step2.claudeCode')}</span>
              <CopyField value={claudeCmd} label={t('step2.claudeCode')} copy={copy} />
            </div>
            <div className={s.snippet}>
              <span className={s.snippetLabel}>{t('step2.cursor')}</span>
              <CopyField value={jsonSnippet} label={t('step2.cursor')} copy={copy} />
            </div>
          </div>
        </section>

        {/* Step 3 — available tools */}
        <section className={s.row} aria-labelledby={`${sectionId}-tools`}>
          <div className={s.rowHead}>
            <div className={s.headText}>
              <h2 id={`${sectionId}-tools`} className={s.rowTitle}>{t('step3.heading')}</h2>
              <p className={s.desc}>
                {t.rich('step3.description', {
                  code: (c) => <code>{c}</code>,
                })}
              </p>
            </div>
          </div>
          <div className={s.rowBody}>
            <ul className={s.exampleList}>
              {EXAMPLES.map((ex) => (
                <li key={ex} className={s.example}>
                  <span className={s.examplePrompt}>{t(`step3.examples.${ex}.prompt`)}</span>
                  <code className={s.exampleTool}>{t(`step3.examples.${ex}.tool`)}</code>
                </li>
              ))}
            </ul>
            <div className={s.toolGrid}>
              {TOOLS.filter((tool) => allTools || CORE_TOOLS.has(tool)).map((tool) => (
                <span key={tool} className={CORE_TOOLS.has(tool) ? `${s.toolChip} ${s.toolChipCore}` : s.toolChip}>
                  {tool}
                </span>
              ))}
              <button type="button" className={s.toolToggle} aria-expanded={allTools} onClick={() => setAllTools((v) => !v)}>
                {allTools ? t('step3.hideAll') : t('step3.showAll', { count: TOOLS.length - CORE_TOOLS.size })}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden data-open={allTools}><path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
        </section>
      </div>

      <BaseModal
        open={confirmId !== null}
        onClose={() => { if (!busy.current) setConfirmId(null) }}
        title={t('step1.revokeTitle')}
        description={t('revokeConfirm')}
        size="sm"
        showCloseButton={false}
        closeDisabled={revoking}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const trigger = revokeTrigger.current
          if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true })
          else keyHeading.current?.focus({ preventScroll: true })
        }}
        footer={<div className={s.modalActions}>
          <ModalButton variant="ghost" disabled={revoking} onClick={() => setConfirmId(null)}>{common('close')}</ModalButton>
          <ModalButton variant="destructive" disabled={revoking || needsRefresh} onClick={doRevoke}>{revoking ? common('processing') : t('step1.revoke')}</ModalButton>
        </div>}
      >
        <p className={s.keyTarget}>{keys.find(k => k.id === confirmId)?.prefix}…{keys.find(k => k.id === confirmId)?.lastFour}</p>
        {revokeError && <p className={s.error} role="alert">{revokeError}</p>}
      </BaseModal>
    </div>
  )
}
