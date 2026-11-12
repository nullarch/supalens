'use client'

import { useEffect, useRef, useState } from 'react'

import { WidgetRenderer } from '@/components/dashboard/widgets'
import s from './OnboardingWizard.module.css'

// Act 1 of the onboarding wizard: a compact auto-playing replay of one canned
// question → widgets → answer loop. Each effect run cancels its own timeline on cleanup.
// The specs are JSON-safe VisualizationSpec envelopes with persisted samples (zero queries,
// zero LLM) extracted server-side from the canned demo KPI catalog.

interface Step {
  qChars: number
  statShown: boolean
  chartShown: boolean
  aChars: number
  done: boolean
}

const EMPTY: Step = { qChars: 0, statShown: false, chartShown: false, aChars: 0, done: false }

export function WizardReplay({
  question,
  answer,
  statSpec,
  chartSpec,
  onDone,
}: {
  question: string
  answer: string
  statSpec: unknown
  chartSpec: unknown
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>(EMPTY)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    let cancelled = false
    const alive = () => !cancelled
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      setStep({ qChars: question.length, statShown: true, chartShown: true, aChars: answer.length, done: true })
      doneRef.current()
      return
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function play() {
      setStep(EMPTY)
      await sleep(450)
      for (let i = 1; i <= question.length; i++) {
        if (!alive()) return
        setStep((p) => ({ ...p, qChars: i }))
        await sleep(32)
      }
      await sleep(500)
      if (!alive()) return
      setStep((p) => ({ ...p, statShown: true }))
      await sleep(650)
      if (!alive()) return
      setStep((p) => ({ ...p, chartShown: true }))
      await sleep(800)
      for (let i = 3; i <= answer.length; i += 3) {
        if (!alive()) return
        setStep((p) => ({ ...p, aChars: Math.min(i, answer.length) }))
        await sleep(26)
      }
      if (!alive()) return
      setStep((p) => ({ ...p, aChars: answer.length, done: true }))
      doneRef.current()
    }
    void play()
    return () => {
      cancelled = true
    }
  }, [question, answer])

  return (
    <div className={s.replay}>
      <div className={s.replayQ}>
        {question.slice(0, step.qChars)}
        {step.qChars > 0 && step.qChars < question.length && <span className={s.caret} aria-hidden />}
      </div>
      {step.statShown && (
        <div className={s.replayWidgets}>
          <div className={s.replayStat}>
            <WidgetRenderer spec={statSpec} menu={null} fill />
          </div>
          {step.chartShown && (
            <div className={s.replayChart}>
              <WidgetRenderer spec={chartSpec} menu={null} fill />
            </div>
          )}
        </div>
      )}
      {step.aChars > 0 && (
        <p className={s.replayAnswer}>
          {answer.slice(0, step.aChars)}
          {!step.done && <span className={s.caret} aria-hidden />}
        </p>
      )}
    </div>
  )
}
