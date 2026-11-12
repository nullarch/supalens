'use client'

import { useMemo, useState } from 'react'
import { IncidentTriage, type IncidentTriageIO } from '@/app/app/incidents/IncidentTriage'
import type { Incident } from '@/lib/alerts/incidents'

export function IncidentTriagePreview({ mode, incident }: { mode: string; incident: Incident }) {
  const [ack, setAck] = useState(incident.ack)
  const [feedback, setFeedback] = useState(incident.feedback)
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null)
  const [calls, setCalls] = useState<string[]>([])
  const [restored, setRestored] = useState(false)
  const actions = useMemo<IncidentTriageIO>(() => {
    async function result(name: string) {
      setCalls(old => [...old, name])
      await new Promise(resolve => setTimeout(resolve, 600))
      if (!restored && mode === 'throw') throw new Error('Sample write response lost')
      return restored || mode !== 'failure'
    }
    return {
      ack: async (id, kind) => {
        if (!(await result(`ack:${id}:${kind}`))) return { ok: false, reason: 'error' }
        setAck(kind ? { kind, at: '2026-09-07T12:00:00Z', by: null } : null)
        return { ok: true, data: undefined }
      },
      feedback: async (id, value, correction) => {
        if (!(await result(`feedback:${id}:${value}:${correction}`))) return { ok: false, reason: 'error' }
        setFeedback({ value, correction: correction ?? null })
        return { ok: true, data: undefined }
      },
      snooze: async (id, hours) => {
        if (!(await result(`snooze:${id}:${hours}`))) return { ok: false, reason: 'error' }
        setSnoozedUntil(hours ? '2099-01-01T00:00:00Z' : null)
        return { ok: true, data: undefined }
      },
      refresh: () => setCalls(old => [...old, 'refresh']),
    }
  }, [mode, restored])
  return <div data-triage-preview>
    <p style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 16 }}>Local sample actions only. No acknowledgement, feedback, snooze or notification is written. The mute timestamp is an explicit example.</p>
    <IncidentTriage key={mode} eventId={incident.id} ack={ack} feedback={feedback} hasExplanation={Boolean(incident.explanation)} snoozedUntil={snoozedUntil} timezone="Asia/Seoul" actions={actions} />
    <button type="button" className="dx-btn-ghost" style={{ marginTop: 16 }} onClick={() => setRestored(true)}>Restore sample responses</button>
    <pre data-triage-calls style={{ font: '12px/1.6 var(--font-sans)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 12 }}>{JSON.stringify(calls)}</pre>
  </div>
}
