'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

const LensMark = () => <LogoMark size={17} />

const icons: Record<string, ReactNode> = {
  ask: (<><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
  db: (<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7" /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /></>),
  card: (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" /></>),
  bell: (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></>),
  cube: (<><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></>),
  gear: (<><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
}

const Ico = ({ k, size = 18 }: { k: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none">{icons[k]}</svg>
)

const StarFilled = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" /></svg>
)
const StarOutline = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
)

const nav = [
  { label: '분석', href: '/app/ask', k: 'ask' },
  { label: '데이터소스', href: '/app/sources', k: 'db' },
]
const navTail = [
  { label: '알림', href: '/app/alerts', k: 'bell' },
  { label: 'MCP', href: '/app/mcp', k: 'cube' },
  { label: '설정', href: '/app/settings', k: 'gear' },
]
const dashboards = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]
const ordered = [...dashboards].sort((a, b) => Number(b.pinned) - Number(a.pinned))

function NavRow({ label, href, k }: { label: string; href: string; k: string }) {
  const [h, setH] = useState(false)
  return (
    <a href={href} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, textDecoration: 'none',
        color: h ? 'var(--ink)' : 'var(--ink-2)', background: h ? 'var(--paper-3)' : 'transparent', transition: 'all .18s ease' }}>
      <span style={{ color: h ? 'var(--clay)' : 'var(--ink-3)', display: 'flex', transition: 'color .18s ease' }}><Ico k={k} /></span>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
    </a>
  )
}

function DashRow({ d }: { d: typeof dashboards[number] }) {
  const [h, setH] = useState(false)
  const [pin, setPin] = useState(d.pinned)
  return (
    <a href={`/app/dashboards/${d.slug}`} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 10, textDecoration: 'none',
        background: d.active ? 'var(--clay-tint)' : h ? 'rgba(255,255,255,0.55)' : 'transparent',
        boxShadow: d.active ? 'inset 0 0 0 1px var(--line-2)' : 'none', transition: 'all .16s ease' }}>
      <button onClick={(e) => { e.preventDefault(); setPin(!pin) }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
          color: pin ? 'var(--clay)' : 'var(--ink-3)', opacity: pin ? 1 : h ? 1 : 0, transition: 'opacity .16s ease' }}>
        {pin ? <StarFilled /> : <StarOutline />}
      </button>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: d.active ? 600 : 500, color: d.active ? 'var(--clay-deep)' : h ? 'var(--ink)' : 'var(--ink-2)' }}>{d.name}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', opacity: h || d.active ? 0.8 : 0 }}>{d.slug}</span>
    </a>
  )
}

export default function ChromeV4({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const [newH, setNewH] = useState(false)

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)', color: 'var(--ink)', padding: 14, gap: 14, boxSizing: 'border-box' }}>
      {/* FLOATING SIDEBAR CARD */}
      <aside style={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-lift)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        {/* brand + org */}
        <div style={{ padding: '20px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
            <span style={{ color: 'var(--clay)', display: 'flex' }}><LensMark /></span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
          </div>
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 9px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 9, background: 'var(--panel)', color: 'var(--on-panel)', fontFamily: 'var(--font-mono)', fontSize: 11, flexShrink: 0 }}>AC</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Acme Corp</span>
            <span style={{ color: 'var(--ink-3)', display: 'flex' }}><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </button>
        </div>

        {/* NAV */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavRow {...nav[0]} />
          <NavRow {...nav[1]} />

          {/* DASHBOARD GROUP */}
          <button onClick={() => setOpen(!open)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', cursor: 'pointer', width: '100%', color: 'var(--ink)' }}>
            <span style={{ color: 'var(--clay)', display: 'flex' }}><Ico k="card" /></span>
            <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: 600 }}>대시보드</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', background: 'var(--paper-3)', borderRadius: 999, padding: '2px 7px' }}>5</span>
            <span style={{ display: 'flex', color: 'var(--ink-2)', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s ease' }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </button>

          {/* INSET WELL */}
          {open && (
            <div style={{ margin: '4px 4px 6px', padding: '8px 8px 8px', background: 'var(--paper-3)', borderRadius: 13, boxShadow: 'inset 0 1px 3px rgba(33,30,26,0.05)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {ordered.map((d) => <DashRow key={d.slug} d={d} />)}
              <a href="/app/dashboards/new" onMouseEnter={() => setNewH(true)} onMouseLeave={() => setNewH(false)}
                style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, textDecoration: 'none',
                  borderTop: '1px dashed var(--line-2)', color: newH ? 'var(--clay)' : 'var(--ink-3)', transition: 'color .16s ease' }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                <span style={{ fontSize: 13, fontWeight: 500 }}>새 대시보드</span>
              </a>
            </div>
          )}

          {navTail.map((n) => <NavRow key={n.href} {...n} />)}
        </nav>

        {/* PLAN CARD */}
        <div style={{ margin: 12, padding: 14, background: 'var(--panel)', borderRadius: 14, color: 'var(--on-panel)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--on-panel-2)' }}>STANDARD</span>
            <a href="/app/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 7 }}>
            <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--on-panel-2)' }}>질문 3,200 / 5,000</span>
        </div>

        {/* USER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 16px', borderTop: '1px solid var(--line)' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>JP</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>김하나</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>admin@example.com</div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* FLOATING HEADER PILL */}
        <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: 'var(--paper-2)', borderRadius: 'var(--r-pill)', boxShadow: 'var(--shadow-lift)', border: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>대시보드 /</span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>매출 개요</h1>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--clay)', background: 'var(--clay-tint)', borderRadius: 999, padding: '3px 9px' }}><StarFilled />즐겨찾기</span>
          <div style={{ flex: 1 }} />
          <button style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <span style={{ fontSize: 12.5 }}>검색</span>
          </button>
          <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-2)', cursor: 'pointer', position: 'relative' }}>
            <Ico k="bell" size={17} />
            <span style={{ position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 999, background: 'var(--clay)', border: '1.5px solid var(--paper-2)' }} />
          </button>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 999, background: 'var(--clay)', color: 'var(--paper-2)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>JP</span>
        </header>

        {/* CONTENT */}
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--paper)', borderRadius: 'var(--r-card)', padding: 'clamp(20px,3vw,32px)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
