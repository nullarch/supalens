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

const DASHBOARDS = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 } as const
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' } as const
  switch (name) {
    case 'ask': return <svg {...common}><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" {...p} strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" {...p} /><path d="M19 16.5 21.5 19" {...p} strokeLinecap="round" /></svg>
    case 'db': return <svg {...common}><ellipse cx="12" cy="5.5" rx="7" ry="2.8" {...p} /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...p} /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...p} /></svg>
    case 'card': return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...p} /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...p} /></svg>
    case 'bell': return <svg {...common}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...p} strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" {...p} /></svg>
    case 'cube': return <svg {...common}><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" {...p} strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" {...p} strokeLinejoin="round" /></svg>
    case 'gear': return <svg {...common}><circle cx="12" cy="12" r="3" {...p} /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" {...p} strokeLinecap="round" /></svg>
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="6" {...p} /><path d="M15.5 15.5 20 20" {...p} strokeLinecap="round" /></svg>
    default: return null
  }
}

function StarFilled() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" /></svg>
}
function StarOutline() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
}

function DashRow({ d }: { d: typeof DASHBOARDS[number] }) {
  const [hover, setHover] = useState(false)
  const [picked, setPicked] = useState(d.pinned)
  return (
    <a
      href={`/app/dashboards/${d.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', margin: '1px 0', borderRadius: 10,
        textDecoration: 'none', fontSize: 13.5, position: 'relative',
        fontWeight: d.active ? 600 : 400,
        color: d.active ? 'var(--paper)' : 'var(--on-panel-2)',
        background: d.active ? 'var(--clay)' : hover ? 'rgba(233,226,212,0.06)' : 'transparent',
        boxShadow: d.active ? 'var(--shadow-clay)' : 'none',
        transition: 'background .18s, color .18s',
      }}
    >
      <span
        onClick={(e) => { e.preventDefault(); setPicked((v) => !v) }}
        style={{
          display: 'flex', width: 16, justifyContent: 'center',
          color: d.active ? 'var(--paper)' : 'var(--clay)',
          opacity: picked ? 1 : hover ? 0.7 : 0,
          transition: 'opacity .15s',
        }}
      >
        {picked ? <StarFilled /> : <StarOutline />}
      </span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
    </a>
  )
}

export default function ChromeV2({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const [newHover, setNewHover] = useState(false)

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', color: 'var(--on-panel)' }}>
        {/* Brand */}
        <div style={{ padding: '20px 18px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--clay)', display: 'flex' }}>
            <LogoMark size={20} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--on-panel)' }}>Supalens</span>
        </div>

        {/* Org switcher */}
        <button style={{
          margin: '0 14px 14px', padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--panel-2)', border: 'none', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: 'var(--clay)', color: 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          }}>AC</span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: 'var(--on-panel)' }}>Acme Corp</span>
          <span style={{ color: 'var(--on-panel-2)', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px' }}>
          {NAV.map((item) => {
            if (item.group) {
              return (
                <div key={item.label}>
                  <button
                    onClick={() => setOpen((v) => !v)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 11,
                      padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'transparent', color: 'var(--on-panel)', fontSize: 14, fontWeight: 500,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <span style={{ display: 'flex', color: 'var(--on-panel-2)' }}><Icon name={item.icon} /></span>
                    <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--on-panel-2)',
                      background: 'var(--panel-2)', borderRadius: 999, padding: '1px 7px',
                    }}>{DASHBOARDS.length}</span>
                    <span style={{ display: 'flex', color: 'var(--on-panel-2)', transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  </button>
                  {open && (
                    <div style={{ position: 'relative', margin: '2px 0 4px', paddingLeft: 20 }}>
                      <span style={{ position: 'absolute', left: 17, top: 4, bottom: 4, width: 1, background: 'rgba(233,226,212,0.13)' }} />
                      {DASHBOARDS.map((d) => <DashRow key={d.slug} d={d} />)}
                      <a
                        href="/app/dashboards/new"
                        onMouseEnter={() => setNewHover(true)}
                        onMouseLeave={() => setNewHover(false)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', marginTop: 2,
                          borderRadius: 10, textDecoration: 'none', fontSize: 13,
                          fontFamily: 'var(--font-mono)',
                          color: newHover ? 'var(--clay)' : 'var(--on-panel-2)',
                          background: newHover ? 'rgba(233,226,212,0.06)' : 'transparent',
                          transition: 'color .15s, background .15s',
                        }}
                      >
                        <span style={{ display: 'flex' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                        </span>
                        새 대시보드
                      </a>
                    </div>
                  )}
                </div>
              )
            }
            return (
              <a
                key={item.label}
                href={item.href}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(233,226,212,0.06)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 10,
                  textDecoration: 'none', color: 'var(--on-panel)', fontSize: 14, fontWeight: 500,
                  transition: 'background .15s',
                }}
              >
                <span style={{ display: 'flex', color: 'var(--on-panel-2)' }}><Icon name={item.icon} /></span>
                <span>{item.label}</span>
              </a>
            )
          })}
        </nav>

        {/* Plan card */}
        <div style={{ margin: '0 14px 14px', padding: '13px 14px', background: 'var(--panel-2)', borderRadius: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--on-panel)' }}>STANDARD</span>
            <a href="/app/settings" style={{ fontSize: 11.5, color: 'var(--clay)', textDecoration: 'none', fontWeight: 600 }}>업그레이드</a>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'rgba(233,226,212,0.12)', overflow: 'hidden', marginBottom: 7 }}>
            <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--on-panel-2)' }}>질문 3,200 / 5,000</div>
        </div>

        {/* User */}
        <div style={{ borderTop: '1px solid rgba(233,226,212,0.1)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 999, background: 'rgba(233,226,212,0.1)', color: 'var(--on-panel)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700,
          }}>JP</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-panel)' }}>김하나</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--on-panel-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</div>
          </div>
        </div>
      </aside>

      {/* RIGHT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER — light */}
        <header style={{
          flexShrink: 0, height: 70, display: 'flex', alignItems: 'center', gap: 16,
          padding: '0 clamp(20px,3vw,32px)', background: 'var(--paper)', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 2 }}>대시보드</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 9 }}>
              매출 개요
              <span style={{ color: 'var(--clay)', display: 'flex' }}><StarFilled /></span>
            </h1>
          </div>
          <button style={{
            width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--line)', borderRadius: 999, background: 'var(--paper-2)', color: 'var(--ink-2)', cursor: 'pointer',
          }}>
            <Icon name="search" size={18} />
          </button>
          <button style={{
            width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
            border: '1px solid var(--line)', borderRadius: 999, background: 'var(--paper-2)', color: 'var(--ink-2)', cursor: 'pointer',
          }}>
            <Icon name="bell" size={18} />
            <span style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', border: '1.5px solid var(--paper-2)' }} />
          </button>
          <span style={{
            width: 38, height: 38, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
            boxShadow: 'var(--shadow-clay)',
          }}>JP</span>
        </header>

        {/* MAIN */}
        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
