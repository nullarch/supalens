// Pure helpers for tracked /r/<code> links. No io, safe to import anywhere.

/** A ref code is exactly the generated shape (8 base62 chars; the range allows other lengths).
 *  Reject anything else fast so a junk /r/<garbage> path or a tampered cookie never hits the DB. */
export function isRefCode(code: string): boolean {
  return /^[A-Za-z0-9]{6,16}$/.test(code)
}
