/** Screenshot-matched data, local fixture actions only. No customer or provider writes. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-monitor-density-'));
const browser = await chromium.launch({ headless: true });
let views = 0, interactions = 0;
const measurements = [];
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const t = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appMonitors;
    const recovery = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')).appRecovery;
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 2048, height: 1000 } });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], requests = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) {
        requests.push(request.url()); return route.abort();
      }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|hydration|cannot be a descendant/i.test(message.text())) errors.push(message.text()); });
    assert.equal((await page.goto(`${base}/dev/monitors?mode=reconnect`)).status(), 200);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');
    const manager = page.locator('[data-monitor-manager]');
    const row = page.locator('[data-monitor-id="fixture-reconnect-0"]');
    await expect(page.locator('[data-monitor-id]')).toHaveCount(4);
    await expect(page.getByRole('region', { name: recovery.heading })).toHaveCount(1);
    await page.locator('[data-recovery-kind=authorization] > summary').click();
    await expect(page.getByRole('link', { name: recovery.reauthorize, exact: false })).toHaveAttribute('href', /connectionId=00000000-0000-4000-8000-000000000001/);
    await page.locator('[data-recovery-kind=authorization] > summary').click();
    for (const width of [2048, 1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const bounds = await manager.boundingBox();
      assert(bounds.width <= 1600); // a wide page (data-page-width="wide"), same measure as the overview
      await expect(row).toHaveCSS('display', bounds.width <= 920 ? 'grid' : 'table-row');
      await expect(page.locator('[data-current-value]')).toHaveText(['—', '—', '—', '—']);
      for (const button of await row.getByRole('button').all()) {
        const box = await button.boundingBox(); assert(box.width >= 44 && box.height >= 44, '44px row controls');
      }
      const more = row.locator('button[aria-haspopup="menu"]');
      await more.focus(); await page.keyboard.press('ArrowUp');
      await expect(row.getByRole('menuitem', { name: t.btn.delete })).toBeFocused();
      const menuBox = await row.getByRole('menu').boundingBox();
      assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, 'Menu fits without horizontal clipping');
      await page.keyboard.press('Escape'); await expect(more).toBeFocused();
      await expect(page.locator('[data-fixture-calls]')).toContainText('No sample requests');
      measurements.push({ locale, theme, width, manager: bounds.width, row: (await row.boundingBox()).height });
      if (locale === 'ko' && [2048, 1440, 390].includes(width)) await page.screenshot({ path: join(output, `reconnect-${theme}-${width}.png`), fullPage: true });
      views++; interactions++;
    }
    // Pausing retains the recorded issue, but excludes that monitor from verification.
    await row.locator('button[aria-pressed]').click();
    await expect(row.locator('button[aria-pressed]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('region', { name: recovery.heading })).toContainText(recovery.paused);
    await expect(row.locator('[data-current-value]')).toHaveText('—');
    await expect(row).toContainText(`${t.detail.lastRecorded} · 1.64`);
    interactions++;
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close(); console.log(`PASS density ${locale}/${theme}`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ views, interactions, measurements, output }));
