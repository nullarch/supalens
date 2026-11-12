// NOTE: intentionally NOT `import 'server-only'` — pure utility shared with the
// Trigger.dev email senders, same convention as email/resend.ts.

/**
 * Escape user- or model-authored text before embedding it in email HTML.
 * Every user-derived field (org name, alert name, inviter name, …) must pass
 * through this — a display name like `<img onerror=…>` must never render as
 * markup inside a trusted template (content-injection / spoofing vector).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
