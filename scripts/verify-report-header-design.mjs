/** Real report header, entirely local server-action adapters. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-report-header-'));
const browser = await chromium.launch({ headless: true });
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = m.appDashboards.management, common = m.appCommon;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], mutations = [];
      await guardDesignFixture(context, base, mutations);
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(m.text())) errors.push(m.text()); });
      page.on('dialog', dialog => { errors.push(`Unexpected native dialog ${dialog.type()}`); void dialog.dismiss(); });
      const fit = async label => {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document overflow`);
          const dialog = page.getByRole('dialog');
          if (await dialog.count()) {
            const box = await dialog.boundingBox();
            assert.ok(box.x >= 15 && box.x + box.width <= width - 15 && box.y >= 15 && box.y + box.height <= 985, `${label}: modal fit`);
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: modal inner overflow`);
          }
          renders++;
          if (locale === 'en' && [1440, 320].includes(width)) await page.screenshot({ path: join(output, `${label}-${theme}-${width}.png`), fullPage: true });
        }
      };
      for (const mode of ['success', 'failure']) {
        const res = await page.goto(`${base}/dev/operations?view=header&mode=${mode}`, { waitUntil: 'domcontentloaded' });
        assert.equal(res.status(), 200); await page.evaluate(() => document.fonts.ready); await fit(`header-${mode}`);
        await expect(page.locator('[data-header-ready]')).toHaveAttribute('data-header-ready', 'true');
        const rename = page.getByRole('button', { name: t.rename, exact: true });
        const remove = page.getByRole('button', { name: t.delete, exact: true });
        const pin = page.getByRole('button', { name: m.appChrome.dashboard.pinAdd, exact: true });
        await pin.click(); await expect(pin).toBeDisabled();
        await expect(rename).toBeEnabled();
        await expect(page.getByRole('button', { name: mode === 'success' ? m.appChrome.dashboard.pinRemove : m.appChrome.dashboard.pinAdd, exact: true })).toHaveAttribute('aria-pressed', mode === 'success' ? 'true' : 'false');
        if (mode !== 'success') await expect(page.getByRole('main').getByRole('alert')).toBeVisible(); interactions++;

        await rename.click(); let dialog = page.getByRole('dialog');
        const field = dialog.getByRole('textbox', { name: new RegExp(t.name) });
        await expect(field).toBeFocused(); await field.fill('   '); await expect(dialog.getByRole('button', { name: t.save, exact: true })).toBeDisabled();
        const name = `InternationalSubscriptionEntitlementReconciliation_${'Sample'.repeat(12)}`;
        await field.fill(name); await fit(`rename-${mode}`);
        await dialog.getByRole('button', { name: t.save, exact: true }).click(); await expect(field).toBeDisabled();
        await expect(dialog.getByRole('button', { name: common.close, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        if (mode === 'success') {
          await expect(dialog).toHaveCount(0); await expect(page.getByRole('heading', { level: 1 })).toHaveText(name); await expect(rename).toBeFocused();
        } else {
          await expect(dialog.getByRole('alert')).toBeVisible(); await expect(field).toHaveValue(name); await fit(`rename-error-${mode}`);
          await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(rename).toBeFocused();
        }
        interactions++;
        await remove.click(); dialog = page.getByRole('dialog'); await fit(`delete-${mode}`);
        await dialog.getByRole('button', { name: common.cancel, exact: true }).click(); await expect(remove).toBeFocused();
        await expect(page.locator('[data-header-navigation]')).toContainText('No navigation');
        await remove.click(); dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: t.delete, exact: true }).click();
        await expect(dialog.getByRole('button', { name: common.close, exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
        if (mode === 'success') { await expect(dialog).toHaveCount(0); await expect(page.locator('[data-header-navigation]')).toContainText('/app/dashboards'); }
        else { await expect(dialog.getByRole('alert')).toBeVisible(); await expect(page.locator('[data-header-navigation]')).toContainText('No navigation'); await fit(`delete-error-${mode}`); }
        interactions++;
      }
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
      await context.close(); console.log(`PASS report header ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} catch (error) { console.error(error); throw error; } finally { await browser.close(); }
