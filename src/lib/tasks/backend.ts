// NOTE: intentionally NOT `import 'server-only'` — read on the server, in the browser and by
// next.config.ts. Pure env.
//
// Where background work runs:
//   trigger — Trigger.dev (the hosted service, or a self-hoster who brings their own project)
//   builtin — inside the web server process (the self-hosted default: nothing else to install)
//
// The choice is made at BUILD time, because a builtin build aliases `@trigger.dev/sdk` and
// `@trigger.dev/react-hooks` to the in-process implementations (next.config.ts). next.config
// publishes its decision as NEXT_PUBLIC_SUPALENS_TASK_BACKEND so runtime code agrees with the
// bundle it is running in.

export type TaskBackend = 'trigger' | 'builtin'

/** The rule next.config.ts applies. Self-hosted → builtin unless SUPALENS_TASK_BACKEND=trigger. */
export function resolveTaskBackend(env: Record<string, string | undefined>): TaskBackend {
  const edition = env.NEXT_PUBLIC_SUPALENS_EDITION?.trim().toLowerCase()
  const selfHosted = edition === 'selfhost' || edition === 'self-hosted' || edition === 'selfhosted'
  return selfHosted && env.SUPALENS_TASK_BACKEND?.trim().toLowerCase() !== 'trigger' ? 'builtin' : 'trigger'
}

export function taskBackend(): TaskBackend {
  return process.env.NEXT_PUBLIC_SUPALENS_TASK_BACKEND === 'builtin' ? 'builtin' : 'trigger'
}

export function isBuiltinTaskBackend(): boolean {
  return taskBackend() === 'builtin'
}
