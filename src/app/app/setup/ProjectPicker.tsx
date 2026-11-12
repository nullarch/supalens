'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import type { SupabaseProjectChoice } from '@/lib/data-sources/supabase-projects'
import { ProjectPickerView } from './ProjectPickerView'

const POLL_MS = 4000

/** A project is settled once it is connected, failed, or cannot be provisioned at all. */
function isTerminal(p: SupabaseProjectChoice): boolean {
  return p.state === 'active' || p.state === 'error' || p.state === 'disabled' || !p.bootstrappable
}

export interface ProjectPickerProps {
  initialProjects: SupabaseProjectChoice[]
  /** owner/admin — minting a credential on the customer's DB is not a member action. */
  canProvision: boolean
  /** The stored OAuth grant is dead: show the re-authorize CTA, not an (empty) project list. */
  initialNeedsReconnect?: boolean
}

/**
 * Pick which Supabase project Supalens watches first.
 *
 * Connecting no longer provisions every project in the account, so this is where the choice is
 * made — and where it resumes: the list is rebuilt from live state on every render and poll, so
 * a closed tab, a reload or a colleague finishing the job all land on the same screen.
 */
export function ProjectPicker({ initialProjects, canProvision, initialNeedsReconnect = false }: ProjectPickerProps) {
  const t = useTranslations('appSetup.projects')
  const router = useRouter()

  const [projects, setProjects] = useState(initialProjects)
  const [needsReconnect, setNeedsReconnect] = useState(initialNeedsReconnect)
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Pre-select the first connectable project — usually the production one (the list is sorted
    // production-first), so the common case is one click.
    const first = initialProjects.find((p) => p.bootstrappable && p.state === 'none')
    return new Set(first ? [first.ref] : [])
  })
  const [submitting, setSubmitting] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // A plan cap reads as a warning, not a failure — it explains itself and points at the plan.
  const [errorTone, setErrorTone] = useState<'error' | 'warning'>('error')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/setup/supabase-projects', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { projects?: SupabaseProjectChoice[]; needsReconnect?: boolean }
      setNeedsReconnect(Boolean(body.needsReconnect))
      if (!body.projects) return
      setProjects(body.projects)
      setSubmitting((prev) => {
        if (prev.size === 0) return prev
        // Once a ref reaches a terminal state the optimistic "submitting" marker is redundant.
        const next = new Set(prev)
        for (const p of body.projects!) if (next.has(p.ref) && isTerminal(p)) next.delete(p.ref)
        return next
      })
    } catch {
      /* transient — the next tick retries */
    }
  }, [])

  // Poll only while something is actually in flight, and stop the moment everything settles —
  // this endpoint calls the Management API, so an idle poll would be a pointless upstream hit.
  const inFlight = submitting.size > 0 || projects.some((p) => p.state === 'pending')
  useEffect(() => {
    if (!inFlight) return
    pollRef.current = setInterval(refresh, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [inFlight, refresh])

  // When every selected project has landed, re-render the server page so the activation state
  // (and therefore the next Golden Path step) catches up.
  const settledRef = useRef(false)
  useEffect(() => {
    if (inFlight) {
      settledRef.current = true
      return
    }
    if (settledRef.current) {
      settledRef.current = false
      router.refresh()
    }
  }, [inFlight, router])

  async function provision(refs: string[]) {
    if (refs.length === 0) return
    setError(null)
    setSubmitting((prev) => new Set([...prev, ...refs]))
    try {
      const res = await fetch('/api/setup/supabase-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; remaining?: number }
        if (body.error === 'reconnect_required') setNeedsReconnect(true)
        setErrorTone(body.error === 'limit_reached' && body.message ? 'warning' : 'error')
        // 'limit_reached' carries a server-localized message (same shape as /api/data-sources),
        // so the plan cap explains itself instead of reading as a generic failure.
        setError(
          body.error === 'forbidden'
            ? t('adminOnly')
            : body.error === 'reconnect_required'
              ? null
              : body.error === 'limit_reached' && body.message
                ? body.message
                : t('requestFailed'),
        )
        setSubmitting((prev) => {
          const next = new Set(prev)
          for (const r of refs) next.delete(r)
          return next
        })
        return
      }
      await refresh()
    } catch {
      setErrorTone('error')
      setError(t('requestFailed'))
      setSubmitting((prev) => {
        const next = new Set(prev)
        for (const r of refs) next.delete(r)
        return next
      })
    }
  }

  function toggle(ref: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  return <ProjectPickerView projects={projects} canProvision={canProvision} needsReconnect={needsReconnect} selected={selected} submitting={submitting} error={error} errorTone={errorTone} onToggle={toggle} onProvision={provision} />
}
