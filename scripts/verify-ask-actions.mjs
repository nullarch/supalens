import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3107';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const fixturePage = await readFile(new URL('../src/app/dev/analysis/page.tsx', import.meta.url), 'utf8');
const modes = JSON.parse(fixturePage.match(/const RUN_ACTION_MODES = (\[[^\]]+\])/)[1].replaceAll("'", '"'));
const output = await mkdtemp(join(tmpdir(), 'supalens-ask-actions-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const share = m.appAsk.share, stop = m.appAsk.cancel, common = m.appCommon;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], requests = [];
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === new URL(base).origin && (!['GET', 'HEAD'].includes(request.method()) || url.pathname.startsWith('/api/'))) { requests.push(url.href); return route.abort(); }
        if (url.origin !== new URL(base).origin && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          const dialog = page.getByRole('dialog');
          if (await dialog.count()) {
            const box = await dialog.boundingBox(); assert.ok(box.x >= 15 && box.x + box.width <= width - 15, `${label}: modal gutters`);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: modal overflow`);
            for (const button of await dialog.getByRole('button').all()) {
              const target = await button.boundingBox(); assert(target.width >= 43 && target.height >= 43, `${label}: 44px modal target`);
            }
          }
          renders++;
          if (locale === 'en' && width === 320) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      }
      const count = async name => (await page.locator('[data-action-calls]').innerText()).split('\n').filter(value => value === name).length;
      for (const mode of modes) {
        assert.equal((await page.goto(`${base}/dev/analysis?view=actions&mode=${mode}`)).status(), 200);
        await page.locator('[data-run-actions-ready="true"]').waitFor();
        await page.evaluate(() => document.fonts.ready); await fit(`initial-${mode}`);
        const stopRegion = page.locator('[data-run-stop]');
        await stopRegion.getByRole('button', { name: stop.stop, exact: true }).click();
        await expect(stopRegion.getByRole('button')).toBeDisabled();
        if (mode === 'failure') { await expect(stopRegion.getByRole('alert')).toContainText(stop.failed); await expect(stopRegion.getByRole('button')).toBeEnabled(); }
        else if (['throw', 'malformed', 'stop-status', 'stop-http', 'stop-json'].includes(mode)) {
          await expect(stopRegion.getByRole('alert')).toContainText(stop.unknown);
          await expect(stopRegion.getByRole('alert')).toBeFocused();
          await expect(stopRegion.getByRole('button')).toBeDisabled();
          await stopRegion.getByRole('button').dispatchEvent('click'); assert.equal(await count('cancel:sample-run'), 1);
          await expect(stopRegion.getByRole('link')).toHaveAttribute('href', '/app/ask/history/sample-run');
        }
        else { await expect(stopRegion.getByRole('status')).toContainText(mode === 'terminal' ? stop.terminal : stop.requested); await expect(stopRegion.getByRole('link')).toHaveAttribute('href', '/app/ask/history/sample-run'); }
        await fit(`stop-${mode}`); interactions++;
        const trigger = page.getByRole('button', { name: share.manage, exact: true });
        const before = await page.locator('[data-action-calls]').textContent();
        await trigger.click(); let dialog = page.getByRole('dialog');
        await expect(dialog.getByText(share.publicNotice, { exact: true })).toBeVisible();
        await expect(page.locator('[data-action-calls]')).toHaveText(before);
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await trigger.click();
        await fit(`consent-${mode}`);
        await dialog.getByRole('button', { name: share.create, exact: true }).click();
        await dialog.getByRole('button', { name: share.create, exact: true }).dispatchEvent('click');
        assert.equal(await count('share:sample-run'), 1);
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        if (['failure', 'throw', 'share-malformed', 'share-truthy', 'share-url'].includes(mode)) {
          const unknown = mode !== 'failure';
          await expect(dialog.getByRole('alert')).toHaveText(unknown ? share.createUnknown : share.createFailed); await fit(`create-error-${mode}`);
          await expect(dialog.getByRole('textbox')).toHaveCount(0);
          if (unknown) {
            await expect(dialog.getByRole('alert')).toBeFocused();
            await expect(dialog.getByRole('button', { name: share.create, exact: true })).toBeDisabled();
            await dialog.getByRole('button', { name: share.create, exact: true }).dispatchEvent('click'); assert.equal(await count('share:sample-run'), 1);
            await expect(dialog.getByText(share.uncertainHint, { exact: true })).toBeVisible();
            assert.equal(await count('track:answer_shared'), 0);
          }
          await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
          await page.getByRole('button', { name: 'Restore sample actions' }).click(); await trigger.click();
          if (unknown) {
            await expect(dialog.getByRole('button', { name: share.create, exact: true })).toBeDisabled();
            await dialog.getByRole('button', { name: share.retryUnshare, exact: true }).click();
            await expect(dialog.getByRole('status')).toHaveText(share.revoked);
          }
          await dialog.getByRole('button', { name: share.create, exact: true }).click();
        }
        const url = dialog.getByRole('textbox', { name: share.urlLabel, exact: true });
        await expect(url).toBeVisible(); await expect(url).toHaveAttribute('readonly', '');
        await expect(dialog.getByText(share.copied, { exact: true })).toHaveCount(0);
        await expect(url).toHaveValue(new RegExp('https://example.invalid/share/'));
        // React preserves this button when its action changes from create to copy.
        await expect(dialog.getByRole('button', { name: share.copy, exact: true })).toBeFocused();
        assert.equal(await count('track:answer_shared'), 1);
        await fit(`created-${mode}`); interactions++;
        await dialog.getByRole('button', { name: share.copy, exact: true }).click();
        if (mode === 'copy-failure') { await expect(dialog.getByRole('alert')).toHaveText(share.copyFailed); await expect(url).toBeVisible(); await expect(dialog.getByText(share.copied, { exact: true })).toHaveCount(0); await fit('copy-error'); }
        else await expect(dialog.getByRole('status')).toHaveText(share.copied);
        interactions++;
        await dialog.getByRole('button', { name: share.unshare, exact: true }).click();
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeDisabled();
        if (['revoke-failure', 'revoke-throw', 'revoke-malformed', 'revoke-truthy'].includes(mode)) {
          const unknown = mode !== 'revoke-failure';
          await expect(dialog.getByRole('alert')).toHaveText(unknown ? share.revokeUnknown : share.revokeFailed);
          if (unknown) {
            await expect(url).toHaveCount(0); await expect(dialog.getByRole('button', { name: share.copy, exact: true })).toHaveCount(0);
            await expect(dialog.getByRole('button', { name: share.create, exact: true })).toBeDisabled();
          } else await expect(url).toBeVisible();
          await fit(`revoke-error-${mode}`);
          await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Restore sample actions' }).click(); await trigger.click();
          await dialog.getByRole('button', { name: unknown ? share.retryUnshare : share.unshare, exact: true }).click();
        }
        await expect(dialog.getByRole('status')).toHaveText(share.revoked); await expect(url).toHaveCount(0);
        await fit(`revoked-${mode}`); interactions++;
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
        if (mode === 'failure') {
          await stopRegion.getByRole('button').click(); await expect(stopRegion.getByRole('status')).toContainText(stop.requested);
          assert.equal(await count('cancel:sample-run'), 2); interactions++;
        }
        await page.getByRole('button', { name: 'Switch sample run' }).click();
        await expect(stopRegion.getByRole('button', { name: stop.stop, exact: true })).toBeEnabled();
        await expect(stopRegion.getByRole('status')).toHaveCount(0); interactions++;
        console.log(`PASS ${locale}/${theme}/${mode}`);
      }
      // Prop replacement can occur through navigation while a modal is pending.
      // Dispatch below simulates that parent update; it is not a claim that an inert
      // background button is physically clickable while a modal is open.
      for (const action of ['share', 'copy', 'revoke', 'cancel']) {
        await page.goto(`${base}/dev/analysis?view=actions&mode=slow`);
        await page.locator('[data-run-actions-ready="true"]').waitFor();
        const trigger = page.getByRole('button', { name: share.manage, exact: true });
        if (action === 'cancel') await page.locator('[data-run-stop]').getByRole('button').click();
        else {
          await trigger.click(); const dialog = page.getByRole('dialog');
          await dialog.getByRole('button', { name: share.create, exact: true }).click();
          if (action !== 'share') {
            await expect(dialog.getByRole('textbox', { name: share.urlLabel, exact: true })).toBeVisible();
            await dialog.getByRole('button', { name: action === 'copy' ? share.copy : share.unshare, exact: true }).click();
          }
        }
        await page.getByRole('button', { name: 'Switch sample run', includeHidden: true }).dispatchEvent('click');
        await page.waitForTimeout(1900);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('[data-run-stop]').getByRole('button')).toBeEnabled();
        await expect(page.locator('[data-run-stop]').getByRole('status')).toHaveCount(0);
        await trigger.click();
        await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
        await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
        if (action === 'share') assert.equal(await count('track:answer_shared'), 0);
        interactions++;
      }
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      await context.close(); console.log(`PASS Ask actions ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
