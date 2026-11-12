/** Actual setup guide, zero-source state and shared-answer presentation; no account/query IO. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
const output = await mkdtemp(join(tmpdir(), 'supalens-ask-entry-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors = [], unexpected = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method()))) {
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const [view, path] of [
      ['guide', '/dev/wizard?view=pill'], ['empty', '/dev/wizard?view=ask-empty'], ['shared', '/dev/analysis?view=shared'],
    ]) {
      assert.equal((await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (view === 'guide') {
          const guides = page.getByRole('region', { name: m.appOnboarding.pill.guideLabel });
          await expect(guides).toHaveCount(2);
          for (const guide of await guides.all()) {
            await expect(guide.getByRole('listitem')).toHaveCount(5);
            const link = guide.getByRole('link', { name: m.appOnboarding.pill.continueCta });
            await expect(link).toHaveAttribute('href', '/app/setup');
            assert.equal(await guide.evaluate(el => getComputedStyle(el).borderRadius), '16px');
            for (const control of [link, guide.getByRole('button')]) {
              const box = await control.boundingBox();
              assert.ok(box.height >= 44 && box.width >= 44);
              assert.equal(await control.evaluate(el => getComputedStyle(el).borderRadius), '10px');
              assert.ok(await control.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
            }
            assert.ok(await link.evaluate(el => {
              const probe = document.createElement('span'); probe.style.color = 'var(--on-action)'; probe.style.backgroundColor = 'var(--action)'; document.body.append(probe);
              const match = getComputedStyle(el).color === getComputedStyle(probe).color && getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
              probe.remove(); return match;
            }));
          }
        } else if (view === 'empty') {
          await expect(page.getByRole('heading', { name: m.appAsk.title, level: 1 })).toBeVisible();
          await expect(page.getByText(m.appAsk.empty.noSources, { exact: true })).toBeVisible();
          await expect(page.getByRole('link', { name: m.appAsk.empty.connectCta })).toHaveAttribute('href', '/app/sources');
          assert.equal(await page.locator('section [data-empty-card]').evaluate(el => getComputedStyle(el).borderRadius), '16px');
        } else {
          const links = page.locator('main a[href]');
          assert.equal(await links.count(), 2);
          for (const link of await links.all()) await expect(link).toHaveAttribute('href', locale === 'en' ? '/' : `/${locale}`);
        }
        if ([1440, 320].includes(width)) await page.screenshot({ path: join(output, `${view}-${locale}-${theme}-${width}.png`), fullPage: true });
        renders++;
      }
    }
    await page.goto(`${base}/dev/wizard?view=pill`);
    const guides = page.getByRole('region', { name: m.appOnboarding.pill.guideLabel });
    const button = guides.first().getByRole('button', { name: m.appOnboarding.pill.dismiss });
    await button.focus();
    assert.notEqual(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Enter');
    await expect(guides).toHaveCount(1);
    assert.equal(await page.evaluate(() => localStorage.getItem('supalens.setupPill.dismissed')), '1');
    await page.reload(); await expect(guides).toHaveCount(0); interactions += 3;
    await context.close();
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);

    const blocked = await browser.newContext();
    await blocked.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
      Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
    });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`${base}/dev/wizard?view=pill`);
    const blockedGuides = blockedPage.getByRole('region', { name: m.appOnboarding.pill.guideLabel });
    await expect(blockedGuides).toHaveCount(2);
    await blockedGuides.first().getByRole('button').click(); await expect(blockedGuides).toHaveCount(1);
    await blockedPage.reload(); await expect(blockedGuides).toHaveCount(2); interactions += 2;
    await blocked.close();
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }));
} finally { await browser.close(); }
