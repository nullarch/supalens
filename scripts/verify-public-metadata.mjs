// Read-only emitted metadata checks. No auth, transactions, demo queries or writes.
import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://localhost:3112';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const origin = new URL(process.argv[3] || 'https://www.supalens.ai').origin;
const paths = ['', '/supabase', '/demo', '/docs/mcp', '/privacy', '/terms', '/refund'];
const locales = ['en', 'ko', 'ja'];
const localized = (path, locale) => `${locale === 'en' ? '' : `/${locale}`}${path}`;
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll('&amp;', '&')]));
let pages = 0;
for (const path of paths) for (const locale of locales) {
  const route = localized(path, locale) || '/';
  const response = await fetch(`${base}${route}`, { headers: { cookie: `NEXT_LOCALE=${locale}`, 'user-agent': 'Twitterbot' }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(m => attrs(m[0]));
  const canonical = links.filter(link => link.rel === 'canonical');
  assert.equal(canonical.length, 1, `Single canonical: ${route}`);
  assert.equal(new URL(canonical[0].href).href, new URL(origin + route).href);
  for (const language of [...locales, 'x-default']) {
    const alternate = links.filter(link => link.rel === 'alternate' && link.hrefLang === language);
    // HTML serializers can lower-case attribute names.
    if (!alternate.length) alternate.push(...links.filter(link => link.rel === 'alternate' && link.hreflang === language));
    assert.equal(alternate.length, 1, `Single ${language} alternate: ${route}`);
    const expected = origin + localized(path, language === 'x-default' ? 'en' : language);
    assert.equal(new URL(alternate[0].href).href, new URL(expected).href);
  }
  pages++;
}
const sitemap = await fetch(`${base}/sitemap.xml`);
assert.equal(sitemap.status, 200);
const xml = await sitemap.text();
const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
assert.deepEqual(locations, paths.map(path => origin + path));
const alternates = [...xml.matchAll(/<xhtml:link\b[^>]*>/g)].map(m => attrs(m[0]));
assert.equal(alternates.length, paths.length * locales.length);
for (const link of alternates) assert.equal(new URL(link.href).origin, origin);
const robots = await fetch(`${base}/robots.txt`);
assert.equal(robots.status, 200);
const text = await robots.text();
assert(text.includes(`Host: ${origin}`));
assert(text.includes(`Sitemap: ${origin}/sitemap.xml`));
assert(text.includes('Disallow: /share/'));
console.log(JSON.stringify({ publicMetadataPages: pages, sitemapLocations: locations.length, sitemapAlternates: alternates.length, robots: true, origin }));
