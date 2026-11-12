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

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 } as const
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{ flexShrink: 0 }}>
      {name === 'ask' && (<><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" {...p} strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" {...p} /><path d="M19 16.5 21.5 19" {...p} strokeLinecap="round" /></>)}
      {name === 'db' && (<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" {...p} /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...p} /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" {...p} /></>)}
      {name === 'card' && (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...p} /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...p} /></>)}
      {name === 'bell' && (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...p} strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" {...p} /></>)}
      {name === 'cube' && (<><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" {...p} strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" {...p} strokeLinejoin="round" /></>)}
      {name === 'gear' && (<><circle cx="12" cy="12" r="3" {...p} /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" {...p} strokeLinecap="round" /></>)}
      {name === 'lens' && (<><circle cx="10.5" cy="10.5" r="6.5" {...p} /><path d="M15.5 15.5 L21 21" {...p} strokeLinecap="round" /></>)}
      {name === 'caret' && (<path d="M9 6l6 6-6 6" {...p} strokeLinecap="round" strokeLinejoin="round" />)}
      {name === 'plus' && (<path d="M12 5v14M5 12h14" {...p} strokeLinecap="round" />)}
    </svg>
  )
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" style={{ flexShrink: 0 }}>
      {filled
        ? <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" />
        : <path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
    </svg>
  )
}

function BoardRow({ b }: { b: typeof BOARDS[number] }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={`/app/dashboards/${b.slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none',
        padding: '7px 10px 7px 12px', marginLeft: 16, borderRadius: 9,
        fontSize: 13.5, fontWeight: b.active ? 600 : 450,
        color: b.active ? 'var(--clay-deep)' : hover ? 'var(--ink)' : 'var(--ink-2)',
        background: b.active ? 'var(--clay-tint)' : hover ? 'var(--paper-3)' : 'transparent',
        position: 'relative', transition: 'background .15s, color .15s',
      }}
    >
      <span style={{ display: 'flex', color: b.pinned ? 'var(--clay)' : 'var(--ink-3)', width: 14 }}>
        {b.pinned ? <Star filled /> : (hover ? <Star filled={false} /> : null)}
      </span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
      {b.active && <span style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: 'var(--clay)' }} />}
    </a>
  )
}

export default function ChromeV10({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)

  const navRow = (active: boolean, hover: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none',
    padding: '10px 12px', borderRadius: 11, fontSize: 14, fontWeight: active ? 600 : 450,
    color: active ? 'var(--ink)' : hover ? 'var(--ink)' : 'var(--ink-2)',
    background: active ? 'var(--paper-2)' : hover ? 'var(--paper-3)' : 'transparent',
    boxShadow: active ? 'inset 3px 0 0 var(--clay)' : 'none',
    transition: 'background .15s, color .15s',
  })

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 276, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>
        {/* brand + org */}
        <div style={{ padding: '20px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
            <span style={{ color: 'var(--clay)', display: 'flex' }}><LogoMark size={17} /></span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-.01em' }}>Supalens</span>
          </div>
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--line-2)', background: 'var(--paper)', cursor: 'pointer' }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, flexShrink: 0 }}>AC</span>
            <span style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--ink)' }}>Acme Corp</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', display: 'flex' }}><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </button>
        </div>

        {/* COMMAND CTA */}
        <div style={{ padding: '0 18px 6px' }}>
          <a href="/app/ask" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 14px', borderRadius: 12, textDecoration: 'none', background: 'var(--clay)', color: 'var(--paper-2)', fontSize: 14, fontWeight: 600, boxShadow: 'var(--shadow-clay)' }}>
            <Icon name="plus" size={18} />새 분석
          </a>
        </div>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '12px 14px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.14em', color: 'var(--ink-3)', padding: '4px 12px 8px' }}>WORKSPACE</div>
          {NAV.map((n) => {
            if (n.group) {
              return (
                <div key={n.href}>
                  <button onClick={() => setOpen((o) => !o)} style={{ ...navRow(false, false), width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ display: 'flex', color: 'var(--ink-2)' }}><Icon name="card" /></span>
                    <span>대시보드</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{BOARDS.length}</span>
                    <span style={{ display: 'flex', color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s' }}><Icon name="caret" size={15} /></span>
                  </button>
                  {open && (
                    <div style={{ position: 'relative', margin: '2px 0 4px' }}>
                      <span style={{ position: 'absolute', left: 21, top: 4, bottom: 38, width: 1, background: 'var(--line)' }} />
                      {BOARDS.map((b) => <BoardRow key={b.slug} b={b} />)}
                      <a href="/app/dashboards/new" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, padding: '7px 10px 7px 12px', borderRadius: 9, textDecoration: 'none', fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--clay)'; e.currentTarget.style.background = 'var(--clay-tint)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent' }}>
                        <Icon name="plus" size={14} />새 대시보드
                      </a>
                    </div>
                  )}
                </div>
              )
            }
            const active = n.href === '/app/ask'
            return (
              <a key={n.href} href={n.href}
                style={navRow(false, false)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-3)'; e.currentTarget.style.color = 'var(--ink)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-2)' }}>
                <span style={{ display: 'flex' }}><Icon name={n.icon} /></span>
                {n.label}
              </a>
            )
          })}
        </nav>

        {/* PLAN + USER */}
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--line)' }}>
          <div style={{ background: 'var(--paper-3)', borderRadius: 'var(--r-card)', padding: '13px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.1em', color: 'var(--ink)' }}>STANDARD</span>
              <a href="/app/settings" style={{ fontSize: 12, color: 'var(--clay)', textDecoration: 'none', fontWeight: 600 }}>업그레이드</a>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--line-2)', overflow: 'hidden', marginBottom: 7 }}>
              <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>질문 3,200 / 5,000</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, flexShrink: 0 }}>JP</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 550, color: 'var(--ink)' }}>김하나</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER — command input dominant */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px clamp(16px,2.5vw,28px)', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 16px', borderRadius: 'var(--r-pill)', background: 'var(--paper)', border: '1px solid var(--line-2)', boxShadow: 'var(--shadow-lift)' }}>
            <span style={{ color: 'var(--clay)', display: 'flex', flexShrink: 0 }}><Icon name="lens" size={19} /></span>
            <input
              placeholder="무엇이든 물어보세요 — 예: 지난주 매출 추이"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}
            />
            <button style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', background: 'var(--clay)', color: 'var(--paper-2)', fontSize: 13.5, fontWeight: 600 }}>물어보기</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <a href="/app/dashboards/revenue" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 'var(--r-pill)', textDecoration: 'none', background: 'var(--clay-tint)', border: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--clay)', display: 'flex' }}><Star filled /></span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--clay-deep)' }}>매출 개요</span>
            </a>
            <button aria-label="알림" style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid var(--line-2)', background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="bell" /></button>
            <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 13 }}>JP</span>
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
