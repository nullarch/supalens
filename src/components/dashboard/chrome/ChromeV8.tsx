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
  const p: Record<string, ReactNode> = {
    ask: (<><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
    db: (<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7" /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /></>),
    card: (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /></>),
    bell: (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></>),
    cube: (<><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></>),
    gear: (<><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
    search: (<><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none">{p[name]}</svg>
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
      {filled
        ? <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" />
        : <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  )
}

function DashRow({ b }: { b: typeof BOARDS[number] }) {
  const [hover, setHover] = useState(false)
  const [pin, setPin] = useState(b.pinned)
  return (
    <a
      href={`/app/dashboards/${b.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px 7px 26px', textDecoration: 'none', borderRadius: 6,
        color: b.active ? 'var(--clay)' : 'var(--ink-2)',
        fontSize: 13.5, fontWeight: b.active ? 600 : 400,
        transition: 'color .18s',
      }}
    >
      {b.active && (
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 3, height: 16, borderRadius: 2, background: 'var(--clay)' }} />
      )}
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
      <span
        onClick={(e) => { e.preventDefault(); setPin(p => !p) }}
        style={{
          display: 'flex', alignItems: 'center', color: 'var(--clay)',
          opacity: pin ? 1 : (hover ? 0.55 : 0), transition: 'opacity .18s', cursor: 'pointer',
        }}
      >
        <Star filled={pin} />
      </span>
    </a>
  )
}

export default function ChromeV8({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const mono = { fontFamily: 'var(--font-mono)' }

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 272, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        {/* brand */}
        <div style={{ padding: '26px 24px 22px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ color: 'var(--clay)', display: 'flex' }}>
            <LogoMark size={17} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
        </div>

        {/* org switcher */}
        <a href="#" style={{ margin: '0 18px 8px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', borderRadius: 10, color: 'var(--ink)' }}>
          <span style={{ ...mono, width: 28, height: 28, borderRadius: 8, border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-2)' }}>AC</span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Acme Corp</span>
          <span style={{ color: 'var(--ink-3)', display: 'flex' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </a>

        <div style={{ height: 1, background: 'var(--line)', margin: '8px 24px 14px' }} />

        {/* nav */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '0 18px' }}>
          {NAV.map(item => item.group ? (
            <div key={item.href}>
              <button
                onClick={() => setOpen(o => !o)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit' }}
              >
                <span style={{ color: 'var(--ink-2)', display: 'flex' }}><Icon name={item.icon} /></span>
                <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                <span style={{ ...mono, fontSize: 11, color: 'var(--ink-3)' }}>{BOARDS.length}</span>
                <span style={{ color: 'var(--ink-3)', display: 'flex', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </button>
              {open && (
                <div style={{ position: 'relative', marginLeft: 23, paddingLeft: 1, borderLeft: '1px solid var(--line)' }}>
                  {BOARDS.map(b => <DashRow key={b.slug} b={b} />)}
                  <a
                    href="/app/dashboards"
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--clay)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-3)')}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 25px', textDecoration: 'none', color: 'var(--ink-3)', fontSize: 13, transition: 'color .18s' }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                    <span>새 대시보드</span>
                  </a>
                </div>
              )}
            </div>
          ) : (
            <a
              key={item.href}
              href={item.href}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--clay)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink)')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', textDecoration: 'none', color: 'var(--ink)', fontSize: 14, transition: 'color .18s' }}
            >
              <span style={{ color: 'var(--ink-2)', display: 'flex' }}><Icon name={item.icon} /></span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        {/* plan card */}
        <div style={{ margin: '14px 18px 16px', padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 'var(--r-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...mono, fontSize: 11, letterSpacing: '0.08em', color: 'var(--ink-3)' }}>STANDARD</span>
            <a href="#" style={{ ...mono, fontSize: 11, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: 'var(--paper-3)', margin: '12px 0 8px', overflow: 'hidden' }}>
            <div style={{ width: '64%', height: '100%', background: 'var(--clay)' }} />
          </div>
          <div style={{ ...mono, fontSize: 11, color: 'var(--ink-2)' }}>질문 3,200 / 5,000</div>
        </div>

        {/* user */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ ...mono, width: 30, height: 30, borderRadius: 999, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>JP</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>김하나</div>
            <div style={{ ...mono, fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER — borderless */}
        <header style={{ flexShrink: 0, padding: '26px clamp(24px,3vw,40px) 18px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
          <div>
            <div style={{ ...mono, fontSize: 11, letterSpacing: '0.1em', color: 'var(--ink-3)', marginBottom: 6 }}>대시보드</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em', display: 'inline-block', paddingBottom: 5, borderBottom: '2px solid var(--clay)' }}>매출 개요</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4 }}>
            <button style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 999, cursor: 'pointer', color: 'var(--ink-2)' }}><Icon name="search" /></button>
            <button style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 999, cursor: 'pointer', color: 'var(--ink-2)' }}><Icon name="bell" /></button>
            <span style={{ ...mono, width: 32, height: 32, marginLeft: 4, borderRadius: 999, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>JP</span>
          </div>
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
