'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

const NAV = [
  { label: '분석', href: '/app/ask', icon: 'ask' },
  { label: '데이터소스', href: '/app/sources', icon: 'db' },
  { label: '대시보드', href: '/app/dashboards', icon: 'card', group: true },
  { label: '알림', href: '/app/alerts', icon: 'bell' },
  { label: 'MCP', href: '/app/mcp', icon: 'cube' },
  { label: '설정', href: '/app/settings', icon: 'gear' },
]

const BOARDS = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]

function Icon({ name }: { name: string }) {
  const c = { fill: 'none', stroke: 'currentColor' as const, strokeWidth: 1.7 }
  switch (name) {
    case 'ask':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" {...c} strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" {...c} /><path d="M19 16.5 21.5 19" {...c} strokeLinecap="round" /></svg>)
    case 'db':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><ellipse cx="12" cy="5.5" rx="7" ry="2.8" {...c} /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...c} /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...c} /></svg>)
    case 'card':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...c} /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...c} /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...c} /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...c} /></svg>)
    case 'bell':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...c} strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" {...c} /></svg>)
    case 'cube':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" {...c} strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" {...c} strokeLinejoin="round" /></svg>)
    case 'gear':
      return (<svg viewBox="0 0 24 24" width={18} height={18} fill="none"><circle cx="12" cy="12" r="3" {...c} /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" {...c} strokeLinecap="round" /></svg>)
    default:
      return null
  }
}

function Star({ filled }: { filled: boolean }) {
  return filled ? (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
  )
}

function BoardRow({ board }: { board: typeof BOARDS[number] }) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(board.pinned)
  const showStar = pinned || hover
  return (
    <a
      href={`/app/dashboards/${board.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
        padding: '7px 10px 7px 12px', borderRadius: 10, fontSize: 13.5,
        background: board.active ? 'var(--clay-tint)' : hover ? 'rgba(33,30,26,0.035)' : 'transparent',
        color: board.active ? 'var(--clay)' : 'var(--ink-2)',
        fontWeight: board.active ? 600 : 450, transition: 'background .15s, color .15s',
      }}
    >
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{board.name}</span>
      <span
        onClick={(e) => { e.preventDefault(); setPinned((p) => !p) }}
        style={{
          display: 'flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center',
          color: pinned ? 'var(--clay)' : 'var(--ink-3)', opacity: showStar ? 1 : 0,
          transition: 'opacity .15s', cursor: 'pointer',
        }}
      >
        <Star filled={pinned} />
      </span>
    </a>
  )
}

export default function ChromeV9({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const sorted = [...BOARDS].sort((a, b) => Number(b.pinned) - Number(a.pinned))

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 20px 14px' }}>
          <span style={{ color: 'var(--clay)', display: 'flex' }}>
            <LogoMark size={17} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, color: 'var(--ink)', fontWeight: 600 }}>Supalens</span>
        </div>

        {/* Org switcher */}
        <div style={{ padding: '0 16px 12px' }}>
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer' }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--panel)', color: 'var(--on-panel)', fontFamily: 'var(--font-mono)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>AC</span>
            <span style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500, flex: 1, textAlign: 'left' }}>Acme Corp</span>
            <span style={{ color: 'var(--ink-3)', display: 'flex' }}><svg viewBox="0 0 24 24" width={16} height={16} fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </button>
        </div>

        {/* CURRENT DASHBOARD SWITCHER CHIP */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--ink-3)', textTransform: 'uppercase', padding: '0 4px 6px' }}>현재 대시보드</div>
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 'var(--r-card)', border: '1px solid var(--line-2)', background: 'var(--paper-3)', cursor: 'pointer', boxShadow: 'var(--shadow-lift)' }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--clay-tint)', color: 'var(--clay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /></svg>
            </span>
            <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>매출 개요</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>5개 보드 · 전환</span>
            </span>
            <span style={{ color: 'var(--ink-2)', display: 'flex' }}><svg viewBox="0 0 24 24" width={17} height={17} fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </button>
        </div>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '4px 16px 16px' }}>
          {NAV.map((item) => {
            if (!item.group) {
              return (
                <a key={item.href} href={item.href} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10, textDecoration: 'none', color: 'var(--ink-2)', fontSize: 14, marginBottom: 2 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(33,30,26,0.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ color: 'var(--ink-3)', display: 'flex' }}><Icon name={item.icon} /></span>
                  <span>{item.label}</span>
                </a>
              )
            }
            return (
              <div key={item.href} style={{ marginBottom: 2 }}>
                <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                  <span style={{ color: 'var(--clay)', display: 'flex' }}><Icon name={item.icon} /></span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{BOARDS.length}</span>
                  <span style={{ color: 'var(--ink-3)', display: 'flex', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
                    <svg viewBox="0 0 24 24" width={15} height={15} fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </button>
                {open && (
                  <div style={{ position: 'relative', margin: '2px 0 4px 22px', paddingLeft: 10, borderLeft: '1px solid var(--line-2)' }}>
                    {sorted.map((b) => (<BoardRow key={b.slug} board={b} />))}
                    <a href="/app/dashboards/new" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 7px 12px', borderRadius: 10, textDecoration: 'none', fontSize: 13, color: 'var(--ink-3)', transition: 'color .15s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--clay)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-3)')}>
                      <svg viewBox="0 0 24 24" width={14} height={14} fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                      <span>새 대시보드</span>
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Plan card */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ borderRadius: 'var(--r-card)', border: '1px solid var(--line)', background: 'var(--paper-3)', padding: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-2)' }}>STANDARD</span>
              <a href="/app/settings" style={{ fontSize: 11.5, color: 'var(--clay)', textDecoration: 'none', fontWeight: 600 }}>업그레이드</a>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--line-2)', overflow: 'hidden', marginBottom: 7 }}>
              <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>질문 3,200 / 5,000</div>
          </div>
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--panel)', color: 'var(--on-panel)', fontFamily: 'var(--font-mono)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>JP</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>김하나</span>
            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</span>
          </span>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(20px,3vw,32px)', height: 64, flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>대시보드</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>매출 개요</h1>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', borderRadius: 'var(--r-pill)', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-3)', minWidth: 180 }}>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <span style={{ fontSize: 13 }}>검색</span>
          </div>
          <button style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></svg>
          </button>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--panel)', color: 'var(--on-panel)', fontFamily: 'var(--font-mono)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>JP</span>
        </header>

        {/* MAIN */}
        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
