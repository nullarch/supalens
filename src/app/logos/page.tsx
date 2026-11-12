import type { Metadata } from "next";
import s from "./logos.module.css";

/* /logos — internal 4×4 logo exploration board, round 2.
   Abstract, form-first marks (no literal product metaphors) —
   solid geometry, negative space, rotational rhythm — rendered
   on the live brand tokens (ink + clay on paper). Not linked
   from the site; noindex. */

export const metadata: Metadata = {
  title: "supalens — logo explorations",
  robots: { index: false, follow: false },
};

type Proposal = {
  name: string;
  desc: string;
  svg: React.ReactNode;
};

const PROPOSALS: Proposal[] = [
  {
    name: "keyhole",
    desc: "꽉 찬 원에서 원 하나를 덜어낸 네거티브 스페이스. 단단하고 조용함.",
    svg: (
      <path
        fillRule="evenodd"
        d="M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38Zm7 11a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "prism",
    desc: "아이소메트릭 큐브 — 세 면의 톤 차이만으로 입체. 커서 계열의 문법.",
    svg: (
      <>
        <path d="M24 5 40.5 14.5v19L24 43 7.5 33.5v-19Z" fill="currentColor" opacity="0.14" />
        <path d="M24 5 40.5 14.5 24 24 7.5 14.5Z" fill="currentColor" />
        <path d="M24 24l16.5-9.5v19L24 43Z" fill="currentColor" opacity="0.55" />
        <path d="M24 24 7.5 14.5v19L24 43Z" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "crescent",
    desc: "두 원의 차집합이 만드는 초승달. 곡선 하나로 끝나는 미니멀리즘.",
    svg: (
      <path
        fillRule="evenodd"
        d="M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38Zm5.5 6.5a13 13 0 1 0 0 25 19 19 0 0 1 0-25Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "pinwheel",
    desc: "쿼터 서클 4장의 회전 리듬 — 한 장만 클레이. 경쾌한 무게중심.",
    svg: (
      <>
        <path d="M24 24V6a18 18 0 0 1 18 18Z" fill="currentColor" />
        <path d="M24 24h18a18 18 0 0 1-18 18Z" fill="currentColor" opacity="0.45" />
        <path d="M24 24v18A18 18 0 0 1 6 24Z" fill="currentColor" />
        <path d="M24 24H6A18 18 0 0 1 24 6Z" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "arcs",
    desc: "동심 아크 3겹의 하프 서클 — 부채꼴의 리듬감, 여백이 절반.",
    svg: (
      <>
        {[19, 13, 7].map((r, i) => (
          <path
            key={r}
            d={`M${24 - r} 34a${r} ${r} 0 0 1 ${2 * r} 0`}
            fill="none"
            stroke={i === 1 ? "var(--clay)" : "currentColor"}
            strokeWidth="4.6"
            strokeLinecap="round"
          />
        ))}
      </>
    ),
  },
  {
    name: "punch",
    desc: "스쿼클에 오프셋 원공(圓孔) 하나. 비대칭 네거티브 스페이스의 긴장.",
    svg: (
      <path
        fillRule="evenodd"
        d="M15 6h18c5 0 9 4 9 9v18c0 5-4 9-9 9H15c-5 0-9-4-9-9V15c0-5 4-9 9-9Zm14.5 9.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "petal",
    desc: "잎맥 모양 두 장을 점대칭으로 — 부드럽고 유기적인 쌍.",
    svg: (
      <>
        <path d="M22 22C22 12 14 6 6 6c0 8 6 16 16 16Z" fill="currentColor" />
        <path d="M26 26c0 10 8 16 16 16 0-8-6-16-16-16Z" fill="var(--clay)" />
        <circle cx="24" cy="24" r="2.4" fill="currentColor" />
      </>
    ),
  },
  {
    name: "ribbon",
    desc: "겹치는 라운드 스트로크 두 가닥 — 뫼비우스 느낌의 흐름.",
    svg: (
      <>
        <path
          d="M14 33c-6 0-8-6-4.5-10.5S20 15 24 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="5.4"
          strokeLinecap="round"
        />
        <path
          d="M34 15c6 0 8 6 4.5 10.5S28 33 24 28"
          fill="none"
          stroke="var(--clay)"
          strokeWidth="5.4"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    name: "strata",
    desc: "폭이 다른 라운드 바를 쌓아 원의 실루엣을 암시 — 리듬이 형태를 만든다.",
    svg: (
      <>
        {[
          [16, 10, 16],
          [10, 17.5, 28],
          [7, 25, 34],
          [10, 32.5, 28],
          [16, 40, 16],
        ].map(([x, y, w], i) => (
          <rect
            key={y}
            x={x}
            y={(y as number) - 2.8}
            width={w}
            height="5.6"
            rx="2.8"
            fill={i === 2 ? "var(--clay)" : "currentColor"}
          />
        ))}
      </>
    ),
  },
  {
    name: "slash",
    desc: "원을 비스듬히 가른 갭 — 단호한 한 획, 로고보다 사인(sign)에 가까움.",
    svg: (
      <path
        fillRule="evenodd"
        d="M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38Zm11.6 4.5L9.5 35.6a19 19 0 0 0 3 3.4L38.6 12.9a19 19 0 0 0-3-3.4Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "horizon",
    desc: "하프 디스크 위에 뜬 점 하나 — 새벽 같은 정적. 여백이 주인공.",
    svg: (
      <>
        <circle cx="24" cy="13" r="5" fill="var(--clay)" />
        <path d="M5 41a19 19 0 0 1 38 0Z" fill="currentColor" />
      </>
    ),
  },
  {
    name: "triquetra",
    desc: "라운드 트라이앵글 3장을 120°씩 — 회전 대칭의 안정감.",
    svg: (
      <>
        {[0, 120, 240].map((a, i) => (
          <path
            key={a}
            d="M24 8c4 0 7 3.4 7 8s-3.5 9-7 9-7-4.4-7-9 3-8 7-8Z"
            fill={i === 0 ? "var(--clay)" : "currentColor"}
            opacity={i === 0 ? 1 : 0.9 - i * 0.25}
            transform={`rotate(${a} 24 26)`}
          />
        ))}
      </>
    ),
  },
  {
    name: "overlap",
    desc: "회전된 라운드 스퀘어 두 장의 겹침 — 교집합이 가장 진한 톤.",
    svg: (
      <>
        <rect x="9" y="9" width="24" height="24" rx="7" fill="currentColor" opacity="0.35" />
        <rect x="15" y="15" width="24" height="24" rx="7" fill="var(--clay)" opacity="0.85" />
      </>
    ),
  },
  {
    name: "quantum",
    desc: "크기가 다른 세 원의 비대칭 배치 — 점·중간·큰 원의 삼박자.",
    svg: (
      <>
        <circle cx="18" cy="28" r="13" fill="currentColor" />
        <circle cx="35" cy="15" r="7.5" fill="var(--clay)" />
        <circle cx="38" cy="34" r="3.6" fill="currentColor" opacity="0.5" />
      </>
    ),
  },
  {
    name: "eclipse",
    desc: "잉크→클레이 그라디언트 단일 원 — 형태는 최소, 색이 서사.",
    svg: (
      <>
        <defs>
          <linearGradient id="lg-eclipse" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--clay)" />
            <stop offset="100%" stopColor="currentColor" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="19" fill="url(#lg-eclipse)" />
      </>
    ),
  },
  {
    name: "fold",
    desc: "모서리가 접힌 라운드 스퀘어 — '따뜻한 종이' 브랜드 결에 닿는 유일한 은유.",
    svg: (
      <>
        <path
          d="M14 6h13l15 15v13c0 4.4-3.6 8-8 8H14c-4.4 0-8-3.6-8-8V14c0-4.4 3.6-8 8-8Z"
          fill="currentColor"
        />
        <path d="M27 6l15 15H33a6 6 0 0 1-6-6V6Z" fill="var(--clay)" />
      </>
    ),
  },
];

/* R3 — 16 more variations riffing on the strongest R2 directions:
   negative space, rotational rhythm, circle composition. */
const VARIATIONS: Proposal[] = [
  {
    name: "bite",
    desc: "keyhole 변주 — 원공을 가장자리로 밀어 한 입 베어문 실루엣.",
    svg: (
      <path
        fillRule="evenodd"
        d="M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38Zm12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
        fill="currentColor"
      />
    ),
  },
  {
    name: "double crescent",
    desc: "crescent 변주 — 초승달 두 겹, 안쪽만 클레이.",
    svg: (
      <>
        <path
          fillRule="evenodd"
          d="M24 5a19 19 0 1 1 0 38 19 19 0 0 1 0-38Zm6.5 5a14.5 14.5 0 1 0 0 28 19 19 0 0 1 0-28Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          d="M27 12a12 12 0 1 1 0 24 12 12 0 0 1 0-24Zm4 3.4a8.6 8.6 0 1 0 0 17.2 12 12 0 0 1 0-17.2Z"
          fill="var(--clay)"
        />
      </>
    ),
  },
  {
    name: "hemisphere",
    desc: "원을 수직으로 이등분 — 반은 솔리드, 반은 아웃라인.",
    svg: (
      <>
        <path d="M24 5a19 19 0 0 1 0 38Z" fill="currentColor" />
        <path d="M24 5a19 19 0 0 0 0 38" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <circle cx="16" cy="24" r="3" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "quatrefoil",
    desc: "안쪽을 향한 쿼터서클 4장 — 중앙에 별 모양 네거티브 스페이스.",
    svg: (
      <>
        <path d="M6 6h18A18 18 0 0 1 6 24Z" fill="currentColor" />
        <path d="M42 6v18A18 18 0 0 1 24 6Z" fill="currentColor" opacity="0.55" />
        <path d="M42 42H24a18 18 0 0 1 18-18Z" fill="var(--clay)" />
        <path d="M6 42V24a18 18 0 0 1 18 18Z" fill="currentColor" opacity="0.8" />
      </>
    ),
  },
  {
    name: "phases",
    desc: "달의 위상처럼 겹쳐 내려오는 세 원 — 톤이 점점 짙어짐.",
    svg: (
      <>
        <circle cx="24" cy="14" r="9" fill="currentColor" opacity="0.25" />
        <circle cx="24" cy="22" r="9" fill="currentColor" opacity="0.55" />
        <circle cx="24" cy="30" r="9" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "open ring",
    desc: "eclipse 변주 — 그라디언트 링에 갭 하나. 열린 원.",
    svg: (
      <>
        <defs>
          <linearGradient id="lg-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--clay)" />
            <stop offset="100%" stopColor="currentColor" />
          </linearGradient>
        </defs>
        <path
          d="M33.5 8.5A18 18 0 1 0 42 24"
          fill="none"
          stroke="url(#lg-ring)"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    name: "diagonal",
    desc: "squircle을 대각으로 가른 두 톤 — punch의 절단 변주.",
    svg: (
      <>
        <path d="M15 6h18c5 0 9 4 9 9v18L15 6Z" fill="var(--clay)" />
        <path d="M42 33v-1L16 6h-1c-5 0-9 4-9 9v18c0 5 4 9 9 9h18c5 0 9-4 9-9Z" fill="currentColor" />
      </>
    ),
  },
  {
    name: "comet",
    desc: "호를 따라 잦아드는 점들 — 궤적의 리듬.",
    svg: (
      <>
        {[
          [38, 14, 6.5, 1],
          [28, 9.5, 4.6, 0.75],
          [18.5, 10.5, 3.4, 0.55],
          [11.5, 15.5, 2.5, 0.4],
          [7.8, 23, 1.9, 0.28],
        ].map(([x, y, r, o], i) => (
          <circle key={x} cx={x} cy={y} r={r} fill={i === 0 ? "var(--clay)" : "currentColor"} opacity={o} />
        ))}
        <path d="M8 30a17 17 0 0 0 32 3" fill="none" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    name: "planet",
    desc: "솔리드 원을 비껴 두른 기울어진 링 — 고전적이지만 강함.",
    svg: (
      <>
        <circle cx="24" cy="24" r="12.5" fill="currentColor" />
        <ellipse
          cx="24"
          cy="24"
          rx="20"
          ry="7"
          fill="none"
          stroke="var(--clay)"
          strokeWidth="2.8"
          transform="rotate(-22 24 24)"
        />
      </>
    ),
  },
  {
    name: "steps",
    desc: "쿼터서클 계단 3단 — 상승의 기하학, 데이터 없이도 성장.",
    svg: (
      <>
        <path d="M6 42V8a34 34 0 0 1 34 34Z" fill="currentColor" opacity="0.22" />
        <path d="M6 42V19a23 23 0 0 1 23 23Z" fill="currentColor" opacity="0.55" />
        <path d="M6 42V29a13 13 0 0 1 13 13Z" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "bloom",
    desc: "빈 중심을 둘러싼 라운드 레이 8개 — 방사형 리듬.",
    svg: (
      <>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
          <rect
            key={a}
            x="21.4"
            y="6"
            width="5.2"
            height="12.5"
            rx="2.6"
            fill={i === 1 ? "var(--clay)" : "currentColor"}
            opacity={i === 1 ? 1 : 0.9}
            transform={`rotate(${a} 24 24)`}
          />
        ))}
      </>
    ),
  },
  {
    name: "flow",
    desc: "S커브로 이등분한 원 — 음양의 현대적 두 톤.",
    svg: (
      <>
        <circle cx="24" cy="24" r="19" fill="currentColor" opacity="0.18" />
        <path d="M24 5a19 19 0 0 1 0 38 9.5 9.5 0 0 1 0-19 9.5 9.5 0 0 0 0-19Z" fill="currentColor" />
        <circle cx="24" cy="14.5" r="3" fill="var(--paper, #fff)" />
        <circle cx="24" cy="33.5" r="3" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "shard",
    desc: "원 위에 얹힌 라운드 트라이앵글 — 이질적 형태의 긴장.",
    svg: (
      <>
        <circle cx="20" cy="27" r="14.5" fill="currentColor" />
        <path
          d="M31 8.5c1.6-2.8 5.6-2.8 7.2 0l4.7 8.2c1.6 2.8-.4 6.3-3.6 6.3h-9.4c-3.2 0-5.2-3.5-3.6-6.3Z"
          fill="var(--clay)"
        />
      </>
    ),
  },
  {
    name: "plus",
    desc: "교차하는 캡슐 두 개 — 45° 회전한 플러스, 만나는 지점이 중심.",
    svg: (
      <g transform="rotate(45 24 24)">
        <rect x="18.5" y="6" width="11" height="36" rx="5.5" fill="currentColor" />
        <rect x="6" y="18.5" width="36" height="11" rx="5.5" fill="var(--clay)" opacity="0.9" />
      </g>
    ),
  },
  {
    name: "ripple",
    desc: "중심을 비껴 놓은 동심원 — 정적인 원에 방향성이 생김.",
    svg: (
      <>
        <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="2.6" opacity="0.35" />
        <circle cx="21" cy="21" r="13" fill="none" stroke="currentColor" strokeWidth="2.6" opacity="0.65" />
        <circle cx="18.5" cy="18.5" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
        <circle cx="16.5" cy="16.5" r="3" fill="var(--clay)" />
      </>
    ),
  },
  {
    name: "mono s",
    desc: "굵은 기하 S 한 글자 — 스퀘어에서 깎아낸 조각적 모노그램.",
    svg: (
      <path
        d="M35 8H19a9 9 0 0 0 0 18h10a4.5 4.5 0 0 1 0 9H13a4 4 0 0 0 0 5h16a9 9 0 0 0 0-18H19a4.5 4.5 0 0 1 0-9h16a4 4 0 0 0 0-5Z"
        fill="currentColor"
      />
    ),
  },
];

export default function LogosPage() {
  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>supalens — 로고 시안 보드 · R2</h1>
        <p className={s.sub}>
          추상·조형 우선 16안 — 솔리드 지오메트리 · 네거티브 스페이스 · 회전
          리듬. 잉크 + 클레이, 실제 브랜드 토큰 위 렌더링.
        </p>
      </header>
      <section className={s.grid}>
        {PROPOSALS.map((p) => (
          <article key={p.name} className={s.card}>
            <div className={s.stage}>
              <svg className={s.mark} viewBox="0 0 48 48" aria-hidden="true">
                {p.svg}
              </svg>
              <span className={s.word}>supalens</span>
            </div>
            <div className={s.meta}>
              <span className={s.name}>{p.name}</span>
              <span className={s.desc}>{p.desc}</span>
            </div>
          </article>
        ))}
      </section>

      <header className={s.head} style={{ marginTop: "clamp(40px, 6vw, 72px)" }}>
        <h1 className={s.title}>R3 — 베리에이션 16</h1>
        <p className={s.sub}>
          R2의 강한 방향(네거티브 스페이스 · 회전 리듬 · 원 구성)을 변주한 추가
          16안.
        </p>
      </header>
      <section className={s.grid}>
        {VARIATIONS.map((p) => (
          <article key={p.name} className={s.card}>
            <div className={s.stage}>
              <svg className={s.mark} viewBox="0 0 48 48" aria-hidden="true">
                {p.svg}
              </svg>
              <span className={s.word}>supalens</span>
            </div>
            <div className={s.meta}>
              <span className={s.name}>{p.name}</span>
              <span className={s.desc}>{p.desc}</span>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
