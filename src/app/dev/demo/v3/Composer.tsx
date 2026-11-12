'use client'

import { useRef, useState } from 'react'

import s from './v3.module.css'

// Dev-only mock composer — V3 "Editorial minimal". The real page (src/app/[locale]/demo)
// wires this to /api/demo/ask; here the interaction is limited to what the design needs:
// clicking a suggested question fills the field so the focal element can be judged with text in it.

const PLACEHOLDER = '직접 질문해 보세요 — 예: 이번 달 가장 빨리 성장한 카테고리는?'
const SCHEMA_TABLES = ['customers', 'products', 'orders', 'order_items']
const QUESTIONS = [
  '최근 30일 총 매출은 얼마야?',
  '최근 14일 일별 매출을 차트로 보여줘',
  '어떤 상품 카테고리가 매출이 가장 높아?',
  '누적 구매액 기준 상위 고객 5명은?',
  '월별 환불률은 어떻게 돼?',
  '고객들은 주로 어느 나라에서 왔어?',
]

export function Composer() {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function pick(q: string) {
    setQuestion(q)
    inputRef.current?.focus()
  }

  return (
    <div>
      <div className={s.composer}>
        <input
          ref={inputRef}
          type="text"
          className={s.input}
          value={question}
          maxLength={300}
          placeholder={PLACEHOLDER}
          aria-label="질문 입력"
          onChange={(e) => setQuestion(e.target.value)}
        />
        {/* the page's one continuous motion: a slow breathing clay caret (must be an
            input sibling AFTER it — :placeholder-shown ~ hides it when text exists) */}
        <span className={s.caret} aria-hidden />
        <button type="button" className={s.sendBtn} disabled={!question.trim()}>
          질문 →
        </button>
      </div>

      <div className={s.footnotes}>
        <p className={s.schemaLine}>
          연결된 스키마{'  '}
          <span className={s.schemaTables}>{SCHEMA_TABLES.join(' · ')}</span>
        </p>
        <p className={s.readonly}>※ 구조적으로 읽기 전용 — 데모 에이전트는 SELECT만 실행할 수 있습니다.</p>
      </div>

      <div className={s.suggest}>
        <p className={s.suggestLabel}>바로 실행 — 즉시 응답</p>
        <div className={s.qList}>
          {QUESTIONS.map((q) => (
            <button key={q} type="button" className={s.qRow} onClick={() => pick(q)}>
              <span>{q}</span>
              <span className={s.qArrow} aria-hidden>
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
