/** Actual report grid/monitor strip. Synthetic props, no API or action IO. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-report-footer-'));
const browser = await chromium.launch({ channel: 'chrome' });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const { appDashboards: t, appCommon: common } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], requests = [];
    await context.route('**/*', route => {
      const r = route.request(), url = new URL(r.url());
      if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(r.method()) || url.pathname.startsWith('/api/'))) { requests.push(r.url()); return route.abort(); }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(m.text())) errors.push(m.text()); });
    assert.equal((await page.goto(`${base}/dev/operations?view=footer`)).status(), 200);
    await page.evaluate(() => document.fonts.ready);
    const cards = page.locator('[data-report-footer-preview] [data-widget-card]');
    await expect(cards).toHaveCount(6);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (let i = 0; i < 6; i++) {
        const card = cards.nth(i), footer = card.locator('[data-widget-footer]');
        if (i === 5) { await expect(footer).toHaveCount(0); continue; }
        await expect(footer).toHaveCount(1);
        const measured = await card.evaluate(el => {
          const card = el.getBoundingClientRect(), footerNode = el.querySelector('[data-widget-footer]'), footer = footerNode.getBoundingClientRect();
          const body = el.querySelector('[data-widget-body]').getBoundingClientRect();
          const small = [...el.querySelectorAll('[class*="mStatus"], [class*="mChecked"], [class*="mLink"], [class*="mDefSummary"]')].filter(el => parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent);
          return { inside: footer.bottom <= card.bottom + 1, body: body.height, footerHeight: footer.height, footerScroll: footerNode.scrollHeight > footerNode.clientHeight + 1, small };
        });
        assert(measured.inside, 'Footer exceeds fixed card'); assert(measured.body >= 100, `Missing numeric body room: ${locale}/${width}/${i}/${measured.body}`); assert.deepEqual(measured.small, []);
        assert(!measured.footerScroll, 'Compact footer must not scroll');
        assert(measured.footerHeight <= 100, 'Compact footer consumes too much card space');
        const status = footer.locator('[data-tone]');
        await expect(status).toHaveAttribute('data-tone', i === 3 ? 'paused' : i === 4 ? 'incident' : 'watching');
        if (i === 1) await expect(footer).toContainText(t.monitor.checkedNever);
        else if (i === 2) await expect(footer).toContainText(t.widget.timeUnavailable);
        else { await expect(footer.locator('time')).toHaveAttribute('datetime', '2026-09-08T00:00:00.000Z'); await expect(footer.locator('time')).toContainText('UTC'); }
        for (const link of await footer.getByRole('link').all()) assert((await link.boundingBox()).height >= 44);
        await expect(footer.getByRole('link')).toHaveCount(1);
        await expect(footer.getByRole('link')).toHaveAttribute('href', i === 4 ? '/app/incidents/sample-incident' : `/app/monitors/sample-monitor-${['recorded', 'pending', 'invalid', 'paused', 'incident'][i]}`);
        const details = footer.getByRole('button', { name: t.monitor.details, exact: true });
        await details.click();
        const detailDialog = page.getByRole('dialog');
        await expect(detailDialog).toBeVisible();
        const monitorLink = detailDialog.getByRole('link', { name: t.monitor.viewMonitor, exact: true });
        await expect(monitorLink).toHaveAttribute('href', `/app/monitors/sample-monitor-${['recorded', 'pending', 'invalid', 'paused', 'incident'][i]}`);
        const ask = new URL(await detailDialog.getByRole('link', { name: t.monitor.askChange, exact: true }).getAttribute('href'), base);
        assert.equal(ask.pathname, '/app/ask'); assert.equal(ask.searchParams.get('q'), t.monitor.askQuestion.replace('{title}', await card.locator('h3').textContent()));
        await expect(detailDialog.locator('ul li')).toHaveCount(9);
        if (![1, 2].includes(i)) await expect(detailDialog.locator('time')).toContainText('2026');
        await page.keyboard.press('Escape'); await expect(details).toBeFocused(); interactions++;
      }
      const shortFooter = cards.nth(1).locator('[data-widget-footer]');
      const metadata = cards.nth(1).getByRole('button', { name: t.widget.details, exact: true });
      await metadata.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText(await cards.nth(1).locator('h3').textContent());
      await page.keyboard.press('Escape'); await expect(metadata).toBeFocused(); interactions++;
      const opener = shortFooter.getByRole('button', { name: t.monitor.details, exact: true });
      await opener.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('ul li')).toHaveCount(9);
      await expect(dialog.locator('ul li').last()).toContainText('Evidence 9:');
      const box = await dialog.boundingBox(); assert(box.x >= 15 && box.x + box.width <= width - 15);
      assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      if (width === 320) await dialog.screenshot({ path: join(output, `definition-${locale}-${theme}.png`) });
      await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); interactions++;
      const menu = cards.first().getByRole('button', { name: t.widget.menu, exact: true });
      assert((await menu.boundingBox()).height >= 44);
      await menu.focus(); await page.keyboard.press('ArrowDown');
      const item = page.getByRole('menuitem', { name: t.debug.open, exact: true });
      await expect(item).toBeFocused();
      await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); await expect(item).toHaveCount(0);
      await page.keyboard.press('Enter'); await expect(item).toBeFocused(); await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: common.close, exact: true }).first().click(); await expect(menu).toBeFocused(); interactions++;
      renders++;
    }
    await page.locator('[data-widget-footer]').evaluateAll(nodes => nodes.forEach(el => { el.scrollTop = 0; }));
    await page.screenshot({ path: join(output, `grid-${locale}-${theme}.png`), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close(); console.log(`PASS report footer ${locale}/${theme}`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ renders, interactions, screenshots: output }));
