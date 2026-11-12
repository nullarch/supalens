'use client'

import { useState } from 'react'
import SampleContent from '@/components/dashboard/chrome/SampleContent'
import ChromeV1 from '@/components/dashboard/chrome/ChromeV1'
import ChromeV2 from '@/components/dashboard/chrome/ChromeV2'
import ChromeV3 from '@/components/dashboard/chrome/ChromeV3'
import ChromeV4 from '@/components/dashboard/chrome/ChromeV4'
import ChromeV5 from '@/components/dashboard/chrome/ChromeV5'
import ChromeV6 from '@/components/dashboard/chrome/ChromeV6'
import ChromeV7 from '@/components/dashboard/chrome/ChromeV7'
import ChromeV8 from '@/components/dashboard/chrome/ChromeV8'
import ChromeV9 from '@/components/dashboard/chrome/ChromeV9'
import ChromeV10 from '@/components/dashboard/chrome/ChromeV10'

type Variant = {
  n: number
  label: string
  ko: string
  concept: string
  Comp: ({ children }: { children: React.ReactNode }) => React.ReactNode
}

const VARIANTS: Variant[] = [
  { n: 1, label: 'Editorial Rail', ko: '에디토리얼 레일', concept: '크림 레일 + 펼쳐진 대시보드 트리(핀 고정 우선) + 새 대시보드, 헤어라인 헤더에 "대시보드 / 매출 개요" 브레드크럼·검색. 현재 톤의 정제 기준점.', Comp: ChromeV1 },
  { n: 2, label: 'Ink Panel', ko: '잉크 패널', concept: '다크 레일 + 솔리드 클레이 활성 대시보드 행, 밝은 paper 헤더의 고대비 프리미엄. 대시보드 목록이 다크 레일에 녹아듦.', Comp: ChromeV2 },
  { n: 3, label: 'Guide-Line Tree', ko: '가이드라인 트리', concept: '대시보드를 펼치면 세로 연결선에 행이 매달리는 Linear/파일트리 스타일, 캐럿 90° 회전. 미니멀 헤더.', Comp: ChromeV3 },
  { n: 4, label: 'Floating Card Rail', ko: '플로팅 카드 레일', concept: '떠 있는 카드형 사이드바 + 대시보드 목록은 인셋 웰(sand)에, 떠 있는 pill 헤더. 부드러운 그림자.', Comp: ChromeV4 },
  { n: 5, label: 'Pinned-First', ko: '즐겨찾기 우선', concept: '대시보드 그룹 아래 "즐겨찾기"·"전체" 두 서브섹션으로 분리, 핀=채운 별. 브레드크럼 헤더.', Comp: ChromeV5 },
  { n: 6, label: 'Grouped Sections', ko: '그룹 섹션', concept: 'mono 그룹 헤더 + 대시보드 카운트 배지 "5"·인라인 + 버튼, 항상 펼침. 세그먼트 컨트롤 헤더.', Comp: ChromeV6 },
  { n: 7, label: 'Bordered Grid', ko: '보더드 그리드', concept: '보더 박스 트리 + 모노 슬러그(REV/TRF/FNL…), 활성=클레이 솔리드, + 새 대시보드=점선 행. 박스형 헤더.', Comp: ChromeV7 },
  { n: 8, label: 'Quiet Minimal', ko: '콰이엇 미니멀', concept: '채움 없이 클레이 좌측 틱+별표만으로 활성/핀 표시. 보더리스 언더라인 헤더. 극도 절제.', Comp: ChromeV8 },
  { n: 9, label: 'Switcher + List', ko: '스위처 + 목록', concept: '상단에 현재 대시보드 스위처 칩 + 그 아래 펼쳐진 전체 목록을 동시에 제공. 보드명 헤더.', Comp: ChromeV9 },
  { n: 10, label: 'Command Rail', ko: '커맨드 레일', concept: '"+ 새 분석" 클레이 CTA + 펼쳐진 대시보드 목록, 헤더에 큰 "물어보기" 명령 입력창.', Comp: ChromeV10 },
]

const mono = 'var(--font-mono)'

export default function ChromeGalleryPage() {
  const [sel, setSel] = useState(0)
  const v = VARIANTS[sel]
  const Active = v.Comp
  const go = (d: number) => setSel((i) => (i + d + VARIANTS.length) % VARIANTS.length)

  return (
    <div style={{ maxWidth: 1340, margin: '0 auto', padding: '34px 26px 80px' }}>
      {/* page header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          paddingBottom: 18,
          borderBottom: '1px solid var(--line)',
          marginBottom: 22,
        }}
      >
        <div>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--clay-deep)' }}>
            Dev · Dashboard Chrome
          </span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 'clamp(24px,3.4vw,33px)', letterSpacing: '-0.02em', color: 'var(--ink)', margin: '8px 0 0' }}>
            사이드바 · 헤더 베리에이션
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-2)', maxWidth: '64ch' }}>
유저가 대시보드를 여러 개 만들고 전환하는 구조에 맞춰, <code style={{ fontFamily: mono, color: 'var(--clay-deep)' }}>대시보드</code>를 펼치면 내 대시보드 목록(핀 고정 우선) + 새 대시보드가 나오는 10가지 셸 변형. 버튼을 눌러 하나씩 바로 미리보세요. 마음에 드는 번호를 알려주시면 실제 <code style={{ fontFamily: mono, color: 'var(--clay-deep)' }}>Sidebar</code>/<code style={{ fontFamily: mono, color: 'var(--clay-deep)' }}>Topbar</code>로 승격합니다.
          </p>
        </div>
        <span style={{ fontFamily: mono, fontSize: 13, color: 'var(--ink-3)' }}>{VARIANTS.length} variations</span>
      </header>

      {/* button switcher */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {VARIANTS.map((item, i) => {
          const on = i === sel
          return (
            <button
              key={item.n}
              type="button"
              onClick={() => setSel(i)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 'var(--r-pill)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: on ? 'var(--paper-2)' : 'var(--ink-2)',
                background: on ? 'var(--clay)' : 'var(--paper-2)',
                border: `1px solid ${on ? 'var(--clay)' : 'var(--line-2)'}`,
                boxShadow: on ? 'var(--shadow-clay)' : 'none',
                transition: 'background .16s, color .16s, border-color .16s',
              }}
            >
              <span style={{ fontFamily: mono, fontSize: 11, opacity: on ? 0.85 : 0.6 }}>
                V{String(item.n).padStart(2, '0')}
              </span>
              {item.ko}
            </button>
          )
        })}
      </div>

      {/* selected meta + prev/next */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <NavBtn dir="‹" onClick={() => go(-1)} />
          <NavBtn dir="›" onClick={() => go(1)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: 'var(--clay-deep)' }}>V{String(v.n).padStart(2, '0')}</span>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
              {v.ko} <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>· {v.label}</span>
            </h2>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{v.concept}</p>
        </div>
      </div>

      {/* preview frame — faux browser chrome + the live variation */}
      <div
        id="preview-frame"
        style={{
          height: 'clamp(620px, 80vh, 880px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          overflow: 'hidden',
          border: '1px solid var(--line-2)',
          boxShadow: 'var(--shadow-lift)',
          background: 'var(--paper)',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            background: 'var(--paper-3)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span style={{ display: 'flex', gap: 6 }}>
            {['#e0857a', '#e3c07a', '#9fbf8e'].map((c) => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
            ))}
          </span>
          <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '2px 12px' }}>
            supalens.ai/app/dashboards
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <Active>
            <SampleContent />
          </Active>
        </div>
      </div>
    </div>
  )
}

function NavBtn({ dir, onClick }: { dir: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === '‹' ? '이전' : '다음'}
      style={{
        width: 34,
        height: 34,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        border: '1px solid var(--line-2)',
        background: 'var(--paper-2)',
        color: 'var(--ink-2)',
        cursor: 'pointer',
        fontSize: 18,
        lineHeight: 1,
      }}
    >
      {dir}
    </button>
  )
}
