/** Real public pages and read-only client navigation. No login, demo query,
 * profile save, support message or other external mutation is submitted.
 * Usage: node scripts/verify-public-locales.mjs http://localhost:3107
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const origin = new URL(base).origin;
const metadataOrigin = new URL(process.argv[3] || 'https://www.supalens.ai').origin;
const output = await mkdtemp(join(tmpdir(), 'supalens-public-locales-'));
const locales = ['en', 'ko', 'ja'];
const labels = { en: 'EN', ko: '한국어', ja: '日本語' };
const messages = Object.fromEntries(await Promise.all(locales.map(async locale =>
  [locale, JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'))])));
const routes = ['/', '/supabase', '/demo', '/privacy', '/terms', '/refund', '/docs/mcp'];
const pathFor = (route, locale) => locale === 'en' ? route : `/${locale}${route === '/' ? '' : route}`;
const normalize = text => text.replace(/\s+/g, '');
const heading = (route, t) => route === '/' ? t.globalProduct.headline + t.globalProduct.headlineMuted
  : route === '/supabase' ? t.supabasePage.headline1 + t.supabasePage.headline2
  : t[route === '/docs/mcp' ? 'docsMcp' : route.slice(1)].title;
const browser = await chromium.launch({ headless: true });
let viewportChecks = 0, navigationChecks = 0;
const errors = [], mutations = [], apiRequests = [];

async function contextFor(theme) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(value => localStorage.setItem('theme', value), theme);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) {
      if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) return route.continue();
      return route.abort();
    }
    if (!['GET', 'HEAD'].includes(request.method())) { mutations.push(request.method() + ' ' + url.pathname); return route.abort(); }
    if (url.pathname.startsWith('/api/')) { apiRequests.push(url.pathname); return route.abort(); }
    return route.continue();
  });
  return context;
}

async function inspect(page, route, locale, theme) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  assert.equal(normalize(await page.locator('h1').innerText()), normalize(heading(route, messages[locale])), `${route}: translated heading`);
  await expect.poll(async () => new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).href)
    .toBe(new URL(metadataOrigin + pathFor(route, locale)).href);
  for (const alternate of locales) {
    await expect.poll(async () => new URL(await page.locator(`link[rel="alternate"][hreflang="${alternate}"]`).getAttribute('href')).href)
      .toBe(new URL(metadataOrigin + pathFor(route, alternate)).href);
  }
  const localeControl = page.getByRole('button', { name: messages[locale].common.language, exact: true });
  if (route !== '/demo' && await localeControl.count()) {
    for (const control of await localeControl.all()) if (await control.isVisible()) await expect(control).toHaveText(labels[locale]);
  }
}

async function switchLanguage(page, current, next) {
  await expect.poll(() => page.getByRole('button', { name: messages[current].common.language, exact: true, includeHidden: true }).count()).toBeGreaterThan(0);
  let trigger = page.getByRole('button', { name: messages[current].common.language, exact: true }).filter({ visible: true });
  if (!await trigger.count()) {
    await page.getByRole('button', { name: messages[current].nav.menuOpen, exact: true }).click();
    trigger = page.getByRole('button', { name: messages[current].common.language, exact: true }).filter({ visible: true });
  }
  await trigger.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: labels[next], exact: true }).getByRole('button').click();
}

try {
  for (const theme of ['light', 'dark']) {
    const context = await contextFor(theme), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const locale of locales) {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: origin }]);
      for (const route of routes) {
        console.log(`CHECK ${theme} ${locale} ${route}`);
        const response = await page.goto(base + pathFor(route, locale), { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200);
        await inspect(page, route, locale, theme);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          viewportChecks++;
        }
        if (locale === 'ja') await page.screenshot({ path: join(output, `${route.replaceAll('/', '_') || 'home'}-${theme}-320.png`), fullPage: true });
      }
    }
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes.filter(route => route !== '/demo')) {
        const hash = ['/', '/supabase'].includes(route) ? '#pricing' : '#section-2';
        await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: origin }]);
        await page.goto(base + route + '?source=design&tag=one&tag=two' + hash);
        await page.evaluate(() => { window.__localeNavigationProof = 'same-document'; });
        let current = 'en';
        for (const next of ['ko', 'ja', 'en']) {
          await switchLanguage(page, current, next);
          await page.waitForURL(url => url.pathname === pathFor(route, next));
          await inspect(page, route, next, theme);
          const url = new URL(page.url());
          assert.deepEqual(url.searchParams.getAll('tag'), ['one', 'two']);
          assert.equal(url.searchParams.get('source'), 'design');
          assert.equal(url.hash, hash);
          assert.equal(await page.evaluate(() => window.__localeNavigationProof), 'same-document', 'must remain client navigation');
          assert.equal((await context.cookies()).find(cookie => cookie.name === 'NEXT_LOCALE')?.value, next);
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          current = next; navigationChecks++;
        }
        console.log(`PASS navigation ${theme} ${width} ${route}`);
      }
    }
    // A public client link crosses into a cookie-driven route after switching
    // locale in this same root. Server title AND client auth buttons must agree.
    for (const next of ['ko', 'ja']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: origin }]);
      await page.goto(base + '/demo');
      await page.locator('a[href="/docs/mcp"]').click();
      await page.waitForURL(url => url.pathname === '/docs/mcp');
      await switchLanguage(page, 'en', next);
      await page.waitForURL(url => url.pathname === pathFor('/docs/mcp', next));
      await page.locator('a[href="/app/settings/developer"]').click();
      await page.waitForURL(url => url.pathname === '/login');
      await expect(page.locator('html')).toHaveAttribute('lang', next);
      const t = messages[next].appAuth;
      // Compare the whole rendered form to a fresh same-cookie request rather
      // than relying only on its server-rendered heading.
      const actual = await page.getByRole('button').allTextContents();
      const fresh = await context.newPage(); await fresh.goto(page.url());
      assert.deepEqual(actual, await fresh.getByRole('button').allTextContents(), `${next}: stale client login messages`);
      assert.ok(actual.length >= 3 && !actual.some(text => text.includes('Continue with')));
      assert.ok(t.login);
      await fresh.close(); navigationChecks++;
      await page.goBack();
      await expect(page.locator('html')).toHaveAttribute('lang', next);
      await expect(page.getByRole('button', { name: messages[next].common.language, exact: true })).toHaveText(labels[next]);
      await page.goForward();
      await expect(page.locator('html')).toHaveAttribute('lang', next);
      assert.deepEqual(await page.getByRole('button').allTextContents(), actual);
      navigationChecks += 2;
    }
    await context.close();
    console.log(`PASS ${theme}: public rendering and locale navigation`);
  }
  assert.deepEqual(errors, [], 'runtime errors');
  assert.deepEqual(mutations, [], 'local mutations');
  assert.deepEqual(apiRequests, [], 'unexpected local API requests');
  console.log(JSON.stringify({ viewportChecks, navigationChecks, output }));
} finally { await browser.close(); }
