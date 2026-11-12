import { appOrigin, isSelfHosted } from '@/config/edition'

/**
 * The base to resolve a redirect target against in a route handler.
 *
 * On the hosted platform `req.url` is the public URL. A self-hosted server sits behind a proxy
 * and, in a standalone build, `req.url` is its own bind address (`http://0.0.0.0:3000/…`) — a
 * redirect built from it sends the browser to a host that does not exist. There the configured
 * public origin (NEXT_PUBLIC_APP_URL) is the only correct answer.
 */
export function requestBase(req: Request): string {
  return isSelfHosted() ? appOrigin() : req.url
}
