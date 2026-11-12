// Light markdown parsing for the demo analyst's answers (no JSX, unit-tested).

export type Block = { kind: 'heading' | 'paragraph' | 'bullets' | 'numbers' | 'table'; lines: string[] }

const BULLET = /^\s*[-*•]\s+/
const NUMBER = /^\s*\d+[.)]\s+/

/** Parse the analyst's light markdown: headings, paragraphs, bullet/numbered lists, pipe tables. */
export function proseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  const open = (kind: Block['kind']) => {
    if (current?.kind !== kind) {
      current = { kind, lines: [] }
      blocks.push(current)
    }
    return current
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      current = null
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ kind: 'heading', lines: [line.replace(/^#{1,6}\s+/, '')] })
      current = null
    } else if (BULLET.test(line)) {
      open('bullets').lines.push(line.replace(BULLET, ''))
    } else if (NUMBER.test(line)) {
      open('numbers').lines.push(line.replace(NUMBER, ''))
    } else if (line.trim().startsWith('|')) {
      open('table').lines.push(line.trim())
    } else {
      open('paragraph').lines.push(line.trim())
    }
  }
  return blocks
}
