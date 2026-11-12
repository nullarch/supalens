import type { ReactNode } from 'react'

import { proseBlocks } from './prose-blocks'
import s from './DemoConsole.module.css'

/** **bold** and `code`; everything else stays text (React escapes it). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    return part
  })
}

export function Prose({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = proseBlocks(text)
  return (
    <div className={s.prose}>
      {blocks.map((block, i) => {
        const caret = streaming && i === blocks.length - 1 ? <span className={s.caret} aria-hidden /> : null
        switch (block.kind) {
          case 'heading':
            return (
              <p key={i} className={s.proseHeading}>
                {inline(block.lines[0])}
                {caret}
              </p>
            )
          case 'bullets':
          case 'numbers': {
            const List = block.kind === 'bullets' ? 'ul' : 'ol'
            return (
              <List key={i}>
                {block.lines.map((line, j) => (
                  <li key={j}>
                    {inline(line)}
                    {j === block.lines.length - 1 ? caret : null}
                  </li>
                ))}
              </List>
            )
          }
          case 'table':
            return (
              <pre key={i} className={s.proseTable} tabIndex={0}>
                {block.lines.filter((line) => !/^\|?\s*:?-{2,}/.test(line)).join('\n')}
              </pre>
            )
          default:
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {inline(line)}
                  </span>
                ))}
                {caret}
              </p>
            )
        }
      })}
    </div>
  )
}
