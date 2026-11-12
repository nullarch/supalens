import { createNavigation } from 'next-intl/navigation'

import { routing } from './routing'

// Locale-aware navigation primitives (prefix-aware Link/useRouter/usePathname/redirect).
// Marketing components navigate through these so `/ko` + `/ja` prefixes are handled
// automatically; the switcher also writes NEXT_LOCALE so the choice carries into /app.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing)
