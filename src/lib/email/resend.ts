// NOTE: intentionally NOT `import 'server-only'` — shared with lib/email/alert.ts,
// which the Trigger.dev evaluate-alerts task calls (a plain Node bundle where the
// server-only guard throws), same convention as utils/supabase/admin.ts.
import { Resend } from 'resend'

/** What every email module sends. The shape Resend takes; the SMTP transport maps it. */
export interface MailPayload {
  from: string
  to: string | string[]
  replyTo?: string
  subject: string
  html: string
  text?: string
  headers?: Record<string, string>
}

/** The one seam the email modules use: `client.emails.send(payload)` resolving to `{ error }`. */
export interface MailClient {
  emails: { send(payload: MailPayload): Promise<{ error: unknown }> }
}

/**
 * SMTP transport — any mail server, no SaaS account. SMTP_URL is a standard connection URL:
 * `smtp://user:pass@mail.example.com:587` (STARTTLS) or `smtps://…:465` (implicit TLS).
 * nodemailer is imported lazily so it is only loaded where mail is actually sent.
 */
function smtpClient(url: string): MailClient {
  return {
    emails: {
      async send(payload) {
        try {
          const { createTransport } = await import('nodemailer')
          await createTransport(url).sendMail({
            from: payload.from,
            to: payload.to,
            replyTo: payload.replyTo,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            headers: payload.headers,
          })
          return { error: null }
        } catch (error) {
          return { error }
        }
      },
    },
  }
}

/**
 * The configured mail transport, or null when there is none — callers must handle null (log +
 * degrade, never throw) rather than crash the whole action. SMTP_URL wins over RESEND_API_KEY.
 * (The name predates the SMTP transport and is kept so the email modules did not have to change.)
 */
export function getResendClient(): MailClient | null {
  const smtp = process.env.SMTP_URL
  if (smtp) return smtpClient(smtp)
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  const resend = new Resend(key)
  return {
    emails: {
      async send(payload) {
        const { error } = await resend.emails.send(payload as Parameters<typeof resend.emails.send>[0])
        return { error }
      },
    },
  }
}

/**
 * The verified "from" address: EMAIL_FROM, or the older RESEND_FROM_EMAIL. Falls back to
 * Resend's shared onboarding domain ONLY when Resend is the transport and outside production —
 * in prod that fallback would send unauthenticated mail (no SPF/DKIM/DMARC alignment → spam
 * folder + shared-reputation risk), so we return null and callers skip the send with a warning
 * (never-throw email contract) instead of silently shipping from resend.dev.
 */
export function emailFrom(): string | null {
  const v = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL
  if (v) return v
  if (process.env.NODE_ENV === 'production' || process.env.SMTP_URL) return null
  return 'Supalens <onboarding@resend.dev>'
}

/** Whether mail can actually be sent: a transport AND a from-address. UI uses this so it never
 *  claims "email alerts are on" for an install that has no way to send one. */
export function emailConfigured(): boolean {
  return Boolean((process.env.SMTP_URL || process.env.RESEND_API_KEY) && emailFrom())
}

/** Optional Reply-To (EMAIL_REPLY_TO / RESEND_REPLY_TO) — a monitored mailbox improves trust/reputation. */
export function emailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || process.env.RESEND_REPLY_TO || undefined
}

/** Map an app locale onto the email <html lang> attribute. */
export function emailLang(locale?: string): string {
  return locale === 'ko' || locale === 'ja' ? locale : 'en'
}
