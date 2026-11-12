'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

const NAV = [
  { label: '분석', href: '/app/ask', icon: (
    <><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7"/><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>
  ) },
  { label: '데이터소스', href: '/app/sources', icon: (
    <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7"/><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/></>
  ) },
]

const NAV_REST = [
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

const DASHBOARDS = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]

const CardIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>
)

const StarFilled = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor"/></svg>
)
const StarOutline = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
)

function NavRow({ label, href, icon }: { label: string; href: string; icon: ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <a href={href} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--r-pill)', textDecoration: 'none', color: hover ? 'var(--ink)' : 'var(--ink-2)', background: hover ? 'var(--clay-tint)' : 'transparent', transition: 'all .18s ease', fontSize: 14 }}>
      <span style={{ display: 'flex', color: hover ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .18s ease' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">{icon}</svg>
      </span>
      {label}
    </a>
  )
}

function DashRow({ d }: { d: { name: string; slug: string; pinned: boolean; active: boolean } }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(d.pinned)
  return (
    <a href={`/app/dashboards/${d.slug}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px 7px 14px', marginLeft: 22, borderRadius: 'var(--r-pill)', textDecoration: 'none', fontSize: 13.5,
        color: d.active ? 'var(--clay-deep)' : hover ? 'var(--ink)' : 'var(--ink-2)',
        background: d.active ? 'var(--clay-tint)' : hover ? 'rgba(33,30,26,0.035)' : 'transparent',
        fontWeight: d.active ? 600 : 400, transition: 'all .18s ease' }}>
      <span style={{ position: 'absolute', left: -8, top: '50%', width: 8, height: 1, background: 'var(--line-2)', transform: 'translateY(-50%)' }} />
      <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned(!pinned) }}
        style={{ display: 'flex', color: pinned ? 'var(--clay)' : 'var(--ink-3)', opacity: pinned ? 1 : hover ? 0.7 : 0, transition: 'opacity .18s ease', cursor: 'pointer' }}>
        {pinned ? <StarFilled /> : <StarOutline />}
      </span>
      <span style={{ flex: 1 }}>{d.name}</span>
    </a>
  )
}

export default function ChromeV1({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const [dashHover, setDashHover] = useState(false)
  const [newHover, setNewHover] = useState(false)
  const sorted = [...DASHBOARDS].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>
        {/* Brand */}
        <div style={{ padding: '20px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: 'var(--clay)', display: 'flex' }}>
              <LogoMark size={18} />
            </span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
          </div>
          {/* Org chip */}
          <button style={{ marginTop: 16, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>AC</span>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>Acme Corp</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)' }}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '4px 12px 12px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--ink-3)', padding: '8px 12px 6px' }}>MENU</div>
          {NAV.map((n) => <NavRow key={n.href} {...n} />)}

          {/* 대시보드 expandable group */}
          <div onMouseEnter={() => setDashHover(true)} onMouseLeave={() => setDashHover(false)}>
            <button onClick={() => setOpen(!open)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, fontFamily: 'var(--font-sans)',
                color: dashHover ? 'var(--ink)' : 'var(--ink-2)', background: dashHover ? 'var(--clay-tint)' : 'transparent', transition: 'all .18s ease' }}>
              <span style={{ display: 'flex', color: dashHover ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .18s ease' }}><CardIcon /></span>
              <span style={{ flex: 1 }}>대시보드</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>5</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s ease' }}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            {open && (
              <div style={{ position: 'relative', marginTop: 2 }}>
                <span style={{ position: 'absolute', left: 26, top: 6, bottom: 34, width: 1, background: 'var(--line)' }} />
                {sorted.map((d) => <DashRow key={d.slug} d={d} />)}
                {/* + 새 대시보드 */}
                <a href="/app/dashboards/new" onMouseEnter={() => setNewHover(true)} onMouseLeave={() => setNewHover(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 14px', marginLeft: 22, borderRadius: 'var(--r-pill)', textDecoration: 'none', fontSize: 13, fontFamily: 'var(--font-mono)',
                    color: newHover ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .18s ease' }}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  새 대시보드
                </a>
              </div>
            )}
          </div>

          {NAV_REST.map((n) => <NavRow key={n.href} {...n} />)}
        </nav>

        {/* FOOTER: plan + user */}
        <div style={{ padding: '12px', borderTop: '1px solid var(--line)' }}>
          <div style={{ padding: '12px 13px', borderRadius: 'var(--r-card)', background: 'var(--paper-3)', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--ink)' }}>STANDARD</span>
              <a href="/app/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
            </div>
            <div style={{ marginTop: 9, height: 5, borderRadius: 999, background: 'var(--line-2)', overflow: 'hidden' }}>
              <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
            </div>
            <div style={{ marginTop: 7, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>질문 3,200 / 5,000</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px 4px' }}>
            <span style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>JP</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>김하나</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>admin@example.com</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(20px,3vw,32px)', height: 60, flexShrink: 0, background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)' }}>대시보드</span>
            <span style={{ color: 'var(--line-2)', fontSize: 13 }}>/</span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>매출 개요</span>
          </div>
          <div style={{ flex: 1 }} />
          {/* slim search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 'var(--r-pill)', background: 'var(--paper-2)', border: '1px solid var(--line)', width: 220, maxWidth: '32vw' }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)', flexShrink: 0 }}><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>대시보드 검색…</span>
          </div>
          <button style={{ width: 36, height: 36, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink-2)' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></svg>
          </button>
          <span style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12 }}>JP</span>
        </header>

        {/* CONTENT */}
        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
