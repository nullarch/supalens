// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev runtime (the outbox
// cron, bootstrap-supabase-projects, and the Paddle sync reached via plans/usage.ts), same
// convention as utils/supabase/admin.ts.

/**
 * content-agent tracking ingress (the separate content-ops system that measures which social
 * posts drive business outcomes). BOTH vars must be set — on Vercel AND on the Trigger.dev host —
 * or every content-agent seam (ca_variant capture, attribution, outbox enqueue, delivery) is a
 * complete no-op.
 *
 *   CONTENT_AGENT_TRACKING_URL   full events endpoint, e.g. https://track.example.com/tracking/supalens/events
 *   CONTENT_AGENT_TRACKING_TOKEN the per-service bearer token
 */
export interface ContentAgentConfig {
  url: string
  token: string
}

/** The endpoint must be https (plain http only for a local ingress during development). */
function isAcceptableUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function getContentAgentConfig(): ContentAgentConfig | null {
  const url = process.env.CONTENT_AGENT_TRACKING_URL?.trim()
  const token = process.env.CONTENT_AGENT_TRACKING_TOKEN?.trim()
  if (!url || !token || !isAcceptableUrl(url)) return null
  return { url, token }
}

export function contentAgentConfigured(): boolean {
  return getContentAgentConfig() !== null
}
