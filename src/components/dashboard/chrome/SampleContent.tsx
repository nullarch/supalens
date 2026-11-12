/* Shared sample dashboard body rendered inside every chrome variation preview.
   Pure presentational — warm paper/clay tone, global CSS vars only. No hooks. */

const KPIS = [
  { label: '총 질문 수', value: '3,204', delta: '+12.4%', up: true },
  { label: '연결된 소스', value: '8', delta: '+1', up: true },
  { label: '활성 대시보드', value: '14', delta: '+3', up: true },
  { label: '평균 응답', value: '2.8s', delta: '-0.4s', up: true },
];

const ROWS = [
  { q: '지난주 매출 추이', src: 'production-db', when: '2분 전', n: '1,284' },
  { q: '신규 가입 코호트', src: 'analytics', when: '14분 전', n: '932' },
  { q: '전환 퍼널 이탈 지점', src: 'production-db', when: '1시간 전', n: '610' },
  { q: '리텐션 D7 / D30', src: 'analytics', when: '3시간 전', n: '418' },
];

/* a calm inline area chart so the preview looks like real data */
function MiniArea() {
  return (
    <svg viewBox="0 0 560 180" width="100%" height="180" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="scA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--clay)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--clay)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[36, 78, 120, 162].map((y) => (
        <line key={y} x1="0" y1={y} x2="560" y2={y} stroke="var(--line)" strokeWidth="1" />
      ))}
      <path
        d="M0 140 L70 120 L140 132 L210 96 L280 104 L350 64 L420 78 L490 40 L560 52"
        fill="none"
        stroke="var(--clay)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M0 140 L70 120 L140 132 L210 96 L280 104 L350 64 L420 78 L490 40 L560 52 L560 180 L0 180 Z"
        fill="url(#scA)"
      />
    </svg>
  );
}

export default function SampleContent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1080, margin: '0 auto' }}>
      {/* page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--clay-deep)' }}>
            대시보드 / 매출 개요
          </span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0' }}>
            매출 개요
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink-2)' }}>
            연결된 소스에서 자동 집계된 핵심 지표입니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 13, color: 'var(--ink-2)', background: 'var(--paper-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', padding: '8px 16px', cursor: 'pointer' }}>
            내보내기
          </button>
          <button style={{ fontSize: 13, color: 'var(--paper-2)', background: 'var(--clay)', border: '1px solid var(--clay)', borderRadius: 'var(--r-pill)', padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>
            위젯 추가
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        {KPIS.map((k) => (
          <div key={k.label} style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 16px 18px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clay-deep)', marginTop: 6 }}>{k.delta}</div>
          </div>
        ))}
      </div>

      {/* chart card */}
      <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 16, padding: '18px 20px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>주간 매출 추이</h2>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>최근 9주</span>
        </div>
        <MiniArea />
      </div>

      {/* recent list */}
      <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          최근 분석
        </div>
        {ROWS.map((r, i) => (
          <div key={r.q} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
            <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>{r.q}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', background: 'var(--paper-3)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>{r.src}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', width: 56, textAlign: 'right' }}>{r.n}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', width: 64, textAlign: 'right' }}>{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
