'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

const navTop = [
  { label: '분석', href: '/app/ask', icon: (
    <><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7"/><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>
  ) },
  { label: '데이터소스', href: '/app/sources', icon: (
    <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7"/><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7"/></>
  ) },
]

const navBottom = [
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

const pinned = [
  { name: '매출 개요', slug: 'revenue', active: true },
  { name: '트래픽 분석', slug: 'traffic', active: false },
]
const others = [
  { name: '전환 퍼널', slug: 'funnel' },
  { name: '리텐션 코호트', slug: 'retention' },
  { name: '광고 성과', slug: 'ads' },
]

const StarFilled = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor"/></svg>
)
const StarOutline = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
)

function NavRow({ label, href, icon }: { label: string; href: string; icon: ReactNode }) {
  const [h, setH] = useState(false)
  return (
    <a href={href} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10, textDecoration: 'none',
        color: h ? 'var(--ink)' : 'var(--ink-2)', background: h ? 'var(--paper-3)' : 'transparent', transition: 'all .16s', fontSize: 14 }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" style={{ flexShrink: 0, opacity: .85 }}>{icon}</svg>
      <span>{label}</span>
    </a>
  )
}

function DashRow({ name, slug, active, isPinned }: { name: string; slug: string; active?: boolean; isPinned: boolean }) {
  const [h, setH] = useState(false)
  const [pin, setPin] = useState(isPinned)
  return (
    <a href={`/app/dashboards/${slug}`} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px', borderRadius: 9, textDecoration: 'none',
        color: active ? 'var(--clay-deep)' : h ? 'var(--ink)' : 'var(--ink-2)',
        background: active ? 'var(--clay-tint)' : h ? 'var(--paper-3)' : 'transparent',
        boxShadow: active ? 'inset 2px 0 0 var(--clay)' : 'none', transition: 'all .16s', fontSize: 13.5, position: 'relative' }}>
      <span onClick={(e) => { e.preventDefault(); setPin(!pin) }}
        style={{ display: 'flex', color: pin ? 'var(--clay)' : 'var(--ink-3)', opacity: pin || h ? 1 : 0, transition: 'opacity .16s', cursor: 'pointer' }}>
        {pin ? <StarFilled /> : <StarOutline />}
      </span>
      <span style={{ fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </a>
  )
}

function SubLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink-3)',
      textTransform: 'uppercase', padding: '8px 12px 4px 34px' }}>{children}</div>
  )
}

export default function ChromeV5({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 256, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>
        {/* brand */}
        <div style={{ padding: '20px 18px 16px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: 'var(--clay)', display: 'flex' }}>
            <LogoMark size={17} />
          </span>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
        </div>

        {/* org switcher */}
        <div style={{ margin: '0 14px 12px', padding: '9px 11px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>AC</span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Acme Corp</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ color: 'var(--ink-3)' }}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>

        {/* nav */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '4px 12px 12px' }}>
          {navTop.map((n) => <NavRow key={n.href} {...n} />)}

          {/* dashboards group */}
          <div style={{ marginTop: 2 }}>
            <button onClick={() => setOpen(!open)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 10, border: 'none',
                background: 'transparent', color: 'var(--ink)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', textAlign: 'left' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" style={{ flexShrink: 0, opacity: .85 }}>
                <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7"/>
              </svg>
              <span style={{ flex: 1, fontWeight: 500 }}>대시보드</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>5</span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" style={{ color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {open && (
              <div style={{ position: 'relative', marginLeft: 21, paddingLeft: 9, borderLeft: '1px solid var(--line-2)', marginTop: 2 }}>
                <SubLabel>즐겨찾기</SubLabel>
                {pinned.map((d) => <DashRow key={d.slug} {...d} isPinned />)}
                <SubLabel>전체</SubLabel>
                {others.map((d) => <DashRow key={d.slug} {...d} isPinned={false} />)}
                <a href="/app/dashboards/new"
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--clay)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)' }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', marginTop: 4, borderRadius: 9, textDecoration: 'none', color: 'var(--ink-3)', fontSize: 13, transition: 'color .16s' }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                  <span>새 대시보드</span>
                </a>
              </div>
            )}
          </div>

          {navBottom.map((n) => <NavRow key={n.href} {...n} />)}
        </nav>

        {/* plan card */}
        <div style={{ margin: 14, padding: '13px 14px', borderRadius: 14, background: 'var(--panel)', color: 'var(--on-panel)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em', color: 'var(--on-panel-2)' }}>STANDARD</span>
            <a href="/app/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 7 }}>
            <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--on-panel-2)' }}>질문 3,200 / 5,000</span>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER */}
        <header style={{ flexShrink: 0, height: 62, display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(20px,3vw,32px)', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>대시보드</span>
            <span style={{ color: 'var(--line-2)' }}>/</span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>매출 개요</span>
            <span style={{ display: 'flex', color: 'var(--clay)', marginLeft: 2 }}><StarFilled /></span>
          </div>

          <div style={{ flex: 1 }} />

          {/* search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-3)', minWidth: 160 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            <span style={{ fontSize: 13 }}>검색</span>
          </div>

          {/* bell */}
          <button style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7"/></svg>
            <span style={{ position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', border: '1.5px solid var(--paper-2)' }} />
          </button>

          {/* avatar */}
          <span title="김하나 · admin@example.com" style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12.5, boxShadow: 'var(--shadow-clay)' }}>JP</span>
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
