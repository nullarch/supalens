'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import LogoMark from '@/components/brand/LogoMark'
import s from './Shell.module.css'

// Real, navigable routes (next/link).
const NAV = [
  { href: '/test/app', label: '질문하기' },
  { href: '/test/app/dashboards', label: '대시보드' },
  { href: '/test/app/alerts', label: '알림' },
] as const

// Inert rows — present in the IA but non-navigating in this prototype.
const INERT = ['데이터 소스', 'MCP', '설정'] as const

const TITLES: Record<string, string> = {
  '/test/app': '질문하기',
  '/test/app/dashboards': '대시보드',
  '/test/app/alerts': '알림',
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const title = TITLES[pathname] ?? '질문하기'

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          <LogoMark size={20} />
          <span className={s.wordmark}>SUPALENS</span>
        </div>

        <nav className={s.nav}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={s.navItem} data-active={pathname === n.href}>
              {n.label}
            </Link>
          ))}
          <div className={s.navGap} />
          {INERT.map((label) => (
            <span key={label} className={s.navInert} aria-disabled>
              {label}
            </span>
          ))}
        </nav>

        <div className={s.sideBottom}>
          <div className={s.meter}>
            <div className={s.meterHead}>
              <span className={s.meterLabel}>질문</span>
              <span className={s.meterCount}>84 / 150</span>
            </div>
            <div className={s.meterTrack}>
              <div className={s.meterFill} />
            </div>
          </div>
          <div className={s.user}>
            <span className={s.avatar} aria-hidden>
              ㅈㅎ
            </span>
            <span className={s.userName}>정현</span>
          </div>
        </div>
      </aside>

      <div className={s.mainCol}>
        <header className={s.topbar}>
          <span className={s.pageTitle}>{title}</span>
          <div className={s.topRight}>
            <span className={s.orgChip}>acme-org</span>
            <a
              className={`cx-link ${s.docs}`}
              href="https://supalens.ai/docs"
              target="_blank"
              rel="noreferrer"
            >
              문서 ↗
            </a>
          </div>
        </header>
        <main className={s.content}>{children}</main>
      </div>
    </div>
  )
}
