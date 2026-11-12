import { notFound } from 'next/navigation'
import Link from 'next/link'

// Dev-only index for the public-demo design variations (2026-07-18 exploration).
// Each variant is a self-contained re-design of /ko/demo — see the sibling dirs.
// notFound() in production, same as the widgets gallery.
const VARIANTS = [
  { href: '/dev/demo/v1', name: 'V1 · Terminal / SQL-forward', desc: 'psql 스키마 블록 + 콘솔 프롬프트 컴포저 + agent 트레이스 → 개발자 신뢰 지향 (HN)' },
  { href: '/dev/demo/v2', name: 'V2 · Split product hero', desc: '좌 질문/우 라이브 KPI 대시보드 패널 — 페이오프가 첫 화면에 보이는 전환 최적화형' },
  { href: '/dev/demo/v3', name: 'V3 · Editorial minimal', desc: '세리프 대형 타이포 + 괘선 컴포저 + 잡지 Q./A. — 질문이 주인공인 미니멀' },
]

export default function DemoVariantsIndex() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '60px 24px', color: 'var(--ink)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>/demo design variants</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 28 }}>
        현재 라이브 베이스라인: <Link href="/ko/demo" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>/ko/demo</Link>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {VARIANTS.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            style={{
              display: 'block',
              padding: '16px 18px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--paper-2)',
              textDecoration: 'none',
              color: 'var(--ink)',
            }}
          >
            <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 4 }}>{v.name}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{v.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  )
}
