/** Owner KPI states with an in-memory transport; no real dry run, approval or extraction. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';

const baseURL = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = await mkdtemp(join(tmpdir(), 'supalens-kpi-review-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const msg = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
let renders = 0, interactions = 0;

async function fit(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const box = await dialog.boundingBox(), view = page.viewportSize();
    assert.ok(box.x >= 15 && box.x + box.width <= view.width - 15, 'Horizontal modal gutters');
    assert.ok(box.y >= 15 && box.y + box.height <= view.height - 15, 'Vertical modal gutters');
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = m.appKpis;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      context.setDefaultTimeout(12000);
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const writes = [], errors = [];
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== new URL(baseURL).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
        if (req.url().startsWith(baseURL) && url.pathname.startsWith('/api/')) {
          writes.push(`${req.method()} ${url.pathname}`);
          return route.fulfill({ status: 503, json: { error: 'Fixture transport must not call the API.' } });
        }
        if (!['GET', 'HEAD'].includes(req.method())) {
          if (req.url().startsWith(baseURL)) writes.push(`${req.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', event => { if (/MISSING_MESSAGE|INVALID_MESSAGE|requires a.*Title|Missing.*Description/.test(event.text())) errors.push(event.text()); });
      let scope = page.getByRole('main');
      async function open(mode, modal = false) {
        assert.equal((await page.goto(`${baseURL}/dev/kpis?owner=1&mode=${mode}${modal ? '&variant=modal' : ''}`)).status(), 200);
        scope = modal ? page.getByRole('dialog') : page.getByRole('main');
        await expect(scope).toBeVisible();
      }
      async function matrix(name) {
        await page.evaluate(() => document.fonts.ready);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await fit(page); renders++;
        }
        if (locale === 'en') await page.screenshot({ path: join(output, `${name}-${theme}-mobile.png`), fullPage: true });
        console.log(`PASS ${name}/${locale}/${theme}`);
      }
      const approvedPreview = () => scope.getByRole('region', { name: t.preview.title });
      const planReady = () => expect(approvedPreview().getByText(t.preview.ready, { exact: true })).toBeVisible();
      const resolve = () => scope.getByRole('button', { name: 'Resolve sample request', exact: true }).click();
      const rowCheck = title => scope.getByRole('checkbox', { name: msg(t.selectAria, { title }), exact: true });
      const exclude = title => scope.getByRole('button', { name: msg(t.excludeAria, { title }), exact: true });
      const result = () => scope.getByRole('region', { name: t.result.title });

      if (process.argv.includes('--reextract')) {
        for (const modal of [false, true]) {
          for (const mode of ['extract-accepted', 'extract-running', 'extract-conflict', 'extract-malformed', 'extract-throw', 'extract-retry']) {
            await open(mode, modal); await planReady();
            const reextract = () => scope.getByRole('button', { name: t.reExtract, exact: true });
            await reextract().evaluate(el => { el.click(); el.click(); });
            await expect(reextract()).toBeDisabled();
            await expect(rowCheck('Paid without access')).toBeDisabled();
            assert.equal((await scope.locator('[data-fixture-calls]').getAttribute('data-fixture-calls')).split('|').filter(value => value.startsWith('extract:')).length, 1);
            if (modal) { await page.keyboard.press('Escape'); await expect(scope).toBeVisible(); }
            await resolve();
            if (['extract-accepted', 'extract-running'].includes(mode)) {
              await expect(scope.getByRole('button', { name: t.extractingShort, exact: true })).toBeDisabled();
              await expect(scope.getByRole('alert')).toHaveCount(0);
            } else {
              await expect(scope.getByRole('alert')).toBeVisible();
              if (['extract-malformed', 'extract-throw'].includes(mode)) {
                await expect(scope.getByRole('alert')).toContainText(m.appSources.kpi.modal.unconfirmedBody);
                const recovery = scope.getByRole('link', { name: m.appSources.kpi.modal.reload, exact: true });
                await expect(recovery).toHaveAttribute('href', '/app/sources');
                assert.ok((await recovery.boundingBox()).height >= 44);
                await expect(reextract()).toBeDisabled();
              } else {
                await expect(scope.getByRole('alert')).toContainText(msg(t.extractStartFailed, { status: 409 }));
                await expect(reextract()).toBeEnabled();
              }
              await expect(scope.getByRole('button', { name: t.extractingShort, exact: true })).toHaveCount(0);
            }
            await expect(rowCheck('Paid without access')).toBeChecked();
            await matrix(`${mode}-${modal ? 'modal' : 'page'}`);
            if (mode === 'extract-retry') {
              await reextract().click(); await resolve();
              await expect(scope.getByRole('button', { name: t.extractingShort, exact: true })).toBeDisabled();
              assert.equal((await scope.locator('[data-fixture-calls]').getAttribute('data-fixture-calls')).split('|').length, 2);
            }
            interactions++;
          }
          await open('extract-accepted', modal); await planReady();
          await scope.getByRole('button', { name: t.reExtract, exact: true }).click();
          await scope.locator('[data-fixture-switch]').click();
          await resolve();
          await expect(scope.getByRole('button', { name: t.reExtract, exact: true })).toBeEnabled();
          await expect(scope.locator('[data-fixture-refresh]')).toHaveAttribute('data-fixture-refresh', '0');
          await expect(scope.getByRole('alert')).toHaveCount(0);
          interactions++;
        }
        assert.deepEqual(writes, []); assert.deepEqual(errors, []);
        await context.close(); console.log(`PASS re-extraction ${locale}/${theme}`); continue;
      }

      for (const modal of [false, true]) {
        for (const mode of ['review', 'cap', 'preview-error', 'pending', 'empty']) {
          await open(mode, modal);
          if (['review', 'cap'].includes(mode)) await planReady();
          if (mode === 'preview-error') await expect(approvedPreview().getByText(t.preview.error, { exact: true })).toBeVisible();
          if (mode === 'pending') await expect(approvedPreview().getByText(t.preview.loading, { exact: true })).toBeVisible();
          if (['preview-error', 'pending'].includes(mode)) {
            await expect(approvedPreview().getByText(t.preview.cadenceUnknown, { exact: true })).toBeVisible();
            await expect(approvedPreview().getByText(msg(t.cadenceNote, { cadence: msg(t.cadence.minutes, { n: 5 }) }), { exact: true })).toHaveCount(0);
          }
          await matrix(`${mode}-${modal ? 'modal' : 'page'}`);
        }
        // All inputs, including modal dismissal, stay stable during approval.
        for (const mode of ['review', 'partial', 'cap', 'apply-error']) {
          await open(mode, modal); await planReady();
          await approvedPreview().locator('summary').click();
          await scope.getByRole('radio', { name: t.picker.existing, exact: true }).check();
          await planReady();
          const count = mode === 'cap' ? 1 : 2;
          await scope.getByRole('button', { name: msg(t.approveCta, { count }), exact: true }).click();
          await expect(scope.getByRole('button', { name: t.applying, exact: true })).toBeDisabled();
          for (const control of await scope.getByRole('checkbox').all()) await expect(control).toBeDisabled();
          for (const control of await scope.getByRole('radio').all()) await expect(control).toBeDisabled();
          await expect(scope.getByRole('button', { name: t.alertsAriaOff, exact: true })).toBeDisabled();
          if (modal) {
            await expect(scope.getByRole('button', { name: m.appCommon.close, exact: true })).toBeDisabled();
            await page.keyboard.press('Escape'); await expect(scope).toBeVisible();
          }
          await resolve();
          if (mode === 'apply-error') {
            await expect(scope.getByRole('alert')).toContainText('Sample approval failed');
            await expect(rowCheck('Paid without access')).toBeChecked();
            await expect(scope.getByRole('radio', { name: t.picker.existing, exact: true })).toBeChecked();
            await expect(rowCheck('Paid without access')).toBeEnabled();
          } else {
            await expect(result()).toBeVisible();
            await expect(result()).toHaveAttribute('data-outcome', mode === 'review' ? 'success' : 'partial');
            await expect(result()).toContainText(t.result.scheduleNote);
            await expect(rowCheck('Paid without access')).toBeDisabled();
            if (mode === 'review') await expect(result()).toContainText(msg(t.result.baseline, { count: 1, need: 8 }));
          }
          await matrix(`${mode}-result-${modal ? 'modal' : 'page'}`);
          interactions++;
        }
      }

      for (const mode of ['loading', 'load-error']) {
        await open(mode, true);
        await expect(scope.getByRole(mode === 'loading' ? 'status' : 'alert')).toContainText(mode === 'loading' ? t.loading : t.loadFailed);
        await matrix(`modal-${mode}`);
      }

      // A stale response must not relabel a newer selection as server-confirmed.
      await open('pending');
      await expect.poll(() => scope.locator('[data-fixture-pending]').getAttribute('data-fixture-pending')).toContain('preview:');
      await rowCheck('Paid without access').uncheck();
      await expect.poll(async () => (await scope.locator('[data-fixture-pending]').getAttribute('data-fixture-pending')).split('|').length).toBe(2);
      await resolve();
      await expect(approvedPreview().getByText(t.preview.loading, { exact: true })).toBeVisible();
      await expect(approvedPreview().getByText(msg(t.summary.monitors, { count: 1 }), { exact: true })).toBeVisible();
      await resolve(); await planReady();
      await scope.getByRole('button', { name: t.alertsAriaOff, exact: true }).click();
      await expect(approvedPreview().getByText(t.preview.cadenceUnknown, { exact: true })).toBeVisible();
      await expect(approvedPreview().getByText(msg(t.summary.monitors, { count: 0 }), { exact: true })).toBeVisible();
      await expect.poll(() => scope.locator('[data-fixture-pending]').getAttribute('data-fixture-pending')).toContain('preview:');
      await resolve(); await planReady();
      interactions++;

      await open('preview-error');
      await scope.getByRole('button', { name: t.preview.retry, exact: true }).click();
      await planReady(); interactions++;

      for (const mode of ['patch-error', 'undo-error']) {
        await open(mode); await planReady();
        await exclude('Paid without access').click();
        await expect(rowCheck('Paid without access')).toHaveCount(0);
        await expect(scope.getByRole('button', { name: t.undo, exact: true })).toBeDisabled();
        await resolve();
        if (mode === 'patch-error') {
          await expect(scope.getByRole('alert')).toHaveText(t.proposalSaveFailed);
          await expect(rowCheck('Paid without access')).toBeChecked();
          await expect(scope.getByRole('button', { name: t.undo, exact: true })).toHaveCount(0);
        } else {
          await scope.getByRole('button', { name: t.undo, exact: true }).click();
          await expect(rowCheck('Paid without access')).toBeVisible();
          await resolve();
          await expect(scope.getByRole('alert')).toHaveText(t.proposalSaveFailed);
          await expect(rowCheck('Paid without access')).toHaveCount(0);
          await expect(scope.getByRole('button', { name: t.undo, exact: true })).toBeEnabled();
        }
        await matrix(mode); interactions++;
      }

      await open('review'); await planReady();
      await scope.getByRole('button', { name: t.reExtract, exact: true }).click();
      await expect(rowCheck('Paid without access')).toBeDisabled();
      await resolve();
      await expect(scope.getByRole('alert')).toContainText(t.quotaReached);
      await expect(scope.getByRole('alert')).toHaveAttribute('data-kind', 'quota');
      await matrix('extraction-quota'); interactions++;

      await open('review', true); await planReady();
      await approvedPreview().locator('summary').click();
      await scope.getByRole('radio', { name: t.picker.existing, exact: true }).check();
      const picker = scope.getByRole('button', { name: t.picker.existing, exact: true });
      await picker.click(); await page.keyboard.press('Escape');
      await expect(scope).toBeVisible(); await expect(picker).toBeFocused();
      for (const key of [...Array(24).fill('Tab'), ...Array(24).fill('Shift+Tab')]) {
        await page.keyboard.press(key);
        assert.ok(await scope.evaluate(el => el.contains(document.activeElement)));
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Open review preview', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open review preview', exact: true })).toBeFocused();
      interactions++;

      assert.deepEqual(writes, [], 'No network API or server action was called');
      assert.deepEqual(errors, [], 'No runtime, localization or modal labeling errors');
      await context.close();
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
