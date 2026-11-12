import { useId, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'
import { FALLBACK_CSS } from './fallback-style'

/** Presentation only; no auth, router, translation or telemetry dependency.
 * The product's empty/error-state anatomy at page scale: a centered card with an
 * optional muted code, a serif title, one muted line and primary + secondary actions. */
export function FallbackSurface({ title, description, code, home, children }: {
  title: string
  description: string
  code?: string
  home?: { href: string; label: string }
  children: ReactNode
}) {
  const titleId = useId()
  return <>
    <style>{FALLBACK_CSS}</style>
    <section className="sl-fallback" aria-labelledby={titleId}>
      {home && <a href={home.href} className="sl-fallback-brand" aria-label={home.label}>
        <span className="sl-fallback-mark"><LogoMark size={20} /></span><span>Supalens</span>
      </a>}
      <div className="sl-fallback-card">
        {code && <p className="sl-fallback-code">{code}</p>}
        <h1 id={titleId}>{title}</h1>
        <p className="sl-fallback-copy">{description}</p>
        <div className="sl-fallback-actions">{children}</div>
      </div>
    </section>
  </>
}
