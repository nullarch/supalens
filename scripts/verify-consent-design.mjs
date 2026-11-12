/** Native document UI only. Sample decisions are GETs; no real grants or auth POSTs. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
const errorsOnly = process.argv.includes('--errors-only');
const output = await mkdtemp(join(tmpdir(), 'supalens-consent-design-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const { oauthConsent: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled, colorScheme: javaScriptEnabled ? theme === 'dark' ? 'light' : 'dark' : theme });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      if (javaScriptEnabled) await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const unexpected = [], errors = [];
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== new URL(base).origin) {
          if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
            if (request.headers().referer?.includes(base)) { unexpected.push('Document referrer sent to fonts'); return route.abort(); }
            return route.continue();
          }
          unexpected.push(url.href); return route.abort();
        }
        if (request.method() !== 'GET' || (url.pathname.startsWith('/api/') && (url.pathname !== '/api/oauth/authorize' || url.search))) { unexpected.push(request.method() + ' ' + url.href); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const fit = async () => {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
          assert(await page.locator('.card').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No hidden card overflow');
          for (const button of await page.getByRole('button').all()) {
            const style = await button.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, height: el.getBoundingClientRect().height }));
            assert.equal(style.radius, '6px'); assert(style.height >= 44);
          }
          renders++;
        }
      };
      const modes = errorsOnly ? [] : javaScriptEnabled ? ['standard', 'read', 'default', 'whitespace', 'long', 'escaped', 'error', 'expired'] : ['standard', 'long', 'error'];
      for (const mode of [...modes, 'real-error']) {
        const response = await page.goto(base + (mode === 'real-error' ? '/api/oauth/authorize' : `/dev/entry/consent?mode=${mode}`));
        assert.equal(response.status(), mode === 'real-error' ? 400 : 200);
        assert.equal(response.headers()['cache-control'], 'no-store');
        // Global Next headers may set strict-origin; the document/link policy is narrower.
        await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin');
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        if (javaScriptEnabled) await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), theme === 'dark' ? 'rgb(21, 22, 24)' : 'rgb(251, 252, 252)');
        await fit();
        const isError = ['real-error', 'error', 'expired'].includes(mode);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(isError ? t.errorTitle : t.title);
        if (isError) {
          await expect(page.getByRole('button')).toHaveCount(0); await expect(page.locator('form')).toHaveCount(0);
          if (mode === 'real-error') await expect(page.getByRole('alert')).toHaveText(t.review.missingClient);
          if (mode === 'expired') await expect(page.getByRole('alert')).toHaveText(t.sessionExpired);
          await expect(page.locator('a.button')).toHaveAttribute('href', locale === 'en' ? '/' : `/${locale}`);
        } else {
          await expect(page.getByRole('region', { name: t.review.clientLabel, exact: true })).toBeVisible();
          await expect(page.getByRole('region', { name: t.review.permissions, exact: true })).toBeVisible();
          await expect(page.getByText(t.review.scopeNote, { exact: true })).toBeVisible();
          await expect(page.locator('form')).toHaveAttribute('method', 'get');
          await expect(page.locator('form')).toHaveAttribute('action', '/dev/entry/consent');
          await expect(page.locator('form input[type="hidden"]')).toHaveCount(9);
          if (mode === 'read' || mode === 'whitespace') await expect(page.locator('.scopes li')).toHaveText(['read']);
          if (mode === 'standard' || mode === 'default') await expect(page.locator('.scopes li')).toHaveText(['read', 'write']);
          if (mode === 'escaped') {
            await expect(page.locator('.client-name')).toHaveText('<img src=x onerror="window.__injected=true"> & Sample app');
            await expect(page.locator('img')).toHaveCount(0); assert.equal(await page.evaluate(() => window.__injected), undefined);
          }
          for (const decision of ['approve', 'deny']) {
            const fields = await page.locator('form').evaluate(form => Object.fromEntries(new FormData(form)));
            const button = page.getByRole('button', { name: t[decision], exact: true });
            await button.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
            assert.equal(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
            await button.press('Enter');
            await expect.poll(() => new URL(page.url()).searchParams.get('decision')).toBe(decision);
            const destination = new URL(page.url()); assert.equal(destination.pathname, '/dev/entry/consent');
            for (const [key, value] of Object.entries(fields)) assert.equal(destination.searchParams.get(key), value, key);
            await expect(page.getByRole('status')).toContainText(`Simulated decision: ${decision}.`);
            assert(!destination.searchParams.has('code'));
            interactions++;
          }
          if (mode === 'standard') {
            // Match the production native POST method, but fulfill it entirely in the browser.
            const expectedFields = await page.locator('form').evaluate(form => Object.fromEntries(new FormData(form)));
            let submitted;
            await page.route('**/__consent_post_contract__', async route => {
              const request = route.request();
              submitted = { method: request.method(), origin: request.headers().origin, referrer: request.headers().referer, body: request.postData() };
              await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>Local POST captured; no grant issued.</p>' });
            });
            await page.locator('form').evaluate(form => { form.method = 'post'; form.action = '/__consent_post_contract__'; });
            await page.getByRole('button', { name: t.deny, exact: true }).press('Enter');
            await expect(page).toHaveURL(base + '/__consent_post_contract__');
            assert.equal(submitted.method, 'POST'); assert.equal(submitted.origin, new URL(base).origin);
            assert.equal(submitted.referrer, new URL(base).origin + '/');
            const body = new URLSearchParams(submitted.body);
            assert.equal(body.get('decision'), 'deny');
            for (const [key, value] of Object.entries(expectedFields)) assert.equal(body.get(key), value, key);
            interactions++;
          }
        }
        if (javaScriptEnabled && ['long', 'real-error'].includes(mode)) await page.screenshot({ path: join(output, `${mode}-${locale}-${theme}-320.png`), fullPage: true });
      }
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
    console.log(`PASS consent ${locale}/${theme}`);
  }
  // Storage failure must still follow the system theme without breaking native forms.
  if (!errorsOnly) {
    const context = await browser.newContext({ colorScheme: 'dark' });
    await context.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Blocked local storage') }; });
    const page = await context.newPage();
    await page.goto(base + '/dev/entry/consent');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(21, 22, 24)');
    await expect(page.locator('form')).toBeVisible(); interactions++;
    await context.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
