'use client'

import { ArrowUpRight } from 'lucide-react'

import { DEMO_ASK_EVENT } from './demo-types'

/** Sends a question to the live console on this page (DemoConsole listens for the event). */
export function AskButton({ question, label, className }: { question: string; label: string; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(DEMO_ASK_EVENT, { detail: question }))}
    >
      {label}
      <ArrowUpRight size={15} aria-hidden />
    </button>
  )
}
