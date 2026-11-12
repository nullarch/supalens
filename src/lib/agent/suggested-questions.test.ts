import { describe, expect, it } from 'vitest'

import { buildSuggestedQuestions, MAX_SUGGESTED_QUESTIONS, type SuggestibleKpi } from './suggested-questions'

const T = ['{title} 지난주 대비', '{title} 세그먼트별 분해']

const kpi = (key: string, title: string, status = 'accepted', importance = 3): SuggestibleKpi => ({
  key,
  title,
  status,
  importance,
})

describe('buildSuggestedQuestions', () => {
  it('only ever suggests APPROVED KPIs — a proposal is not a definition the team agreed on', () => {
    const out = buildSuggestedQuestions(
      [kpi('a', 'MRR', 'proposed'), kpi('b', '이탈률', 'dismissed'), kpi('c', '신규 가입')],
      T,
    )
    // one approved KPI → one chip per template angle, never the same phrasing twice
    expect(out.map((o) => o.text)).toEqual(['신규 가입 지난주 대비', '신규 가입 세그먼트별 분해'])
  })

  it('orders by importance, then fills with the next template', () => {
    const out = buildSuggestedQuestions([kpi('a', 'A', 'accepted', 1), kpi('b', 'B', 'accepted', 5)], T)
    expect(out.map((o) => o.text)).toEqual([
      'B 지난주 대비',
      'A 지난주 대비',
      'B 세그먼트별 분해',
      'A 세그먼트별 분해',
    ])
  })

  it('caps at six chips even with many KPIs', () => {
    const many = Array.from({ length: 20 }, (_, i) => kpi(`k${i}`, `KPI ${i}`))
    expect(buildSuggestedQuestions(many, T)).toHaveLength(MAX_SUGGESTED_QUESTIONS)
  })

  it('returns nothing when there is nothing approved (caller falls back to the empty state)', () => {
    expect(buildSuggestedQuestions([], T)).toEqual([])
    expect(buildSuggestedQuestions([kpi('a', 'MRR', 'proposed')], T)).toEqual([])
    expect(buildSuggestedQuestions([kpi('a', '   ')], T)).toEqual([])
  })

  it('produces stable, unique react keys', () => {
    const out = buildSuggestedQuestions([kpi('a', 'A'), kpi('b', 'B')], T)
    expect(new Set(out.map((o) => o.id)).size).toBe(out.length)
  })

  it('degrades to empty when no templates are supplied', () => {
    expect(buildSuggestedQuestions([kpi('a', 'A')], [])).toEqual([])
  })
})
