import { describe, expect, it } from 'vitest'

import { proseBlocks } from './prose-blocks'

describe('demo answer prose', () => {
  it('splits the analyst markdown into headings, paragraphs, lists and tables', () => {
    const blocks = proseBlocks(
      '## Revenue dipped\n\nDaily revenue fell.\nIt recovered.\n\n- one\n- two\n1. first\n2) second\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'bullets', 'numbers', 'table'])
    expect(blocks[0].lines).toEqual(['Revenue dipped'])
    expect(blocks[1].lines).toEqual(['Daily revenue fell.', 'It recovered.'])
    expect(blocks[2].lines).toEqual(['one', 'two'])
    expect(blocks[3].lines).toEqual(['first', 'second'])
    expect(blocks[4].lines).toHaveLength(3)
  })
})
