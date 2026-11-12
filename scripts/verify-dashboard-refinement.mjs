/** Read-only component fixtures; never navigate to authenticated destinations or run queries. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-dashboard-refinement-'));
const browser = await chromium.launch({ headless: true });
let views = 0;
const measurements = [];
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], writes = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && url.pathname === '/api/jobs/active' && request.method() === 'GET') return route.fulfill({ json: { jobs: [] } });
      if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) { writes.push(url.pathname); return route.abort(); }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
    assert.equal((await page.goto(`${base}/dev/dashboard/report-preview`)).status(), 200);
    await page.evaluate(() => document.fonts.ready);
    const line = page.locator('[data-grid-id="w-incident"]');
    await expect(line.locator('.recharts-responsive-container')).toBeVisible();
    await expect(page.locator('[data-grid-id="w-paused"] .recharts-responsive-container')).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('supalens.dashlayout.dev-report-preview')), null, 'Visual minimums must not save on load');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      // ResizeObserver is debounced; wait for rendered SVG width, not just the CSS box.
      for (const id of ['w-incident', 'w-paused']) {
        await expect.poll(() => page.locator(`[data-grid-id="${id}"] .recharts-responsive-container`).evaluate(el => {
          const svg = el.querySelector('svg.recharts-surface');
          return svg ? Math.abs(svg.getBoundingClientRect().width - el.getBoundingClientRect().width) : Infinity;
        })).toBeLessThanOrEqual(1);
      }
      await expect.poll(() => line.locator('.recharts-responsive-container').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(200);
      const measure = await line.evaluate(el => {
        const footer = el.querySelector('[data-widget-footer]');
        return { card: el.getBoundingClientRect().height, plot: el.querySelector('.recharts-responsive-container').getBoundingClientRect().height, footer: footer.getBoundingClientRect().height, footerScroll: footer.scrollHeight > footer.clientHeight + 1 };
      });
      assert(!measure.footerScroll);
      measurements.push({ locale, theme, width, ...measure });
      if (locale === 'ko' && [1440, 390].includes(width)) await page.screenshot({ path: join(output, `report-${theme}-${width}.png`), fullPage: true });
      views++;
    }
    // Both keyboard and pointer use the same 16px grid geometry and readable row floor.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: messages.appDashboards.grid.editLayout, exact: true }).click();
    const resize = line.getByRole('button', { name: new RegExp(`^${messages.appDashboards.grid.resizeWidget}:`) });
    await resize.focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await line.evaluate(el => el.style.gridRow), 'span 5');
    assert.equal(await page.evaluate(() => localStorage.getItem('supalens.dashlayout.dev-report-preview')), null);
    await page.getByRole('button', { name: messages.appDashboards.grid.done, exact: true }).click();

    assert.equal((await page.goto(`${base}/dev/overview?mode=incident`)).status(), 200);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const sections = await page.locator('[data-split="true"] > section').evaluateAll(nodes => nodes.map(el => ({ id: el.getAttribute('aria-labelledby'), top: el.getBoundingClientRect().top })));
      assert.deepEqual(sections.map(s => s.id), ['overview-monitors-title', 'overview-investigation-title', 'overview-remaining-title']);
      if (width <= 1200) assert(sections[0].top < sections[1].top && sections[1].top < sections[2].top);
      await expect(page.locator('main a[data-state]')).toHaveCount(5);
      const firstRow = page.locator('main a[data-state]').first();
      // At 320px a translated expected-range label may need another line; retain it in full.
      if (width >= 390) assert((await firstRow.boundingBox()).height <= (width > 640 ? 80 : 112));
      assert(await firstRow.locator('[class*="expected"]').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.equal(await firstRow.locator('[class*="tileName"]').evaluate(el => getComputedStyle(el).fontSize), '14px');
      if (locale === 'ko' && [1440, 390].includes(width)) await page.screenshot({ path: join(output, `overview-${theme}-${width}.png`), fullPage: true });
      views++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    await context.close(); console.log(`PASS refinement ${locale}/${theme}`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ views, measurements, output }));
