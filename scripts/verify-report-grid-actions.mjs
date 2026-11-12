/** Real grid controllers; local callbacks only. No account, SQL or clipboard writes. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-report-grid-actions-'));
const browser = await chromium.launch({ channel: 'chrome' });
let layouts = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const { appDashboards: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const errors = [], requests = [];
    await context.route('**/*', route => {
      const r = route.request(), u = new URL(r.url());
      if (u.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(r.method()) || u.pathname.startsWith('/api/'))) { requests.push(r.url()); return route.abort(); }
      if (u.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push(`Native dialog: ${dialog.type()}`); await dialog.dismiss(); });
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
    const cells = page.locator('[data-grid-id]');
    const calls = async () => JSON.parse(await page.locator('[data-grid-calls]').getAttribute('data-grid-calls'));
    const payload = async () => JSON.parse(await page.locator('[data-grid-payload]').getAttribute('data-grid-payload'));
    async function start(mode = 'success', editing = true) {
      assert.equal((await page.goto(`${base}/dev/operations?view=grid-actions`)).status(), 200);
      await page.locator('[data-grid-actions-ready="true"]').waitFor();
      await page.getByLabel('Local outcome').selectOption(mode);
      if (editing) await page.getByRole('button', { name: t.grid.editLayout, exact: true }).click();
    }
    async function fit() {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(cells).toHaveCount(3);
      for (let i = 0; i < 3; i++) await expect(cells.nth(i).locator('h3')).toContainText(`${['A', 'B', 'C'][i]} · Payments`);
      for (const cell of await cells.all()) {
        const title = await cell.locator('h3').boundingBox();
        const edit = await cell.getByRole('button', { name: t.grid.editWidget, exact: true }).boundingBox();
        assert(title.y >= edit.y + edit.height, 'Editing actions must not cover the widget title');
      }
      for (const button of await cells.locator('button:not([inert] button)').all()) {
        const box = await button.boundingBox();
        if (box) assert(box.width >= 43 && box.height >= 43, `Small grid control ${await button.getAttribute('aria-label')}`);
      }
    }
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await start(); await fit(); layouts++;
      const a = page.locator('[data-grid-id="a"]');
      const move = a.locator('[data-grid-move]');
      await move.focus(); await page.keyboard.press('ArrowDown');
      await expect.poll(async () => (await calls()).layout).toBe(1);
      await expect(move).toBeFocused();
      assert.deepEqual((await payload()).value.map(item => item.id), ['b', 'a', 'c']);
      await page.keyboard.press('Home');
      await expect.poll(async () => (await calls()).layout).toBe(2);
      assert.deepEqual((await payload()).value.map(item => item.id), ['a', 'b', 'c']);
      await page.keyboard.press('ArrowUp'); assert.equal((await calls()).layout, 2);
      const resize = a.getByRole('button', { name: new RegExp(`^${t.grid.resizeWidget}:`) });
      await resize.focus(); await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await calls()).layout).toBe(3);
      assert.deepEqual((await payload()).value[0], { id: 'a', x: 0, y: 0, w: 7, h: 3, position: 0 });
      await expect(resize).toBeFocused();
      await page.keyboard.press('ArrowUp'); assert.equal((await calls()).layout, 3);
      if (width === 320) await page.screenshot({ path: join(output, `editing-${locale}-${theme}.png`), fullPage: true });
      interactions++;
    }
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 1440) {
        await start();
        const resize = cells.first().getByRole('button', { name: new RegExp(`^${t.grid.resizeWidget}:`) });
        await resize.scrollIntoViewIfNeeded();
        let box = await resize.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x + 98, box.y + 98); await page.keyboard.press('Escape'); await page.mouse.up();
        assert.equal((await calls()).layout, 0);
        assert.equal(await cells.first().evaluate(el => el.style.gridRow), 'span 3');
        box = await resize.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 98, box.y + 98); await page.mouse.up();
        await expect.poll(async () => (await calls()).layout).toBe(1);
        assert.equal((await payload()).value[0].h, 4);
        await start();
        const a = await cells.nth(0).boundingBox(), b = await cells.nth(1).boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + 110); await page.mouse.down();
        await page.mouse.move(b.x + b.width * .75, b.y + b.height * .75); await page.mouse.up();
        await expect.poll(async () => (await calls()).layout).toBe(1);
        assert.deepEqual((await payload()).value.map(item => item.id), ['b', 'a', 'c']);
        interactions++;
      }
      for (const mode of ['success', 'rejected', 'throw', 'malformed', 'pending']) {
        await start(mode);
        const opener = cells.first().getByRole('button', { name: t.grid.removeWidget, exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('A · Payments');
        await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); assert.equal((await calls()).remove, 0);
        await opener.click();
        await dialog.getByRole('button', { name: t.grid.removeWidget, exact: true }).click();
        if (mode === 'pending') {
          await expect(cells).toHaveCount(3);
          await expect(dialog.getByRole('button', { name: t.grid.removing, exact: true })).toBeDisabled();
          await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
          assert.equal((await calls()).remove, 1);
        }
        if (['success', 'pending'].includes(mode)) {
          await expect(dialog).toBeHidden(); await expect(cells).toHaveCount(2);
          await expect(page.getByRole('button', { name: t.grid.done, exact: true })).toBeFocused();
          await page.getByRole('button', { name: t.grid.reset, exact: true }).click(); await expect(cells).toHaveCount(2);
          assert.deepEqual((await payload()).value.map(item => item.id), ['b', 'c']);
        } else {
          await expect(dialog.getByRole('alert')).toHaveText(mode === 'rejected' ? t.grid.removeFailed : t.grid.changeUnknown);
          await expect(cells).toHaveCount(3);
          assert.equal((await payload()).value, 'a');
          if (width === 320 && mode === 'throw') await dialog.screenshot({ path: join(output, `unknown-${locale}-${theme}.png`) });
          await page.keyboard.press('Escape');
          if (mode === 'rejected') {
            await expect(opener).toBeFocused();
            await page.getByLabel('Local outcome').selectOption('success'); await opener.click();
            await dialog.getByRole('button', { name: t.grid.removeWidget, exact: true }).click(); await expect(cells).toHaveCount(2);
            assert.equal((await calls()).remove, 2);
          } else {
            await expect(page.getByRole('button', { name: t.grid.reset, exact: true })).toBeDisabled();
            await cells.first().locator('[data-grid-move]').focus(); await page.keyboard.press('ArrowDown'); assert.equal((await calls()).layout, 0);
            await expect(page.getByRole('button', { name: t.grid.review, exact: true })).toBeVisible();
          }
        }
        interactions++;
      }
      for (const mode of ['rejected', 'throw', 'malformed', 'pending']) {
        await start(mode);
        const move = cells.first().locator('[data-grid-move]');
        await move.focus(); await page.keyboard.press('ArrowDown');
        if (mode === 'pending') {
          await page.keyboard.press('ArrowDown'); assert.equal((await calls()).layout, 1);
          await expect(page.getByText(t.grid.layoutSaving, { exact: true })).toBeVisible();
          await expect(page.getByText(t.grid.layoutSaved, { exact: true })).toBeVisible();
        } else if (mode === 'rejected') {
          await expect(page.getByText(t.grid.layoutFailed, { exact: false })).toBeVisible();
          await page.getByLabel('Local outcome').selectOption('success');
          await page.getByRole('button', { name: t.grid.retryLayout, exact: true }).click();
          await expect(page.getByText(t.grid.layoutSaved, { exact: true })).toBeVisible();
          assert.deepEqual((await payload()).value.map(item => item.id), ['b', 'a', 'c']);
        } else {
          await expect(page.getByRole('button', { name: t.grid.review, exact: true })).toBeVisible();
          await move.focus(); await page.keyboard.press('ArrowDown'); assert.equal((await calls()).layout, 1);
        }
        interactions++;
      }
      for (const mode of ['throw', 'malformed']) {
        await start(mode); await cells.first().getByRole('button', { name: t.grid.editWidget, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(t.grid.fieldTitle, { exact: true }).fill('Preserved draft');
        await dialog.getByRole('button', { name: t.grid.save, exact: true }).click();
        await expect(dialog.getByRole('alert')).toHaveText(t.grid.changeUnknown);
        await expect(dialog.getByLabel(t.grid.fieldTitle, { exact: true })).toHaveValue('Preserved draft');
        await expect(dialog.getByRole('button', { name: t.grid.review, exact: true })).toBeVisible();
        assert.equal((await calls()).update, 1); interactions++;
      }
      for (const mode of ['success', 'rejected', 'throw', 'pending']) {
        await start(mode, false);
        const menu = cells.first().getByRole('button', { name: t.widget.menu, exact: true });
        await menu.click(); await page.getByRole('menuitem', { name: t.debug.open, exact: true }).click();
        const dialog = page.getByRole('dialog'), region = dialog.getByRole('region', { name: t.debug.sql, exact: true });
        assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'SQL must not overflow its dialog');
        await region.focus(); await page.keyboard.press('ArrowRight');
        await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        await dialog.getByRole('button', { name: t.debug.copy, exact: true }).click();
        if (mode === 'pending') {
          const pending = dialog.getByRole('button', { name: t.debug.copying, exact: true });
          await expect(pending).toHaveAttribute('aria-disabled', 'true');
          await page.keyboard.press('Enter'); assert.equal((await calls()).copy, 1);
        }
        if (['success', 'pending'].includes(mode)) await expect(dialog.getByRole('status')).toHaveText(t.debug.copied);
        else await expect(dialog.getByRole('alert')).toHaveText(t.debug.copyFailed);
        assert.match((await payload()).value, /^SELECT /);
        await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); interactions++;
      }
    }
    // A late layout acknowledgement must not enter a different report instance.
    await start('pending'); await cells.first().locator('[data-grid-move]').focus(); await page.keyboard.press('ArrowDown');
    await page.getByRole('button', { name: 'Switch sample report', exact: true }).click();
    await page.getByRole('button', { name: t.grid.editLayout, exact: true }).click();
    await page.waitForTimeout(1900);
    assert.deepEqual(await cells.evaluateAll(els => els.map(el => el.dataset.gridId)), ['a', 'b', 'c']);
    await expect(page.getByText(t.grid.layoutSaved, { exact: true })).toHaveCount(0); interactions++;
    await start('pending', false);
    await cells.first().getByRole('button', { name: t.widget.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: t.debug.open, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: t.debug.copy, exact: true }).click();
    await page.keyboard.press('Escape');
    await cells.nth(1).getByRole('button', { name: t.widget.menu, exact: true }).click();
    await page.getByRole('menuitem', { name: t.debug.open, exact: true }).click();
    await page.waitForTimeout(1900);
    await expect(page.getByRole('dialog').getByRole('button', { name: t.debug.copy, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0); interactions++;
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close(); console.log(`PASS ${locale}/${theme}`);
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ layouts, interactions, output }));
