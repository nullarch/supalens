import type { MetadataRoute } from 'next'

import { publicOrigin } from '@/lib/metadata/public-origin'

// Marketing is indexable; the authed product surface and internals are not.
export default function robots(): MetadataRoute.Robots {
  const SITE_URL = publicOrigin()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app/', '/api/', '/auth/', '/login', '/share/', '/dev/', '/test/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
