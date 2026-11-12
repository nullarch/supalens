/** Public metadata only: never derive canonical/image URLs from request headers.
 * The apex redirects to www. Explicit self-hosted origins use the existing setting;
 * this module does not change auth, payment, email or webhook destinations. */
export function publicOrigin(configured = process.env.NEXT_PUBLIC_APP_URL): string {
  if (!configured?.trim()) return 'https://www.supalens.ai'
  try {
    const url = new URL(configured.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin')
    return url.origin
  } catch {
    throw new Error('NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) origin without credentials, a path, query or fragment')
  }
}

export function publicAlternates(locale: string, path: string) {
  const origin = publicOrigin()
  const en = `${origin}${path}`
  return {
    canonical: locale === 'en' ? en : `${origin}/${locale}${path}`,
    languages: { en, ko: `${origin}/ko${path}`, ja: `${origin}/ja${path}`, 'x-default': en },
  }
}
