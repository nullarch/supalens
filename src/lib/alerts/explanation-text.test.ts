import { describe, expect, it } from 'vitest'

import { explanationPreview, stripInlineMarkdown } from './explanation-text'

// The production text that prompted the collapsed view: a lead sentence with a narration tail, a
// bold "root cause" paragraph, and a long body.
const PROD = `Trial사용자들이 모두 "free" 플랜에 할당되고 있으므로, 실제 전환이 일어나지 않고 있습니다. 데이터 분석 결과를 정리하겠습니다:

**근본 원인: Trial 사용자가 모두 "free" 플랜으로 자동 할당되고 있습니다.**

데이터에서 \`trial_ends_at IS NOT NULL\`을 가진 181명의 사용자 중 180명(99.4%)이 \`plan='free'\`로 설정되어 있고, 오직 1명만 \`plan='pro'\`입니다.`

describe('explanationPreview', () => {
  it('returns null for empty input', () => {
    expect(explanationPreview(null)).toBeNull()
    expect(explanationPreview('   \n\n ')).toBeNull()
  })

  it('leads with the first sentence and drops the narration tail', () => {
    const p = explanationPreview(PROD)!
    expect(p.summary).toBe('Trial사용자들이 모두 "free" 플랜에 할당되고 있으므로, 실제 전환이 일어나지 않고 있습니다.')
    expect(p.hasMore).toBe(true)
    expect(p.paragraphs[0]).not.toContain('정리하겠습니다')
    expect(p.paragraphs).toHaveLength(3)
  })

  it('keeps bold for the renderer but strips code ticks, and keeps decimals whole', () => {
    const p = explanationPreview(PROD)!
    expect(p.paragraphs[1]).toBe('**근본 원인: Trial 사용자가 모두 "free" 플랜으로 자동 할당되고 있습니다.**')
    expect(p.paragraphs[2]).toContain("180명(99.4%)이 plan='free'로")
  })

  it('skips a heading or bare label when choosing the summary', () => {
    const p = explanationPreview('## 근본 원인\n\n**요약**\n\nRoot cause:\n결제 웹훅이 3시간 동안 실패했습니다. 재시도 큐가 비어 있습니다.')!
    expect(p.summary).toBe('결제 웹훅이 3시간 동안 실패했습니다.')
    expect(p.paragraphs[0]).toBe('근본 원인')
  })

  it('drops whole-line narration in en and ja', () => {
    expect(explanationPreview("Let me summarize the findings:\n\nSignups fell 40% on iOS.")!.paragraphs).toEqual([
      'Signups fell 40% on iOS.',
    ])
    expect(explanationPreview('結果をまとめます:\n\n新規登録が40%減少しました。')!.summary).toBe('新規登録が40%減少しました。')
  })

  it('does not treat a one-sentence explanation as expandable', () => {
    const p = explanationPreview('**Signups fell 40%** on iOS after the 2.3 release.')!
    expect(p.summary).toBe('Signups fell 40% on iOS after the 2.3 release.')
    expect(p.hasMore).toBe(false)
  })

  it('turns markdown bullets into dots', () => {
    const p = explanationPreview('Two causes.\n- iOS 2.3 release\n* Paywall copy change')!
    expect(p.paragraphs[0]).toBe('Two causes.\n• iOS 2.3 release\n• Paywall copy change')
    expect(p.hasMore).toBe(true)
  })
})

describe('stripInlineMarkdown', () => {
  it('removes emphasis, code, heading markers, and stray bold markers', () => {
    expect(stripInlineMarkdown('## **a** `b` __c__ d**')).toBe('a b c d')
  })
})
