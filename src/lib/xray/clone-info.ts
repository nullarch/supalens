// NOT server-only — runs in the Trigger task right after the clone (host side).
// File count for "214 files" and the exact commit that was read (the report's provenance).
import { execFile } from 'child_process'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', 'vendor', '.venv'])
const MAX_FILES = 200_000

async function countFiles(dir: string): Promise<number> {
  let count = 0
  const stack = [dir]
  while (stack.length && count < MAX_FILES) {
    const current = stack.pop() as string
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(current, entry.name))
      } else if (entry.isFile()) {
        count += 1
      }
    }
  }
  return count
}

export async function cloneInfo(dir: string): Promise<{ fileCount: number; sha: string | null }> {
  const [fileCount, sha] = await Promise.all([
    countFiles(dir),
    execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 10_000 })
      .then(({ stdout }) => {
        const s = stdout.trim()
        return /^[0-9a-f]{40}$/i.test(s) ? s : null
      })
      .catch(() => null),
  ])
  return { fileCount, sha }
}
