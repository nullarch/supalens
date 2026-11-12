import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import type TypeScript from 'typescript'
import * as jsx from 'react/jsx-runtime'

import { parseEdition } from '@/config/edition'

// Load the compiler as a Node dependency, not a Vite-transformed app module.
const ts = createRequire(import.meta.url)('typescript') as typeof TypeScript

/** Execute an actual JSX server-page module with explicit local dependencies.
 * Every unknown import fails closed. No app/database/provider module is loaded.
 * This tests route composition, not Next RSC/auth/RLS integration. */
export function loadRoute(path: string, dependencies: Record<string, unknown>, environment: Readonly<Record<string, string | undefined>> = {}) {
  const file = resolve('src/app', path)
  if (!file.startsWith(resolve('src/app') + '/')) throw new Error('Route must be inside src/app')
  const source = readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const routeModule = { exports: {} }
  new Script(compiled, { filename: file }).runInNewContext({
    module: routeModule, exports: routeModule.exports,
    require: (id: string) => {
      if (id === 'react/jsx-runtime') return jsx
      if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id]
      // Which optional integrations are registered: everything on unless a test says otherwise.
      if (id === '@/lib/integrations/availability') {
        return { integrationAvailability: () => ({ supabaseConnect: true, github: true, slack: true, email: true }) }
      }
      // Pure env config: resolved from the route's sandboxed environment, never the real one.
      if (id === '@/config/edition') {
        const current = () => parseEdition(environment.NEXT_PUBLIC_SUPALENS_EDITION ?? 'cloud')
        return {
          edition: current,
          isCloud: () => current() === 'cloud',
          isSelfHosted: () => current() === 'selfhost',
          appOrigin: () => environment.NEXT_PUBLIC_APP_URL ?? 'https://supalens.ai',
        }
      }
      throw new Error(`Unmocked route dependency: ${id}`)
    },
    // the host Date, so a test that pins the clock pins it for the route too
    console: { error: () => {} }, URL, URLSearchParams, Date,
    // Never expose the developer's real process environment or credentials.
    process: { env: Object.freeze({ ...environment }) },
  }, { timeout: 1000 })
  return routeModule.exports as { default: (...args: unknown[]) => unknown }
}
