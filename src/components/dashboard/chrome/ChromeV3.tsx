'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

const navItems = [
  { label: '분석', href: '/app/ask', icon: (
    <><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7"/><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>
  ) },
  { label: '데이터소스', href: '/app/sources', icon: (
    <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7"/><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/></>
  ) },
]

const tailItems = [
  { label: '알림', href: '/app/alerts', icon: (
    <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></>
  ) },
  { label: 'MCP', href: '/app/mcp', icon: (
    <><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M4 7l8 4.5L20 7M12 11.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></>
  ) },
  { label: '설정', href: '/app/settings', icon: (
    <><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>
  ) },
]

const dashboards = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]
const ordered = [...dashboards].sort((a, b) => Number(b.pinned) - Number(a.pinned))

const dashIcon = (
  <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></>
)

function NavRow({ label, href, icon }: { label: string; href: string; icon: ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <a href={href} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10,
        textDecoration: 'none', color: hover ? 'var(--ink)' : 'var(--ink-2)',
        background: hover ? 'var(--paper-3)' : 'transparent', transition: 'all .16s ease', fontSize: 14 }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" style={{ color: hover ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .16s ease' }}>{icon}</svg>
      {label}
    </a>
  )
}

function DashRow({ d, isLast }: { d: typeof dashboards[number]; isLast: boolean }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(d.pinned)
  return (
    <a href={`/app/dashboards/${d.slug}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px 7px 24px',
        marginLeft: 22, borderRadius: 9, textDecoration: 'none', fontSize: 13.5,
        color: d.active ? 'var(--clay)' : hover ? 'var(--ink)' : 'var(--ink-2)',
        background: d.active ? 'var(--clay-tint)' : hover ? 'var(--paper-3)' : 'transparent',
        fontWeight: d.active ? 600 : 400, transition: 'all .16s ease' }}>
      {/* vertical guide line segment */}
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: isLast ? '50%' : 0, width: 1, background: 'var(--line-2)' }} />
      {/* tick */}
      <span style={{ position: 'absolute', left: 0, top: '50%', width: 12, height: 1, background: 'var(--line-2)' }} />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
      <button onClick={(e) => { e.preventDefault(); setPinned(!pinned) }}
        style={{ display: 'flex', border: 'none', background: 'none', padding: 0, cursor: 'pointer',
          color: pinned ? 'var(--clay)' : 'var(--ink-3)', opacity: pinned ? 1 : hover ? 0.7 : 0, transition: 'opacity .16s ease' }}>
        {pinned ? (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
        )}
      </button>
    </a>
  )
}

export default function ChromeV3({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const [groupHover, setGroupHover] = useState(false)
  const [newHover, setNewHover] = useState(false)

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)',
      fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>

      {/* SIDEBAR */}
      <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>

        {/* Brand */}
        <div style={{ padding: '20px 18px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--clay)', display: 'flex' }}>
            <LogoMark size={17} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
        </div>

        {/* Org switcher */}
        <a href="#" style={{ margin: '0 12px 6px', padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 10,
          textDecoration: 'none', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--panel)', color: 'var(--on-panel)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>AC</span>
          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>Acme Corp</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)' }}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </a>

        {/* Nav (scrollable) */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '8px 12px 12px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink-3)',
            textTransform: 'uppercase', padding: '8px 12px 6px' }}>워크스페이스</div>

          {navItems.map((it) => <NavRow key={it.href} {...it} />)}

          {/* 대시보드 expandable group */}
          <div onMouseEnter={() => setGroupHover(true)} onMouseLeave={() => setGroupHover(false)}>
            <button onClick={() => setOpen(!open)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10,
                border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, fontFamily: 'inherit',
                color: groupHover || open ? 'var(--ink)' : 'var(--ink-2)',
                background: groupHover ? 'var(--paper-3)' : 'transparent', transition: 'all .16s ease' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" style={{ color: open ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .16s ease' }}>{dashIcon}</svg>
              <span style={{ flex: 1 }}>대시보드</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{dashboards.length}</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)',
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s ease' }}>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {open && (
              <div style={{ position: 'relative', marginTop: 2, marginBottom: 2 }}>
                {ordered.map((d, i) => (
                  <DashRow key={d.slug} d={d} isLast={false} />
                ))}
                {/* + 새 대시보드 — ghost row hanging off guide line */}
                <a href="/app/dashboards/new" onMouseEnter={() => setNewHover(true)} onMouseLeave={() => setNewHover(false)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 7px 24px',
                    marginLeft: 22, borderRadius: 9, textDecoration: 'none', fontSize: 13,
                    color: newHover ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .16s ease' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: '50%', width: 1, background: 'var(--line-2)' }} />
                  <span style={{ position: 'absolute', left: 0, top: '50%', width: 12, height: 1, background: 'var(--line-2)',
                    borderTop: '1px dashed var(--line-2)' }} />
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  새 대시보드
                </a>
              </div>
            )}
          </div>

          {tailItems.map((it) => <NavRow key={it.href} {...it} />)}
        </nav>

        {/* Plan card */}
        <div style={{ margin: 12, padding: 14, borderRadius: 'var(--r-card)', border: '1px solid var(--line)', background: 'var(--paper)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--ink)' }}>STANDARD</span>
            <a href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
          </div>
          <div style={{ height: 5, borderRadius: 'var(--r-pill)', background: 'var(--paper-3)', overflow: 'hidden' }}>
            <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 'var(--r-pill)' }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 7 }}>질문 3,200 / 5,000</div>
        </div>

        {/* User */}
        <div style={{ padding: '10px 16px 16px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--line)' }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--clay)', color: 'var(--paper-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>JP</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>김하나</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER */}
        <header style={{ flexShrink: 0, height: 64, display: 'flex', alignItems: 'center', gap: 16,
          padding: '0 clamp(20px,3vw,32px)', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--ink-3)',
              textTransform: 'uppercase' }}>대시보드 /</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em',
              color: 'var(--ink)', lineHeight: 1.1 }}>매출 개요</h1>
          </div>
          <button style={{ display: 'flex', border: 'none', background: 'none', padding: 6, cursor: 'pointer', color: 'var(--ink-2)' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></svg>
          </button>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--clay)', color: 'var(--paper-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>JP</span>
        </header>

        {/* MAIN */}
        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
