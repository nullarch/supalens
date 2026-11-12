// NOT `import 'server-only'` — runs in the Trigger.dev runtime (plain Node bundle).
//
// Host-side git clone for the code-analysis agent. The installation token is injected via
// GIT_ASKPASS and a parent-only env var, so it NEVER lands in argv, the clone URL,
// .git/config, reflogs, or shell history. The checkout is a read-only snapshot — the agent
// only reads it through jailed in-process tools; nothing here builds or runs the repo.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, writeFile, chmod, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

export interface CloneArgs {
  /** "owner/repo" */
  fullName: string
  /** installation access token (~1h) — used only for the network fetch, then dropped.
   *  Omitted for a PUBLIC repository (the /x X-ray): the clone runs anonymously. */
  token?: string
  runId: string
  /** branch to clone (default branch if omitted). */
  ref?: string
  depth?: number
  /** monorepo: only materialize these paths (sparse-checkout). */
  sparsePaths?: string[]
  /** blobless partial clone — metadata only, blobs fetched lazily on access. */
  blobless?: boolean
}

export interface CloneResult {
  /** absolute path to the checked-out working tree. */
  dir: string
  /** remove the scratch dir (call in a finally). */
  cleanup: () => Promise<void>
}

/**
 * Clone a repo into an ephemeral scratch dir. Default = shallow (`--depth 1
 * --single-branch`) which finishes well within the 1h token window. Throws on failure
 * (after cleaning up the scratch dir).
 */
export async function cloneRepo(args: CloneArgs): Promise<CloneResult> {
  const root = await mkdtemp(join(tmpdir(), `code-run-${args.runId}-`))
  const dir = join(root, 'repo')
  const askpass = join(root, 'askpass.sh')

  // GIT_ASKPASS helper: prints the token from the parent-only GH_TOKEN env var when git
  // asks for the password. The token is never on the command line or in any config file.
  // Anonymous (public) clones get no helper and no token — a prompt just fails fast.
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (args.token) {
    await writeFile(askpass, '#!/bin/sh\nprintf "%s" "$GH_TOKEN"\n', { mode: 0o700 })
    await chmod(askpass, 0o700)
    env.GIT_ASKPASS = askpass
    env.GH_TOKEN = args.token
  }

  const cleanup = async () => {
    try {
      await rm(root, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  try {
    // core.symlinks=false: symlinks committed in the (untrusted) repo are materialized as
    // plain text files, so they can never point tools at host paths (see code-agent jail).
    const cloneArgs = ['-c', 'core.symlinks=false', 'clone', `--depth=${args.depth ?? 1}`, '--single-branch']
    if (args.ref) cloneArgs.push('--branch', args.ref)
    if (args.blobless) cloneArgs.push('--filter=blob:none')
    if (args.sparsePaths?.length) cloneArgs.push('--sparse')
    // username only — NO secret in the URL. The password comes from GIT_ASKPASS.
    const host = args.token ? 'x-access-token@github.com' : 'github.com'
    cloneArgs.push(`https://${host}/${args.fullName}.git`, dir)

    await execFileAsync('git', cloneArgs, { env, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 })

    if (args.sparsePaths?.length) {
      await execFileAsync('git', ['-C', dir, 'sparse-checkout', 'set', ...args.sparsePaths], { env })
    }

    // strip the auth username from the stored remote (defense in depth — no creds at rest).
    await execFileAsync(
      'git',
      ['-C', dir, 'remote', 'set-url', 'origin', `https://github.com/${args.fullName}.git`],
      { env }
    )

    return { dir, cleanup }
  } catch (err) {
    await cleanup()
    throw new Error(`git clone failed for ${args.fullName}: ${String(err).slice(0, 200)}`)
  }
}
