'use client'

import { useState, type ReactNode } from 'react'
import LogoMark from '@/components/brand/LogoMark'

type Dash = { name: string; slug: string; pinned: boolean; active: boolean }
const DASHBOARDS: Dash[] = [
  { name: '매출 개요', slug: 'revenue', pinned: true, active: true },
  { name: '트래픽 분석', slug: 'traffic', pinned: true, active: false },
  { name: '전환 퍼널', slug: 'funnel', pinned: false, active: false },
  { name: '리텐션 코호트', slug: 'retention', pinned: false, active: false },
  { name: '광고 성과', slug: 'ads', pinned: false, active: false },
]

const Mark = () => <LogoMark size={17} />

const icons: Record<string, ReactNode> = {
  ask: (<><path d="M3.5 5h11M3.5 9h7.5M3.5 13h4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="16.5" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M19 16.5 21.5 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
  db: (<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" stroke="currentColor" strokeWidth="1.7" /><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" stroke="currentColor" strokeWidth="1.7" /></>),
  bell: (<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></>),
  mcp: (<><path d="M12 2.5l8 4.5v9L12 20.5 4 16V7l8-4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M4 7l8 4.5L20 7M12 11.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></>),
  gear: (<><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>),
}
const Icon = ({ k }: { k: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">{icons[k]}</svg>
)
const StarFilled = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" fill="currentColor" /></svg>)
const StarOutline = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 17.1l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85L12 3.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>)

const eyebrow = { fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase' as const, color: 'var(--ink-3)' }

function NavRow({ k, label, href, active }: { k: string; label: string; href: string; active?: boolean }) {
  const [h, setH] = useState(false)
  const on = active || h
  return (
    <a href={href} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', borderRadius: 10, textDecoration: 'none',
        color: active ? 'var(--clay-deep)' : on ? 'var(--ink)' : 'var(--ink-2)',
        background: active ? 'var(--clay-tint)' : h ? 'var(--paper-3)' : 'transparent', transition: 'all .16s ease', fontSize: 13.5, fontWeight: active ? 600 : 500 }}>
      <span style={{ display: 'flex', color: active ? 'var(--clay)' : 'var(--ink-3)' }}><Icon k={k} /></span>
      {label}
    </a>
  )
}

function DashRow({ d }: { d: Dash }) {
  const [h, setH] = useState(false)
  const [pin, setPin] = useState(d.pinned)
  return (
    <a href={`/app/dashboards/${d.slug}`} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px 7px 14px', borderRadius: 999, textDecoration: 'none',
        background: d.active ? 'var(--clay-tint)' : h ? 'var(--paper-3)' : 'transparent', transition: 'all .16s ease',
        color: d.active ? 'var(--clay-deep)' : 'var(--ink-2)', fontSize: 13, fontWeight: d.active ? 600 : 500 }}>
      <button onClick={(e) => { e.preventDefault(); setPin(p => !p) }}
        style={{ display: 'flex', alignItems: 'center', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
          color: pin ? 'var(--clay)' : 'var(--ink-3)', opacity: pin || h ? 1 : 0, transition: 'opacity .16s ease' }}>
        {pin ? <StarFilled /> : <StarOutline />}
      </button>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
      {d.active && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--clay)' }} />}
    </a>
  )
}

function GroupHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 11px', margin: '4px 0 6px' }}>
      <span style={eyebrow}>{children}</span>
      {right}
    </div>
  )
}

export default function ChromeV6({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const [seg, setSeg] = useState('개요')
  const [addH, setAddH] = useState(false)
  const [newH, setNewH] = useState(false)
  const sorted = [...DASHBOARDS].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const segs = ['개요', '위젯', '활동']

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', background: 'var(--paper)', fontFamily: 'var(--font-sans)', color: 'var(--ink)' }}>
      {/* SIDEBAR */}
      <aside style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--paper-2)', borderRight: '1px solid var(--line)' }}>
        {/* brand + org */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <span style={{ color: 'var(--clay)' }}><Mark /></span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Supalens</span>
          </div>
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 10, border: '1px solid var(--line-2)', background: 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>AC</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Acme Corp</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ color: 'var(--ink-3)' }}><path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>

        {/* nav */}
        <nav style={{ flex: 1, overflow: 'auto', padding: '12px 9px' }}>
          <GroupHeader>분석</GroupHeader>
          <NavRow k="ask" label="분석" href="/app/ask" active />
          <NavRow k="mcp" label="MCP" href="/app/mcp" />

          <div style={{ height: 14 }} />
          <GroupHeader>연결</GroupHeader>
          <NavRow k="db" label="데이터소스" href="/app/sources" />

          <div style={{ height: 14 }} />
          {/* DASHBOARD GROUP */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 11px', margin: '4px 0 6px' }}>
            <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', ...eyebrow }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s ease', color: 'var(--ink-3)' }}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              대시보드
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--clay-deep)', background: 'var(--clay-tint)', borderRadius: 999, padding: '1px 6px', letterSpacing: 0 }}>5</span>
            </button>
            <button onMouseEnter={() => setAddH(true)} onMouseLeave={() => setAddH(false)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all .16s ease', background: addH ? 'var(--clay)' : 'var(--paper-3)', color: addH ? 'var(--on-panel)' : 'var(--ink-2)' }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          {open && (
            <div style={{ position: 'relative', marginLeft: 17, paddingLeft: 7, borderLeft: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {sorted.map(d => <DashRow key={d.slug} d={d} />)}
              <a href="/app/dashboards" onMouseEnter={() => setNewH(true)} onMouseLeave={() => setNewH(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px 7px 14px', borderRadius: 999, textDecoration: 'none', marginTop: 2, fontSize: 12.5, fontWeight: 500, transition: 'color .16s ease', color: newH ? 'var(--clay)' : 'var(--ink-3)' }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                새 대시보드
              </a>
            </div>
          )}

          <div style={{ height: 14 }} />
          <GroupHeader>운영</GroupHeader>
          <NavRow k="bell" label="알림" href="/app/alerts" />
          <NavRow k="gear" label="설정" href="/app/settings" />
        </nav>

        {/* plan + user */}
        <div style={{ padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
          <div style={{ background: 'var(--paper-3)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 12px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink)' }}>STANDARD</span>
              <a href="/app/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--clay)', textDecoration: 'none' }}>업그레이드</a>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--line-2)', overflow: 'hidden', marginBottom: 7 }}>
              <div style={{ width: '64%', height: '100%', background: 'var(--clay)', borderRadius: 999 }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>질문 3,200 / 5,000</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--clay)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11 }}>JP</span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>김하나</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>admin@example.com</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* HEADER */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 clamp(20px,3vw,32px)', height: 64, flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>대시보드</span>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.1 }}>매출 개요</span>
          </div>

          {/* segmented control */}
          <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--paper-3)', borderRadius: 999, border: '1px solid var(--line)' }}>
            {segs.map(s => {
              const a = seg === s
              return (
                <button key={s} onClick={() => setSeg(s)}
                  style={{ padding: '6px 15px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.02em', transition: 'all .16s ease',
                    background: a ? 'var(--paper-2)' : 'transparent', color: a ? 'var(--ink)' : 'var(--ink-3)', fontWeight: a ? 600 : 500,
                    boxShadow: a ? 'var(--shadow-lift)' : 'none' }}>{s}</button>
              )
            })}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--paper)', color: 'var(--ink-3)', minWidth: 168 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            <span style={{ fontSize: 12.5 }}>질문 검색</span>
          </div>
          <button style={{ position: 'relative', width: 38, height: 38, borderRadius: 11, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Icon k="bell" />
            <span style={{ position: 'absolute', top: 9, right: 10, width: 6, height: 6, borderRadius: 999, background: 'var(--clay)', border: '1.5px solid var(--paper)' }} />
          </button>
          <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--panel)', color: 'var(--on-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer' }}>JP</span>
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 'clamp(20px,3vw,32px)', background: 'var(--paper)' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
