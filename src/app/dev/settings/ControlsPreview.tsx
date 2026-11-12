'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BaseModal } from '@/components/modals/base-modal'
import { ModalButton, SelectField, TextField } from '@/components/modals/controls'
import { ConfirmModal } from '@/components/modals/confirm-modal'

/** Production primitives with local state only; never calls a server action. */
export function ControlsPreview() {
  const t = useTranslations('appCommon')
  const [modal, setModal] = useState<'form' | 'confirm' | null>(null)
  const [name, setName] = useState('Northstar')
  const [timezone, setTimezone] = useState('UTC')
  const [result, setResult] = useState('')
  return <>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <ModalButton onClick={() => setModal('form')}>Open form preview</ModalButton>
      <ModalButton variant="destructive" onClick={() => setModal('confirm')}>Open confirmation preview</ModalButton>
      <ModalButton disabled>Disabled action</ModalButton>
    </div>
    <p role="status" style={{ marginTop: 16 }}>{result}</p>
    <BaseModal open={modal === 'form'} onClose={() => setModal(null)} title="Workspace preferences" description="Sample form. Values are local to this preview; no account is updated." footer={<>
      <ModalButton variant="ghost" onClick={() => setModal(null)}>{t('cancel')}</ModalButton>
      <ModalButton onClick={() => { setResult(`Local preview: ${name} / ${timezone}`); setModal(null) }}>{t('confirm')}</ModalButton>
    </>}>
      <div style={{ display: 'grid', gap: 18 }}>
        <TextField label="Workspace name" value={name} onChange={event => setName(event.target.value)} />
        <SelectField label="Timezone" value={timezone} onValueChange={setTimezone} options={[
          { value: 'UTC', label: 'UTC' },
          { value: 'America/Los_Angeles', label: 'America / Los Angeles' },
          { value: 'Asia/Seoul', label: 'Asia / Seoul' },
        ]} />
      </div>
    </BaseModal>
    <ConfirmModal open={modal === 'confirm'} onClose={() => setModal(null)} onConfirm={() => { setResult('Preview confirmed. Nothing was deleted.'); setModal(null) }} title="Remove sample connection?" description="Design preview only. No data or connection will be removed." confirmVariant="destructive" />
  </>
}
