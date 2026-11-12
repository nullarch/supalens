'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SourcePicker } from '@/components/agent/SourcePicker'
import s from '@/components/agent/ask-chat.module.css'

export function SourcePreview() {
  const t = useTranslations('appAsk')
  const [value, setValue] = useState('sample-a')
  const [question, setQuestion] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return <div data-source-ready={ready} style={{ maxWidth: 768, margin: '120px auto 0' }}>
    <h1>{t('chat.sourceLabel')}</h1>
    <p data-source-value>{value}</p>
    <div className={s.bar}>
      <textarea className={s.input} aria-label={t('chat.questionLabel')} value={question} onChange={event => setQuestion(event.target.value)} />
      <div className={s.barControls}>
        <SourcePicker sources={[
          { id: 'sample-a', name: 'Production / business events', engine: 'postgres' },
          { id: 'sample-b', name: `InternationalSubscriptionEntitlementReconciliation_${'Sample'.repeat(10)}`, engine: 'firestore' },
          { id: 'sample-demo', name: 'Sample data', isDemo: true },
        ]} value={value} onChange={setValue} label={t('chat.sourceLabel')} demoLabel={t('demo.tag')} />
        <button className="dx-btn-ghost" type="button">After picker</button>
      </div>
    </div>
    <p>Local selection only. No analysis or connection is performed.</p>
  </div>
}
