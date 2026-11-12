#!/usr/bin/env node
// Guard for a public repository: fails when a tracked file contains an identifier or a document
// that must stay internal. Run locally before pushing and in CI.
//
//   node scripts/check-public-tree.mjs
//
// The deny-list is deliberately made of PATTERNS, not the identifiers themselves, wherever the
// literal value would itself be the leak.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'

const SELF = 'scripts/check-public-tree.mjs'

/** Paths that must not be tracked at all. */
const FORBIDDEN_PATHS = [
  /^STATE\.md$/,
  /^TODO\.md$/,
  /^MARKETING\.md$/,
  /^CLAUDE\.local\.md$/,
  /^docs\/(marketing|design-review)\//,
  /^\.claude\//,
  /^\.agents\//,
  /^branding\//,
  /^scripts\/verify-/,
  /^src\/lib\/outreach\//,
  /^video\//,
  /^\.env(\..*)?$/,
  /\.(pem|p12|key)$/,
  /\.log$/,
]
const ALLOWED_ENV_FILES = new Set(['.env.example', '.env.test'])

/** Content that must not appear in any tracked text file. */
const FORBIDDEN_CONTENT = [
  { name: 'hosted Supabase project ref in a command', re: /--project-(ref|id) [a-z]{20}\b/ },
  { name: 'hosted Trigger.dev project ref', re: /\bproj_(?!replace_me\b)[a-z]{20}\b/ },
  { name: 'GCP project path with a numeric project id', re: /projects\/\d{9,}\/secrets\// },
  { name: 'Vercel deployment or team id', re: /\b(dpl|team)_[A-Za-z0-9]{20,}\b/ },
  { name: 'local home directory path', re: /\/Users\/[a-z][a-z0-9_-]*\// },
  { name: 'Slack or Discord webhook URL', re: /https:\/\/(hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{16,}|discord(app)?\.com\/api\/webhooks\/\d{10,}\/[\w-]{20,})/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\n[A-Za-z0-9+/=\n]{200,}/ },
  { name: 'live provider secret', re: /\b(sk-ant-[A-Za-z0-9_-]{20,}|pdl_live_apikey_[A-Za-z0-9]{10,}|sntrys_[A-Za-z0-9+/=_-]{40,}|re_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|tr_(dev|prod)_[A-Za-z0-9]{16,})\b/ },
  { name: 'reference to a removed internal document', re: /docs\/(marketing|design-review)\/[\w.-]+/ },
  { name: 'design-source product name', re: /\bNari( Labs|-app| app)\b|narilabs/i },
]

/** Files that hold credential-SHAPED fixtures on purpose (redaction tests). */
const CONTENT_EXEMPT = new Set(['src/lib/xray/xray.test.ts'])

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const problems = []

for (const file of files) {
  if (file === SELF) continue
  for (const re of FORBIDDEN_PATHS) {
    if (re.test(file) && !ALLOWED_ENV_FILES.has(file)) problems.push(`${file}: path must not be tracked`)
  }
  let stat
  try {
    stat = lstatSync(file)
  } catch {
    continue // deleted in the working tree
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue // symlinks, large assets
  if (CONTENT_EXEMPT.has(file)) continue
  const buf = readFileSync(file)
  if (buf.includes(0)) continue // binary
  const text = buf.toString('utf8')
  for (const { name, re } of FORBIDDEN_CONTENT) {
    const match = re.exec(text)
    if (!match) continue
    const line = text.slice(0, match.index).split('\n').length
    problems.push(`${file}:${line}: ${name}`)
  }
}

if (problems.length > 0) {
  console.error(`check-public-tree: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log(`check-public-tree: ${files.length} tracked files clean`)
