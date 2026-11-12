/** Actual wizard flow. Fixture IO is local, and browser blocks any real action/API request. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-wizard-extraction-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) for (const theme of ['light', 'dark']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const w = messages.appWizard, t = w.act4;
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
    await context.addInitScript(value => {
      localStorage.setItem('theme', value);
      localStorage.removeItem('supalens.wizard.dismissed.design-fixture');
    }, theme);
    const requests = [], errors = [];
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === new URL(base).origin && (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method()))) {
        requests.push(`${req.method()} ${url.pathname}`); return route.abort();
      }
      if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|requires a.*Title|Missing.*Description/.test(message.text())) errors.push(message.text()); });
    const dialog = page.getByRole('dialog');
    const state = async () => JSON.parse(await page.locator('[data-fixture-state]').textContent());
    const start = () => dialog.getByRole('button', { name: t.startExtract, exact: true });
    const open = async outcome => {
      const response = await page.goto(`${base}/dev/wizard?view=extract-actions&state=${outcome}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: w.act3.later, exact: true }).click();
      await expect(start()).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
    };
    const fit = async label => {
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        if (await dialog.count()) {
          const box = await dialog.boundingBox();
          assert.ok(box.x >= 15 && box.x + box.width <= width - 15 && box.y >= 15 && box.y + box.height <= 885, `${label}: modal gutters`);
          assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: content wraps`);
          assert.ok(await dialog.locator('button,a').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 43.9)), `${label}: 44px targets`);
        }
        renders++;
        if (width === 320 && ['initial', 'quota', 'running', 'throw', 'pending'].includes(label)) await page.screenshot({ path: join(output, `${label}-${locale}-${theme}.png`), fullPage: true });
      }
    };
    await open('success'); await fit('initial');
    for (const [outcome, expected] of [
      ['success', 'accepted'], ['running', 'running'], ['quota', 'quota'], ['rejected', 'rejected'],
      ['conflict', 'rejected'], ['unavailable', 'rejected'], ['unknown-server', 'unknown'],
      ['throw', 'unknown'], ['malformed', 'unknown'], ['complete-throw', 'accepted'],
    ]) {
      await open(outcome); await start().click();
      if (expected === 'accepted') {
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await state()).completions).toBe(1);
        await expect.poll(async () => (await state()).refreshes).toBe(outcome === 'complete-throw' ? 0 : 1);
        assert.equal((await state()).navigation, '');
      } else {
        await expect(dialog.locator(`[data-outcome="${expected}"]`)).toHaveText(t.outcome[expected]);
        await expect(dialog.getByRole('link', { name: t.reviewSources })).toHaveAttribute('href', '/app/sources');
        await expect(page.getByText('Private fixture driver detail')).toHaveCount(0);
        assert.equal((await state()).completions, 0);
        assert.equal((await state()).refreshes, 0);
        if (['unknown', 'running'].includes(expected)) await expect(start()).toBeDisabled();
        else await expect(start()).toBeEnabled();
      }
      assert.deepEqual((await state()).calls, ['dev-fixture']);
      await fit(outcome);
      if (expected !== 'accepted') {
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
        assert.equal((await state()).completions, 0, 'Dismissal is not durable completion');
      }
      interactions++;
    }
    await open('retry'); await start().click();
    await expect(dialog.getByRole('alert')).toHaveText(t.outcome.rejected);
    await start().click(); await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await state()).completions).toBe(1);
    assert.deepEqual((await state()).calls, ['dev-fixture', 'dev-fixture']); interactions++;

    await open('pending');
    await start().evaluate(el => { el.click(); el.click(); });
    await expect(dialog.getByRole('button', { name: t.starting, exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: t.skip, exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: w.close, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    assert.deepEqual((await state()).calls, ['dev-fixture']);
    await fit('pending');
    await page.locator('[data-fixture-release]').evaluate(el => el.click());
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await state()).completions).toBe(1); interactions++;

    await open('pending'); await start().click();
    await page.locator('[data-fixture-switch]').evaluate(el => el.click());
    await expect(dialog.getByRole('heading', { name: /Replacement sample source/ })).toBeVisible();
    await page.locator('[data-fixture-release]').evaluate(el => el.click());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(start()).toBeEnabled();
    assert.equal((await state()).completions, 0);
    assert.equal((await state()).refreshes, 0);
    await expect(dialog.getByRole('alert')).toHaveCount(0); interactions++;
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS wizard extraction ${locale}/${theme}`);
  }
  console.log(JSON.stringify({ renders, interactions, output }));
} finally { await browser.close(); }
