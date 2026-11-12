import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-empty-report-'));
const browser = await chromium.launch({ channel: 'chrome' });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const { appDashboards: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], requests = [];
    await context.route('**/*', route => {
      const r = route.request(), u = new URL(r.url());
      if (u.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(r.method()) || u.pathname.startsWith('/api/'))) { requests.push(u.href); return route.abort(); }
      if (u.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(message.text())) errors.push(message.text()); });
    assert.equal((await page.goto(`${base}/dev/operations?view=board-empty`)).status(), 200);
    const panel = page.getByRole('region', { name: t.boardEmptyTitle, exact: true });
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(t.boardEmptyTitle);
    const link = panel.getByRole('link'); await expect(link).toHaveAttribute('href', '/app/ask');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      assert.equal(await panel.evaluate(el => getComputedStyle(el).borderRadius), '16px');
      assert.equal(await panel.locator('p').evaluate(el => getComputedStyle(el).fontSize), '14px');
      await link.focus(); await expect(link).toBeFocused();
      assert.equal(await link.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      const box = await link.boundingBox(); assert(box.height >= 44 && box.width >= 44);
      // Exercise the real anchor activation while suppressing navigation to auth/data routes.
      await link.evaluate(el => el.addEventListener('click', event => { event.preventDefault(); el.dataset.activated = 'true'; }, { once: true }));
      await page.keyboard.press('Enter'); await expect(link).toHaveAttribute('data-activated', 'true');
      await link.evaluate(el => delete el.dataset.activated);
      if (width === 320) await page.screenshot({ path: join(output, `${locale}-${theme}.png`), fullPage: true });
      renders++; interactions++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []); await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ renders, interactions, output }));
