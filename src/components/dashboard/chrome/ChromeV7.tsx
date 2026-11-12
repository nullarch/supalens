'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

type Dash = { name: string; slug: string; tag: string; pinned: boolean; active?: boolean }

const NAV: { label: string; href: string; icon: ReactNode }[] = [
  { label: '분석', href: '/app/ask', icon: (<><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7"/><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>) },
  { label: '데이터소스', href: '/app/sources', icon: (<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7"/><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/></>) },
]

const NAV_REST: { label: string; href: string; icon: ReactNode }[] = [
  { label: '알림', href: '/app/alerts', icon: (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></>) },
  { label: 'MCP', href: '/app/mcp', icon: (<><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M4 7l8 4.5L20 7M12 11.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></>) },
  { label: '설정', href: '/app/settings', icon: (<><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>) },
]

const DASHBOARDS: Dash[] = [
  { name: '매출 개요', slug: 'revenue', tag: 'REV', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', tag: 'TRF', pinned: true },
  { name: '전환 퍼널', slug: 'funnel', tag: 'FNL', pinned: false },
  { name: '리텐션 코호트', slug: 'retention', tag: 'RET', pinned: false },
  { name: '광고 성과', slug: 'ads', tag: 'ADS', pinned: false },
]

const StarFilled = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor"/></svg>)
const StarOutline = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>)

function DashRow({ d }: { d: Dash }) {
  const [hover, setHover] = useState(false)
  const active = !!d.active
  return (
    <a
      href={`/app/dashboards/${d.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
        padding: '8px 9px', border: '1.5px solid var(--line-2)', borderTop: 'none',
        background: active ? 'var(--clay)' : hover ? 'var(--clay-tint)' : 'var(--paper-2)',
        color: active ? 'var(--paper-2)' : 'var(--ink)',
        transition: 'background .12s',
      }}
    >
      <span style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: active ? 'var(--paper-2)' : 'var(--clay)' }}>
        {d.pinned ? <StarFilled /> : (hover ? <StarOutline /> : null)}
      </span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 700 : 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.08em', padding: '2px 5px',
        border: active ? '1.5px solid var(--paper-2)' : '1.5px solid var(--line-2)',
        color: active ? 'var(--paper-2)' : 'var(--ink-3)', background: active ? 'transparent' : 'var(--paper-3)',
      }}>{d.tag}</span>
    </a>
  )
}

export default function ChromeV7({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)

  const navBox = (item: { label: string; href: string; icon: ReactNode }) => (
    <a key={item.href} href={item.href} style={{
      display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', color: 'var(--ink)',
      padding: '11px 12px', border: '1.5px solid var(--line-2)', background: 'var(--paper-2)',
      fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
    }}>
      <span style={{ width: 18, height: 18, color: 'var(--ink-2)', display: 'flex' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">{item.icon}</svg>
      </span>
      {item.label}
    </a>
  )

  const sqBtn: React.CSSProperties = {
    width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1.5px solid var(--ink)', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer',
  }

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1.5px solid var(--ink)', background: 'var(--paper)' }}>
        {/* Brand */}
        <div style={{ padding: 16, borderBottom: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 38, height: 38, border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--clay)', background: 'var(--paper-2)' }}>
            <LogoMark size={17} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Supalens</span>
        </div>

        {/* Org switcher */}
        <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', padding: '12px 16px', borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-3)' }}>
          <span style={{ width: 30, height: 30, border: '1.5px solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', background: 'var(--paper-2)' }}>AC</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Acme Corp</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ color: 'var(--ink-3)' }}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </a>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {NAV.map(navBox)}

          {/* 대시보드 EXPANDABLE GROUP */}
          <div style={{ border: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
            <button onClick={() => setOpen(o => !o)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer',
              padding: '11px 12px', border: 'none', borderBottom: open ? '1.5px solid var(--ink)' : 'none',
              background: 'var(--ink)', color: 'var(--on-panel)',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              <span style={{ width: 18, height: 18, display: 'flex' }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>
              </span>
              <span style={{ flex: 1, textAlign: 'left' }}>대시보드</span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>5</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            {open && (
              <div>
                {DASHBOARDS.map(d => <DashRow key={d.slug} d={d} />)}
                <a href="/app/dashboards/new" style={{
                  display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
                  padding: '9px 9px', border: '1.5px dashed var(--line-2)', borderTop: 'none',
                  color: 'var(--ink-3)', background: 'var(--paper-2)',
                  fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--clay)'; e.currentTarget.style.borderColor = 'var(--clay)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.borderColor = 'var(--line-2)' }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  새 대시보드
                </a>
              </div>
            )}
          </div>

          {NAV_REST.map(navBox)}
        </nav>

        {/* Plan card */}
        <div style={{ margin: 14, marginTop: 0, border: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: '1.5px solid var(--line-2)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', color: 'var(--ink)' }}>STANDARD</span>
            <a href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--clay)', textDecoration: 'none', border: '1.5px solid var(--clay)', padding: '2px 6px' }}>업그레이드</a>
          </div>
          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-2)', marginBottom: 7 }}>질문 3,200 / 5,000</div>
            <div style={{ height: 8, border: '1.5px solid var(--ink)', background: 'var(--paper-3)' }}>
              <div style={{ width: '64%', height: '100%', background: 'var(--clay)' }} />
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* HEADER */}
        <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1.5px solid var(--ink)', background: 'var(--paper-2)' }}>
          <div style={{ display: 'flex', alignItems: 'stretch', border: '1.5px solid var(--ink)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--ink-3)', padding: '8px 10px', borderRight: '1.5px solid var(--line-2)', display: 'flex', alignItems: 'center', background: 'var(--paper-3)' }}>DASHBOARD</span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 700, color: 'var(--ink)', padding: '6px 12px', display: 'flex', alignItems: 'center' }}>매출 개요</span>
          </div>

          <div style={{ flex: 1 }} />

          <button style={sqBtn} aria-label="검색">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
          </button>
          <button style={sqBtn} aria-label="알림">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'stretch', border: '1.5px solid var(--ink)' }}>
            <span style={{ width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--paper-2)', background: 'var(--ink)' }}>JP</span>
            <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 12px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>김하나</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-3)', lineHeight: 1.3 }}>admin@example.com</span>
            </span>
          </div>
        </header>

        {/* CONTENT */}
        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
