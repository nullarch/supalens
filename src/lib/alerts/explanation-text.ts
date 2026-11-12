// PURE display shaping for the root-cause agent's free text (alert_events.explanation) — no io, no
// React, no server imports, so client components and server views share it.
//
// The stored text is the agent's raw output: several paragraphs, markdown emphasis (`**…**`), and at
// times a narration line the prompt forbids but the model still emits ("데이터 분석 결과를
// 정리하겠습니다:"). A monitor row can't afford all of that inline, so views show `summary` (one
// sentence) and reveal `paragraphs` on demand.

export interface ExplanationPreview {
  /** First substantive sentence, markdown stripped — the collapsed one-liner. */
  summary: string
  /** The whole text as display paragraphs: narration dropped, `**bold**` kept for the renderer. */
  paragraphs: string[]
  /** True when the paragraphs say more than `summary` — only then is a toggle worth rendering. */
  hasMore: boolean
}

// A narration sentence announces output instead of being output: it ends with a colon AND reads as
// "I will now…" in one of the three product locales. A plain label like "근본 원인:" is not one.
const NARRATION_TAIL = /(겠습니다|겠어요|드릴게요|볼게요|ます|ましょう)\s*[:：]$/
const NARRATION_LEAD = /^(now,?\s+)?(let me|let's|i'?ll|i will|i'?m going to|here'?s|here is|here are|below is|below are)\b.*[:：]$/i
const isNarration = (plain: string) => NARRATION_TAIL.test(plain) || NARRATION_LEAD.test(plain)

/** Splits a line into sentences on . ! ? followed by whitespace (so "99.4%" stays whole) and on 。 */
function sentences(line: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    const boundary = c === '。' || ((c === '.' || c === '!' || c === '?') && (i + 1 === line.length || /\s/.test(line[i + 1])))
    if (boundary) {
      out.push(line.slice(start, i + 1).trim())
      start = i + 1
    }
  }
  out.push(line.slice(start).trim())
  return out.filter(Boolean)
}

/** Removes markdown emphasis/code/heading markers — for text that renders with no formatting. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
}

function cleanLine(line: string): string {
  const kept = sentences(line.trim()).filter((sentence) => !isNarration(stripInlineMarkdown(sentence).trim()))
  return kept
    .join(' ')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '• ')
    .replace(/`([^`]+)`/g, '$1')
}

// A heading or a bare label ("## 근본 원인", "**요약**", "Root cause:") makes a poor one-liner: short
// and not closed by sentence punctuation. (Heading markers are already stripped by cleanLine.)
function headingLike(sentence: string): boolean {
  const plain = stripInlineMarkdown(sentence).trim()
  return !plain || (plain.length <= 40 && !/[.!?。]$/.test(plain))
}

export function explanationPreview(text: string | null | undefined): ExplanationPreview | null {
  if (!text?.trim()) return null
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map(cleanLine).filter(Boolean).join('\n'))
    .filter(Boolean)
  if (paragraphs.length === 0) return null

  const all = paragraphs.flatMap((p) => p.split('\n')).flatMap(sentences)
  const lead = all.find((sentence) => !headingLike(sentence)) ?? all[0]
  const summary = stripInlineMarkdown(lead).replace(/^•\s*/, '').replace(/\s+/g, ' ').trim()

  const fullPlain = stripInlineMarkdown(paragraphs.join(' ')).replace(/\s+/g, ' ').trim()
  return { summary, paragraphs, hasMore: fullPlain.length > summary.length }
}
