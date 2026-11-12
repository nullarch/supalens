import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Trigger.dev task runtime must be an explicitly pinned Node LTS.
 *
 * `runtime` left unset in trigger.config.ts means 'node', which built every deploy on Node 21
 * (non-LTS, end-of-life) until Trigger.dev announced that Node 21 deploys fail from 2026-10-05.
 * Nothing in the build warned about it — the only signal was an email. This pins the choice so it
 * can only change on purpose (and with it, the SDK that knows the runtime name).
 */
const SUPPORTED_LTS = ['node-24'] as const

describe('trigger.config.ts runtime', () => {
  const source = readFileSync(resolve(__dirname, '../../trigger.config.ts'), 'utf8')
  const runtime = /^\s*runtime:\s*['"]([^'"]+)['"]/m.exec(source)?.[1]

  it('is set explicitly (the implicit default was an EOL Node)', () => {
    expect(runtime).toBeDefined()
  })

  it('is a supported Node LTS', () => {
    expect(SUPPORTED_LTS).toContain(runtime)
  })

  it('is a runtime the installed Trigger.dev build schema knows', async () => {
    const { BuildRuntime } = await import('@trigger.dev/core/v3/schemas')
    expect(BuildRuntime.safeParse(runtime).success).toBe(true)
  })
})
