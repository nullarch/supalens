/** Real detail controller, local adapters only; all API/action IO is blocked. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-monitor-detail-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = messages.appMonitors;
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const io = [], errors = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method()))) {
        io.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
    const root = page.locator('[data-monitor-detail-actions]');
    const dialog = page.getByRole('dialog');
    const state = async () => JSON.parse(await page.locator('[data-fixture-calls]').textContent());
    const open = async (outcome = 'success', role = 'owner') => {
      const response = await page.goto(`${base}/dev/monitors?view=detail-actions&outcome=${outcome}&role=${role}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await expect(root).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
    };
    const button = action => root.getByRole('button', { name: action === 'toggle' ? t.bulk.pause : t.btn[action], exact: true });
    const start = async action => {
      if (action === 'delete') {
        await button('delete').click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: t.btn.delete, exact: true }).click();
      } else await button(action).click();
    };
    const fit = async label => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} page overflow ${locale}/${theme}/${width}`);
        const scope = await dialog.count() ? dialog : root;
        assert.ok(await scope.locator('button, a').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 43.9)), `${label}: 44px controls`);
        if (await dialog.count()) {
          const box = await dialog.boundingBox();
          assert.ok(box.x >= 15 && box.x + box.width <= width - 15 && box.y >= 15 && box.y + box.height <= 985, `${label}: modal gutters`);
          assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: modal content overflow`);
        }
        renders++;
        if (width === 320 && ['delete-confirm', 'delete-throw', 'test-success', 'toggle-refresh-error'].includes(label)) await page.screenshot({ path: join(output, `${label}-${locale}-${theme}-${width}.png`), fullPage: true });
      }
    };

    await open('success', 'viewer');
    await expect(root.getByRole('button')).toHaveCount(0);
    await expect(root.getByRole('link')).toHaveCount(1);
    await fit('viewer');

    await open();
    await button('delete').focus();
    await page.keyboard.press('Enter');
    await fit('delete-confirm');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button('delete')).toBeFocused();
    assert.equal((await state()).calls.length, 0);
    interactions++;

    for (const action of ['toggle', 'test', 'delete']) for (const outcome of ['success', 'failure', 'throw', 'malformed']) {
      await open(outcome);
      await start(action);
      const resultScope = action === 'delete' && outcome !== 'success' ? dialog : root;
      if (outcome === 'success') {
        await expect(resultScope.getByRole('status')).toContainText(action === 'toggle' ? t.notice.disabled : action === 'delete' ? t.notice.deleted : t.test.met);
        if (action === 'toggle') {
          await expect(root.getByRole('button', { name: t.bulk.resume, exact: true })).toBeEnabled();
          await root.getByRole('button', { name: t.bulk.resume, exact: true }).click();
          await expect(root.getByRole('status')).toHaveText(t.notice.enabled);
          const calls = (await state()).calls.map(JSON.parse);
          assert.deepEqual(calls.map(call => call.enabled), [false, true]);
          assert.equal((await state()).refreshes, 2);
        }
        if (action === 'delete') {
          await expect(dialog).toHaveCount(0);
          await expect(root.getByRole('button')).toHaveCount(0);
          await expect(root.locator('[tabindex="-1"]')).toBeFocused();
          await expect(root.getByRole('link', { name: t.detail.back })).toHaveAttribute('href', '/app/monitors');
          assert.equal((await state()).navigation, '/app/monitors');
        }
      } else {
        await expect(resultScope.getByRole('alert')).toHaveText(outcome === 'failure' ? (action === 'test' ? t.notice.testFailed : t.notice.requestFailed) : t.detailActions.unknown);
        await expect(page.getByText('Private fixture driver message')).toHaveCount(0);
        if (outcome !== 'failure') {
          await expect(resultScope.getByRole('link', { name: t.detailActions.reload })).toHaveAttribute('href', '/app/monitors/fixture-monitor-a');
          await expect(root.locator('button').first()).toBeDisabled();
          if (action === 'delete') await expect(dialog.getByRole('button', { name: t.btn.delete, exact: true })).toBeDisabled();
        }
      }
      assert.equal((await state()).calls.length, action === 'toggle' && outcome === 'success' ? 2 : 1);
      await fit(`${action}-${outcome}`);
      if (action === 'delete' && ['throw', 'malformed'].includes(outcome)) {
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(root.locator('[tabindex="-1"]')).toBeFocused();
        await expect(root.getByRole('alert')).toHaveText(t.detailActions.unknown);
      }
      interactions++;
    }

    for (const action of ['toggle', 'test', 'delete']) {
      await open('retry'); await start(action);
      const scope = action === 'delete' ? dialog : root;
      await expect(scope.getByRole('alert')).toBeVisible();
      await scope.getByRole('button', { name: action === 'toggle' ? t.bulk.pause : t.btn[action], exact: true }).click();
      await expect(root.getByRole('status')).toBeVisible();
      assert.equal((await state()).calls.length, 2);
      interactions++;

      await open('pending'); await start(action);
      await expect(root.locator('button').first()).toBeDisabled();
      if (action === 'delete') {
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: t.btn.cancel, exact: true })).toBeDisabled();
      }
      await scope.getByRole('button', { name: messages.appCommon.processing, exact: true }).evaluate(el => { el.click(); el.click(); });
      assert.equal((await state()).calls.length, 1);
      await fit(`${action}-pending`);
      await page.locator('[data-fixture-release]').evaluate(el => el.click());
      await expect(root.getByRole('status')).toBeVisible();
      assert.equal((await state()).calls.length, 1);
      interactions++;

      await open('pending'); await start(action);
      await page.locator('[data-fixture-switch]').evaluate(el => el.click());
      await expect(dialog).toHaveCount(0);
      await page.locator('[data-fixture-release]').click();
      await expect(button('toggle')).toBeEnabled();
      // Flush promise callbacks after releasing the old target's reply.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(root.getByRole('status')).toHaveCount(0);
      assert.equal((await state()).refreshes, 0);
      assert.equal((await state()).navigation, '');
      assert.equal(JSON.parse((await state()).calls[0]).target, 'fixture-monitor-a');
      interactions++;
    }
    await open('unmet'); await start('test');
    await expect(root.getByRole('status')).toContainText(t.test.unmet); interactions++;
    await open('refresh-error'); await start('toggle');
    await expect(root.getByRole('status').first()).toHaveText(t.notice.disabled);
    await expect(root.getByRole('status').last()).toHaveText(t.detailActions.refreshFailed);
    await expect(root.getByRole('link', { name: t.detailActions.reload })).toBeVisible();
    await fit('toggle-refresh-error'); interactions++;
    await open('navigation-error'); await start('delete');
    await expect(root.getByRole('status')).toHaveText(t.notice.deleted);
    await expect(root.getByRole('button')).toHaveCount(0);
    assert.equal((await state()).calls.length, 1); interactions++;
    assert.deepEqual(io, [], 'No API/action IO'); assert.deepEqual(errors, [], 'No runtime/i18n errors');
    await context.close();
    console.log(`PASS monitor detail ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, interactions, output }));
} finally { await browser.close(); }
