'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { track } from '@/utils/analytics'
import { TextField, ModalButton } from '@/components/modals'
import { Select } from '@/components/ui/Select'
import { parseConnectionString, type SslMode } from './connection-string'
import s from './data-source-form.module.css'

// Direct SQL (postgres/mysql) connect form. Always rendered inside the connect modal's
// source-type flow; presentation via shared modal primitives.
export function DirectDataSourceForm({ engine, onDone, onBusyChange }: { engine: 'postgres' | 'mysql'; onDone?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const t = useTranslations('appSources')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [url, setUrl] = useState('')
  const [f, setF] = useState({
    name: '',
    host: '',
    port: engine === 'mysql' ? '3306' : '5432',
    database: '',
    user: '',
    password: '',
    ssl: 'verify' as SslMode,
  })

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  /** Pasting a connection URL fills the fields below; they stay editable. */
  function onUrl(value: string) {
    setUrl(value)
    const parsed = parseConnectionString(value, engine)
    if (parsed) setF((p) => ({ ...p, ...parsed, name: p.name || parsed.database }))
  }

  /** The server answers with a coarse code; say what to do about it in the user's language. */
  function explain(data: { error?: string; message?: string }, status: number): string {
    if (data.error === 'unsafe_host') return t('form.errors.unsafeHost')
    if (data.error === 'connection_failed') {
      const reason = /\(([^)]+)\)/.exec(data.message ?? '')?.[1] ?? ''
      const key = ({
        'TLS error': 'tls',
        'authentication failed': 'auth',
        'host not found': 'hostNotFound',
        'connection refused': 'refused',
        'database not found': 'databaseNotFound',
        timeout: 'timeout',
      } as Record<string, string>)[reason]
      return t(`form.errors.${key ?? 'unreachable'}`)
    }
    return data.message ?? data.error ?? `failed (${status})`
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    onBusyChange?.(true)
    setMsg(null)
    try {
      const res = await fetch('/api/data-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, engine, port: Number(f.port), ssl: f.ssl === 'verify' ? true : f.ssl === 'require' ? 'require' : false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(explain(data, res.status))
      track('datasource_connected', { kind: 'sql' })
      router.refresh()
      onDone?.()
    } catch (err) {
      setMsg({ kind: 'err', text: String(err instanceof Error ? err.message : err) })
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <form onSubmit={submit} className={s.form}>
      <fieldset disabled={busy} className={s.fields}>
        <TextField
          label={t('form.connectionUrl')}
          placeholder={engine === 'mysql' ? 'mysql://user:password@host:3306/database' : 'postgresql://user:password@host:5432/database'}
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          autoComplete="off"
          hint={t('form.connectionUrlHint')}
        />
        <TextField label={t('form.name')} placeholder={t('form.namePlaceholderSql')} value={f.name} onChange={(e) => set('name', e.target.value)} required />
        <div className={`${s.pair} ${s.hostPort}`}>
          <TextField label={t('form.host')} placeholder="db.example.com" value={f.host} onChange={(e) => set('host', e.target.value)} required />
          <TextField label={t('form.port')} inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value)} required />
        </div>
        <div className={s.pair}>
          <TextField label={t('form.database')} value={f.database} onChange={(e) => set('database', e.target.value)} required />
          <TextField label={t('form.user')} value={f.user} onChange={(e) => set('user', e.target.value)} required />
        </div>
        <TextField label={t('form.password')} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} required hint={t('form.passwordHint')} />
        <div className={s.check}>
          <Select
            value={f.ssl}
            onValueChange={(v) => set('ssl', v)}
            ariaLabel={t('form.sslMode')}
            options={[
              { value: 'verify', label: t('form.sslVerify') },
              { value: 'require', label: t('form.sslRequire') },
              { value: 'off', label: t('form.sslOff') },
            ]}
          />
        </div>
        {msg?.kind === 'err' && <p role="alert" className={s.error}>{msg.text}</p>}
        <div className={s.footer}>
          <ModalButton type="submit" variant="primary" disabled={busy} className="min-h-11">{busy ? t('form.testing') : t('form.submit')}</ModalButton>
        </div>
      </fieldset>
    </form>
  )
}
