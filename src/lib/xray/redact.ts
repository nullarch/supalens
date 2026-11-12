// NOT server-only — runs inside the Trigger task's submit_xray handler.
//
// X-ray reports are PUBLIC pages built from public repos, and public repos do commit secrets.
// Every code line we copy into a report passes through here first, so a key that happens to sit
// next to a revenue query never gets republished by us. Patterns err on the side of redacting.

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs (Supabase keys)
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"`]+/gi, // connection strings with creds
]

// `secret = "…"`, `apiKey: '…'`, `PASSWORD="…"` — keep the name, drop the value.
const ASSIGNMENT = /((?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|auth)\w*["']?\s*[:=]\s*)(["'`])([^"'`]{6,})\2/gi

export const REDACTED = '[redacted]'

export function redactLine(text: string): string {
  let out = text.replace(ASSIGNMENT, (_m, lead: string, quote: string) => `${lead}${quote}${REDACTED}${quote}`)
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED)
  return out
}
