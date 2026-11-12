// NOT `import 'server-only'` — runs in the Trigger.dev runtime.
//
// In-process MCP tools for the code-analysis agent. Handlers run in THIS (parent) process,
// path-jailed to the clone dir — the exact analogue of agent/tools.ts (buildSqlTools), but
// for files instead of SQL. The model only ever sees the JSON the handler returns; it gets
// ZERO direct filesystem access, so there is no path-traversal surface and we have one place
// to skip node_modules/binaries and redact secret files before they reach the model context.
//
// READ-ONLY by construction: there is no tool that writes, builds, installs, or executes the
// repo (no `npm install`, no test runs) — the same way the SQL agent literally cannot UPDATE.
// list_files/grep_code use ripgrep (`rg`) via execFile (no shell, fixed args, jailed root).
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, stat, lstat, realpath } from 'fs/promises'
import { resolve, relative, isAbsolute } from 'path'

import { createSdkMcpServer, tool } from '@/lib/llm/agent-sdk'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

const MAX_FILE_BYTES = 256 * 1024
const MAX_LIST = 2000
const MAX_MATCHES = 200
// excluded from listing/grep — noise + attack surface.
const SKIP_GLOBS = [
  '!**/node_modules/**',
  '!**/.git/**',
  '!**/dist/**',
  '!**/build/**',
  '!**/.next/**',
  '!**/__pycache__/**',
  '!**/*.min.js',
]
// never expose secret-bearing files to the model context.
export const SECRET_RE = /(^|\/)\.env(\.|$)|\.(pem|key|pfx|p12)$|(^|\/)(id_rsa|id_ed25519)$|credentials?\.(json|ya?ml)$/i

/** resolve `p` inside `cloneDir`, or null if it escapes (`..`, symlink target, absolute).
 *
 * String containment alone is NOT enough: a repo can commit a symlink pointing at
 * /proc/self/environ or any host file, and this handler runs in the PARENT process whose
 * env holds the service-role/KEK secrets. So after the string check we lstat-reject
 * symlinks and realpath-recheck containment (catches symlinked intermediate dirs too).
 * cloneRepo additionally clones with core.symlinks=false — this is defense in depth. */
export async function jail(cloneDir: string, p: string): Promise<string | null> {
  const abs = resolve(cloneDir, p)
  const rel = relative(cloneDir, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  try {
    if ((await lstat(abs)).isSymbolicLink()) return null
    const [realRoot, real] = await Promise.all([realpath(cloneDir), realpath(abs)])
    const realRel = relative(realRoot, real)
    if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) return null
    return real
  } catch {
    return null // missing file / unreadable — treat as escape
  }
}

const SHA_RE = /^[0-9a-f]{4,40}$/i

function errIsNoMatch(e: unknown): boolean {
  return (e as { code?: number })?.code === 1 // ripgrep exits 1 when there are no matches
}

export function buildCodeTools(cloneDir: string) {
  return createSdkMcpServer({
    name: 'supalens_code',
    instructions:
      'Read-only access to a cloned repository working tree: list, read, grep, diff. No execution, no writes.',
    tools: [
      tool(
        'list_files',
        'List repository file paths (relative to repo root). Skips .git/node_modules/build dirs. Optional ripgrep glob filter.',
        { glob: z.string().optional().describe('optional ripgrep glob, e.g. "src/**/*.ts"') },
        async ({ glob }) => {
          try {
            const a = ['--files', ...SKIP_GLOBS.flatMap((g) => ['-g', g])]
            if (glob) a.push('-g', glob)
            const { stdout } = await execFileAsync('rg', a, {
              cwd: cloneDir,
              timeout: 30_000,
              maxBuffer: 8 * 1024 * 1024,
            }).catch((e) => {
              if (errIsNoMatch(e)) return { stdout: '' }
              throw e
            })
            // redact secret-bearing files here too — read_file refuses them, so listing their
            // paths (and grep returning their contents) must not become a side channel into the
            // model context. (rg already skips dotfiles like .env without --hidden, but committed
            // *.pem/*.key/id_rsa/credentials.* are non-hidden and would otherwise surface.)
            const files = stdout.split('\n').filter(Boolean).filter((f) => !SECRET_RE.test(f)).slice(0, MAX_LIST)
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ files, truncated: files.length >= MAX_LIST }) }],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `list_files failed: ${String(e).slice(0, 200)}` }], isError: true }
          }
        }
      ),
      tool(
        'read_file',
        'Read a UTF-8 text file (path relative to repo root). Secret files are redacted; oversized files are truncated.',
        { path: z.string().describe('repo-relative file path') },
        async ({ path }) => {
          const abs = await jail(cloneDir, path)
          if (!abs) return { content: [{ type: 'text' as const, text: 'path escapes the repository' }], isError: true }
          if (SECRET_RE.test(path)) return { content: [{ type: 'text' as const, text: '[redacted: potential secret file]' }] }
          try {
            const st = await stat(abs)
            if (!st.isFile()) return { content: [{ type: 'text' as const, text: 'not a regular file' }], isError: true }
            const buf = await readFile(abs)
            const text = buf.subarray(0, MAX_FILE_BYTES).toString('utf8')
            return { content: [{ type: 'text' as const, text: buf.length > MAX_FILE_BYTES ? `${text}\n…[truncated]` : text }] }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `read_file failed: ${String(e).slice(0, 200)}` }], isError: true }
          }
        }
      ),
      tool(
        'grep_code',
        'Search file contents with a regular expression (ripgrep). Returns matching files, line numbers, and lines.',
        { pattern: z.string().describe('regex to search for'), glob: z.string().optional() },
        async ({ pattern, glob }) => {
          try {
            const a = ['--json', ...SKIP_GLOBS.flatMap((g) => ['-g', g])]
            if (glob) a.push('-g', glob)
            a.push('-e', pattern)
            const { stdout } = await execFileAsync('rg', a, {
              cwd: cloneDir,
              timeout: 30_000,
              maxBuffer: 8 * 1024 * 1024,
            }).catch((e) => {
              if (errIsNoMatch(e)) return { stdout: '' }
              throw e
            })
            const matches: { file: string; line: number; text: string }[] = []
            for (const line of stdout.split('\n')) {
              if (!line) continue
              try {
                const j = JSON.parse(line) as {
                  type: string
                  data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
                }
                if (j.type === 'match' && j.data) {
                  const file = j.data.path?.text ?? '?'
                  // never return contents of secret-bearing files (parity with read_file / list_files).
                  if (SECRET_RE.test(file)) continue
                  matches.push({
                    file,
                    line: j.data.line_number ?? 0,
                    text: (j.data.lines?.text ?? '').slice(0, 300),
                  })
                  if (matches.length >= MAX_MATCHES) break
                }
              } catch {
                /* skip malformed json line */
              }
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ matches, truncated: matches.length >= MAX_MATCHES }) }],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `grep_code failed: ${String(e).slice(0, 200)}` }], isError: true }
          }
        }
      ),
      tool(
        'get_diff',
        'Show the git diff stat between two commit SHAs (best-effort; shallow clones may lack the base commit).',
        { before: z.string(), after: z.string() },
        async ({ before, after }) => {
          if (!SHA_RE.test(before) || !SHA_RE.test(after))
            return { content: [{ type: 'text' as const, text: 'invalid commit sha' }], isError: true }
          try {
            const { stdout } = await execFileAsync(
              'git',
              ['-C', cloneDir, 'diff', '--stat', `${before}..${after}`],
              { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
            ).catch(() => ({ stdout: '' }))
            return {
              content: [{ type: 'text' as const, text: stdout.slice(0, 8000) || 'no diff available (base commit not in shallow clone)' }],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `get_diff failed: ${String(e).slice(0, 200)}` }], isError: true }
          }
        }
      ),
    ],
  })
}
