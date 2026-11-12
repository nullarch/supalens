'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { track } from '@/utils/analytics'
import { TextField, TextAreaField, ModalButton } from '@/components/modals'
import s from './data-source-form.module.css'

// Firebase Firestore connect form. Collects a name + the service-account JSON (+ optional named
// database). The JSON's private_key is sent once and stored envelope-encrypted in the vault; the
// non-secret project_id/client_email land in data_sources.config. Always rendered inside the
// connect modal's source-type flow; presentation via shared modal primitives, logic unchanged.
export function FirestoreDataSourceForm({ onDone, onBusyChange }: { onDone?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const t = useTranslations('appSources')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [f, setF] = useState({ name: '', serviceAccountJson: '', databaseId: '' })

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const [fileName, setFileName] = useState<string | null>(null)

  // Upload the downloaded service-account .json directly (no copy-paste). Read it client-side,
  // fill the JSON field, and auto-fill the name from project_id when the name is still empty.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the user re-select the same file later
    if (!file) return
    try {
      const text = await file.text()
      setF((p) => {
        let name = p.name
        try {
          const j = JSON.parse(text) as { project_id?: string }
          if (!name && j.project_id) name = String(j.project_id)
        } catch {
          /* not valid JSON — still show the raw text so the user can fix it */
        }
        return { ...p, serviceAccountJson: text, name }
      })
      setFileName(file.name)
      setMsg(null)
    } catch {
      setMsg({ kind: 'err', text: t('form.fileReadError') })
    }
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
        body: JSON.stringify({
          type: 'firestore',
          name: f.name,
          serviceAccountJson: f.serviceAccountJson,
          databaseId: f.databaseId.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? `failed (${res.status})`)
      track('datasource_connected', { kind: 'firestore' })
      router.refresh()
      onDone?.()
    } catch (err) {
      setMsg({ kind: 'err', text: String(err instanceof Error ? err.message : err) })
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  // preview which project/account is being connected (works for upload OR paste)
  const saPreview = (() => {
    if (!f.serviceAccountJson.trim()) return null
    try {
      const j = JSON.parse(f.serviceAccountJson) as { project_id?: string; client_email?: string }
      return j.project_id
        ? { projectId: String(j.project_id), clientEmail: j.client_email ? String(j.client_email) : '' }
        : null
    } catch {
      return null
    }
  })()

  return (
    <form onSubmit={submit} className={s.form}>
      <fieldset disabled={busy} className={s.fields}>
        <TextField label={t('form.name')} placeholder={t('form.namePlaceholderFirestore')} value={f.name} onChange={(e) => set('name', e.target.value)} required />
        <div className={s.group}>
          <span className={s.groupLabel}>{t('form.serviceAccountKey')}</span>
          <label className={s.upload}>
            <input type="file" accept="application/json,.json" onChange={onFile} className="sr-only" aria-label={t('form.uploadJson')} />
            <span className={s.uploadBtn}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('form.uploadJson')}
            </span>
            {fileName && <span className={s.fileName}>{fileName}</span>}
          </label>
          {saPreview && (
            <div className={s.preview}>
              <span className={s.previewLabel}>{t('form.saProject')}</span>
              <span className={s.previewValue}>{saPreview.projectId}</span>
              {saPreview.clientEmail ? <span className={s.previewValue}>{saPreview.clientEmail}</span> : null}
            </div>
          )}
        </div>
        <TextAreaField label={t('form.pasteJson')} placeholder='{ "type": "service_account", "project_id": …, "private_key": … }' value={f.serviceAccountJson} onChange={(e) => set('serviceAccountJson', e.target.value)} required hint={t('form.saHint')} />
        <TextField label={t('form.databaseId')} placeholder="(default)" value={f.databaseId} onChange={(e) => set('databaseId', e.target.value)} hint={t('form.databaseIdHint')} />
        {msg?.kind === 'err' && <p role="alert" className={s.error}>{msg.text}</p>}
        <div className={s.footer}>
          <ModalButton type="submit" variant="primary" disabled={busy} className="min-h-11">{busy ? t('form.testing') : t('form.submit')}</ModalButton>
        </div>
      </fieldset>
    </form>
  )
}
