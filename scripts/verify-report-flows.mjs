import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-report-flows-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const messages = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = messages.appDashboards, common = messages.appCommon, chrome = messages.appChrome;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], requests = [];
      await guardDesignFixture(context, base, requests);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(message.text())) errors.push(message.text()); });
      page.on('dialog', dialog => { errors.push('Native dialog'); void dialog.dismiss(); });
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} document overflow`);
          const dialog = page.getByRole('dialog');
          if (await dialog.count()) {
            const box = await dialog.boundingBox();
            assert.ok(box.x >= 15 && box.x + box.width <= width - 15, `${label} modal gutters`);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label} modal overflow`);
          }
          renders++;
          if (locale === 'en' && width === 320) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      }
      async function visit(view, mode) {
        const response = await page.goto(`${base}/dev/operations?view=${view}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200); await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('[data-flow-ready]')).toHaveAttribute('data-flow-ready', 'true');
      }
      for (const mode of ['success', 'empty', 'failure', 'throw', 'load-error', 'partial', 'create-failure', 'unconfigured', 'add-throw', 'create-throw']) {
        await visit('save', mode); await fit(`save-${mode}`);
        const trigger = page.getByRole('button', { name: t.saveToReport, exact: true });
        await trigger.click(); let dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeEnabled();
        await assertControlTargets(page, '[aria-label="Sample answer"] button, [role="dialog"] button');
        await fit(`picker-${mode}`); interactions++;
        if (['throw', 'load-error'].includes(mode)) {
          await expect(dialog.getByRole('alert')).toHaveText(t.add.loadFailed);
          await dialog.getByRole('button', { name: common.close, exact: true }).first().click(); await expect(trigger).toBeFocused();
          await page.getByRole('button', { name: 'Restore sample actions' }).click();
          await trigger.click(); await expect(dialog.getByRole('button', { name: 'Business health', exact: true })).toBeEnabled();
          await dialog.getByRole('button', { name: 'Business health', exact: true }).click();
          await expect(dialog.getByRole('link', { name: t.index.open, exact: true })).toHaveAttribute('href', '/app/dashboards/fixture-core'); interactions++;
          continue;
        }
        const create = ['empty', 'partial', 'create-failure', 'create-throw'].includes(mode);
        await dialog.getByRole('button', { name: create ? t.add.toNew : 'Business health', exact: true }).click();
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeEnabled();
        if (['failure', 'partial', 'create-failure', 'unconfigured', 'add-throw', 'create-throw'].includes(mode)) {
          await expect(dialog.getByRole('alert')).toBeVisible(); await fit(`save-error-${mode}`);
          if (mode === 'partial') {
            await expect(dialog.getByText(t.add.createdPending.replace('{name}', t.newDashboardName), { exact: false })).toBeVisible();
            await dialog.getByRole('button', { name: t.add.retryCreated, exact: true }).click();
            await expect(dialog.getByRole('link', { name: t.index.open, exact: true })).toHaveAttribute('href', '/app/dashboards/fixture-created-1');
            const calls = await page.locator('[data-flow-calls]').textContent();
            assert.equal(calls.split('\n').filter(x => x.startsWith('create:')).length, 1);
            assert.equal(calls.split('\n').filter(x => x === 'add:fixture-created-1:source=fixture-source').length, 2);
          }
          if (['add-throw', 'create-throw'].includes(mode)) {
            const before = await page.locator('[data-flow-calls]').textContent();
            await expect(dialog.getByRole('link', { name: t.add.reviewReports })).toHaveAttribute('href', mode === 'create-throw' ? '/app/dashboards' : '/app/dashboards/fixture-core');
            await expect(dialog.getByRole('button', { name: t.add.toNew, exact: true })).toHaveCount(0);
            await dialog.getByRole('button', { name: common.close, exact: true }).first().click();
            await page.getByRole('button', { name: 'Restore sample actions' }).click();
            await trigger.click();
            await expect(dialog.getByRole('alert')).toBeVisible();
            await expect(page.locator('[data-flow-calls]')).toHaveText(before);
            await expect(dialog.getByRole('button', { name: 'Business health', exact: true })).toHaveCount(0);
            interactions++;
          }
        } else {
          await expect(dialog.getByRole('status')).toContainText(create ? t.newDashboardName : 'Business health');
          await expect(dialog.getByRole('link', { name: t.index.open, exact: true })).toHaveAttribute('href', create ? '/app/dashboards/fixture-created-1' : '/app/dashboards/fixture-core');
          await fit(`saved-${mode}`);
        }
        await dialog.getByRole('button', { name: common.close, exact: true }).first().click(); await expect(trigger).toBeFocused(); interactions++;
      }
      for (const shape of ['list-malformed', 'create-malformed', 'add-malformed']) {
        await visit('save', 'success');
        await page.locator('[data-save-response]').selectOption(shape);
        const trigger = page.getByRole('button', { name: t.saveToReport, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeEnabled();
        if (shape === 'list-malformed') {
          await expect(dialog.getByRole('alert')).toHaveText(t.add.loadFailed);
          await expect(dialog.getByRole('button', { name: t.add.toNew, exact: true })).toHaveCount(0);
          await dialog.getByRole('button', { name: common.close, exact: true }).first().click();
          await page.locator('[data-save-response]').selectOption('normal');
          await trigger.click();
          await expect(dialog.getByRole('button', { name: 'Business health', exact: true })).toBeEnabled();
        } else {
          await dialog.getByRole('button', { name: shape === 'create-malformed' ? t.add.toNew : 'Business health', exact: true }).click();
          await expect(dialog.getByRole('alert')).toHaveText(shape === 'create-malformed' ? t.add.createUnconfirmed : t.add.saveUnconfirmed);
          await expect(dialog.getByRole('link', { name: t.add.reviewReports })).toHaveAttribute('href', shape === 'create-malformed' ? '/app/dashboards' : '/app/dashboards/fixture-core');
          const calls = await page.locator('[data-flow-calls]').textContent();
          if (shape === 'create-malformed') assert.equal(calls.split('\n').filter(x => x.startsWith('add:')).length, 0);
        }
        await fit(`save-${shape}`); interactions++;
      }
      // Dispatching synthetic repeat submissions tests the synchronous lock.
      await visit('save', 'success');
      await page.getByRole('button', { name: t.saveToReport, exact: true }).click();
      let picker = page.getByRole('dialog');
      const newReport = picker.getByRole('button', { name: t.add.toNew, exact: true });
      await expect(newReport).toBeEnabled();
      await newReport.evaluate(button => { button.click(); button.click(); button.click(); });
      await expect(picker.getByRole('link', { name: t.index.open, exact: true })).toHaveAttribute('href', '/app/dashboards/fixture-created-1');
      let calls = await page.locator('[data-flow-calls]').textContent();
      assert.equal(calls.split('\n').filter(x => x.startsWith('create:')).length, 1);
      assert.equal(calls.split('\n').filter(x => x.startsWith('add:')).length, 1); interactions++;

      for (const action of ['Switch sample source', 'Replace sample visualization']) {
        await visit('save', 'success');
        await page.getByRole('button', { name: t.saveToReport, exact: true }).click();
        picker = page.getByRole('dialog');
        await picker.getByRole('button', { name: t.add.toNew, exact: true }).click();
        // A parent can replace the answer while the modal is busy; this is not a user click through the modal.
        await page.getByText(action, { exact: true }).evaluate(button => button.click());
        await expect(picker).toHaveCount(0);
        await page.getByRole('button', { name: t.saveToReport, exact: true }).click();
        picker = page.getByRole('dialog');
        await expect(picker.getByRole('button', { name: 'Business health', exact: true })).toBeEnabled();
        calls = await page.locator('[data-flow-calls]').textContent();
        assert.equal(calls.split('\n').filter(x => x.startsWith('add:')).length, 0, 'Old creation must not save into a replaced answer');
        await picker.getByRole('button', { name: 'Business health', exact: true }).click();
        await expect(picker.getByRole('link', { name: t.index.open, exact: true })).toHaveAttribute('href', '/app/dashboards/fixture-core');
        calls = await page.locator('[data-flow-calls]').textContent();
        assert.ok(calls.includes(`add:fixture-core:source=${action === 'Switch sample source' ? 'fixture-source-next' : 'fixture-source'}`));
        await fit(`save-${action.replaceAll(' ', '-')}`); interactions++;
      }
      // Thrown/unknown list responses are covered independently per operation in
      // verify-report-management: an uncertain pin intentionally pauses further writes.
      for (const mode of ['success', 'failure', 'empty']) {
        await visit('report-actions', mode); await fit(`reports-${mode}`);
        const create = page.getByRole('button', { name: t.index.newReport, exact: true });
        if (mode !== 'empty') {
          const pin = page.getByRole('button', { name: `${chrome.dashboard.pinRemove}: Business health`, exact: true });
          await pin.click(); await expect(create).toBeDisabled(); await expect(create).toBeEnabled();
          await expect(page.getByRole('button', { name: `${mode === 'success' ? chrome.dashboard.pinAdd : chrome.dashboard.pinRemove}: Business health`, exact: true })).toHaveAttribute('aria-pressed', mode === 'success' ? 'false' : 'true'); interactions++;
          const rename = page.getByRole('button', { name: `${t.management.rename}: Business health`, exact: true });
          await rename.click(); let dialog = page.getByRole('dialog'); const field = dialog.getByRole('textbox');
          await expect(field).toBeFocused(); await field.fill('  '); await expect(dialog.getByRole('button', { name: t.management.save })).toBeDisabled();
          await field.fill('Updated sample report'); await field.press('Enter'); await expect(field).toBeDisabled();
          if (mode === 'success') { await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: `${t.management.rename}: Updated sample report`, exact: true })).toBeFocused(); }
          else { await expect(dialog.getByRole('alert')).toBeVisible(); await expect(field).toHaveValue('Updated sample report'); await fit(`rename-error-${mode}`); await page.keyboard.press('Escape'); await expect(rename).toBeFocused(); }
          interactions++;
          const name = mode === 'success' ? 'Updated sample report' : 'Business health';
          const remove = page.getByRole('button', { name: `${t.management.delete}: ${name}`, exact: true });
          await remove.click(); dialog = page.getByRole('dialog');
          await dialog.getByRole('button', { name: t.management.delete, exact: true }).click();
          await expect(dialog.getByRole('button', { name: common.close, exact: true }).first()).toBeDisabled();
          await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
          if (mode === 'success') { await expect(dialog).toHaveCount(0); await expect(remove).toHaveCount(0); await expect(create).toBeFocused(); }
          else { await expect(dialog.getByRole('alert')).toBeVisible(); await fit(`delete-error-${mode}`); await page.keyboard.press('Escape'); await expect(remove).toBeFocused(); }
          await expect(page.locator('[data-flow-navigation]')).toHaveText('No navigation'); interactions++;
        }
        await create.click(); const dialog = page.getByRole('dialog'); const field = dialog.getByRole('textbox');
        await expect(field).toBeFocused(); await field.fill('New operating report'); await field.press('Enter');
        await expect(field).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        if (['success', 'empty'].includes(mode)) { await expect(dialog).toHaveCount(0); await expect(page.locator('[data-flow-navigation]')).toHaveText('/app/dashboards/fixture-created-1'); }
        else { await expect(dialog.getByRole('alert')).toBeVisible(); await expect(field).toHaveValue('New operating report'); await expect(page.locator('[data-flow-navigation]')).toHaveText('No navigation'); await fit(`create-error-${mode}`); }
        interactions++;
      }
      assert.deepEqual(errors, []); assert.deepEqual(requests, []);
      await context.close(); console.log(`PASS report flows ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
