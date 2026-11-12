import { useId, type ReactNode } from 'react'
import Link from 'next/link'
import LogoMark from '@/components/brand/LogoMark'
import s from './invitation.module.css'

/** Shared by the real invite route and isolated local-data previews.
 * One centered card: brand mark → serif title → muted lede and actions (children). */
export function InvitationShell({ title, children }: { title: string; children?: ReactNode }) {
  const id = useId()
  return <section className={s.shell} aria-labelledby={id} data-invitation-shell>
    <div className={s.card}>
      <div className={s.head}>
        <span className={s.mark}><LogoMark size={22} /></span>
        <h1 id={id} className={s.title}>{title}</h1>
      </div>
      {children != null && <div className={s.content}>{children}</div>}
    </div>
  </section>
}

export function InvitationFailure({ title, message, home, onHome, retry }: { title: string; message: string; home: string; onHome?: () => void; retry?: { href: string; label: string; onRetry?: () => void } }) {
  return <InvitationShell title={title}>
    <p className={s.lede}>{message}</p>
    <div className={s.actions}>
      {retry && <a className="dx-btn" href={retry.href} onClick={retry.onRetry ? event => { event.preventDefault(); retry.onRetry?.() } : undefined}>{retry.label}</a>}
      <Link className={`${retry ? 'dx-btn-ghost' : 'dx-btn'} ${s.home}`} href="/app" prefetch={false} onClick={onHome ? event => { event.preventDefault(); onHome() } : undefined}>{home}</Link>
    </div>
  </InvitationShell>
}

export function InvitationReady({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <InvitationShell title={title}>
    <p className={s.lede}>{description}</p>
    {children}
  </InvitationShell>
}
