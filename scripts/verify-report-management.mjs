import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-report-management-'));
const browser = await chromium.launch();
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    const t = m.appDashboards.management, common = m.appCommon;
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], unexpected = [];
      await guardDesignFixture(context, base, unexpected);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription|hydration|hydrated/i.test(message.text())) errors.push(message.text()); });
      page.on('dialog', dialog => { errors.push('Unexpected native dialog'); void dialog.dismiss(); });

      const visit = async (view, outcome) => {
        const mode = view === 'empty' ? 'empty' : ['failure', 'throw'].includes(outcome) ? outcome : 'success';
        const response = await page.goto(`${base}/dev/operations?view=${view === 'empty' ? 'report-actions' : view}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200);
        await expect(page.locator(view === 'header' ? '[data-header-ready]' : '[data-flow-ready]')).toHaveAttribute(view === 'header' ? 'data-header-ready' : 'data-flow-ready', 'true');
        if (['malformed', 'refresh-error', 'navigate-error'].includes(outcome) || (view === 'empty' && ['failure', 'throw'].includes(outcome))) await page.locator('[data-management-response]').selectOption(outcome);
        if (view === 'empty') {
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.appDashboards.list.emptyTitle);
          await expect(page.getByRole('link', { name: m.appDashboards.list.emptyPrimary })).toHaveAttribute('href', '/app/sources');
        }
      };
      const fit = async label => {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          await assertControlTargets(page, '[class*="reportHeader"] button, [class*="reportHeader"] > a, [role="dialog"] button');
          const dialog = page.getByRole('dialog');
          if (await dialog.count()) {
            const box = await dialog.boundingBox();
            assert.ok(box.x >= 15 && box.x + box.width <= width - 15, 'Modal gutters');
            assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Modal inner overflow');
          }
          renders++;
          if (locale === 'en' && width === 320) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      };
      const submit = async (view, action) => {
        const suffix = view === 'header' ? '' : ': Business health';
        if (action === 'pin') {
          const label = view === 'header' ? m.appChrome.dashboard.pinAdd : m.appChrome.dashboard.pinRemove;
          await page.getByRole('button', { name: label + suffix, exact: true }).evaluate(button => { button.click(); button.click(); button.click(); });
          return;
        }
        const label = action === 'create' ? m.appDashboards.index.newReport : (action === 'rename' ? t.rename : t.delete) + suffix;
        await page.getByRole('button', { name: label, exact: true }).click();
        const dialog = page.getByRole('dialog');
        if (action !== 'delete') {
          const field = dialog.getByRole('textbox');
          await expect(field).toBeFocused(); await field.fill('Updated sample report');
        }
        const confirm = dialog.getByRole('button', { name: action === 'create' ? m.appChrome.common.create : action === 'rename' ? t.save : t.delete, exact: true });
        await confirm.evaluate(button => { button.click(); button.click(); button.click(); });
        await expect(dialog.getByRole('button', { name: common.close, exact: true })).toBeDisabled();
        await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      };
      const callLines = async view => {
        const text = await page.locator(view === 'header' ? '[data-header-calls]' : '[data-flow-calls]').textContent();
        return text.split(view === 'header' ? ', ' : '\n').filter(Boolean);
      };
      for (const view of process.argv.includes('--empty-only') ? ['empty'] : ['header', 'report-actions', 'empty']) {
        const actions = view === 'header' ? ['pin', 'rename', 'delete'] : view === 'empty' ? ['create'] : ['pin', 'rename', 'delete', 'create'];
        for (const action of actions) {
          for (const outcome of ['success', 'failure', 'throw', 'malformed', 'refresh-error', 'navigate-error']) {
            if (outcome === 'navigate-error' && !(view === 'header' && action === 'delete') && action !== 'create') continue;
            await visit(view, outcome);
            await submit(view, action);
            if (view === 'header') await expect(page.locator('[data-header-body-action]').locator('..')).toHaveAttribute('inert', '');
            const dialog = page.getByRole('dialog'), unknown = ['throw', 'malformed'].includes(outcome);
            const notice = page.locator('[class*="reportHeader"] > [role="alert"], [class*="reportHeader"] > [role="status"]');
            const navigation = page.locator(view === 'header' ? '[data-header-navigation]' : '[data-flow-navigation]');
            if (unknown) {
              await expect(dialog).toHaveCount(0);
              await expect(notice).toHaveText(t.unconfirmed);
              await expect(page.getByRole('link', { name: t.reviewLatest })).toHaveAttribute('href', view === 'header' ? '/app/dashboards/fixture-report-header' : '/app/dashboards');
              await expect(page.getByRole('link', { name: t.reviewLatest })).toBeFocused();
              const buttons = page.locator('[class*="reportHeader"] button');
              for (const button of await buttons.all()) await expect(button).toBeDisabled();
              await expect(navigation).toContainText('No navigation');
            } else if (outcome === 'failure') {
              if (action === 'pin') await expect(notice).toBeVisible();
              else {
                await expect(dialog.getByRole('alert')).toBeVisible();
                if (action !== 'delete') await expect(dialog.getByRole('textbox')).toHaveValue('Updated sample report');
                await expect(dialog.getByRole('button', { name: common.close, exact: true })).toBeEnabled();
              }
              await expect(navigation).toContainText('No navigation');
            } else {
              await expect(dialog).toHaveCount(0);
              const success = t[action === 'pin' ? view === 'header' ? 'pinned' : 'unpinned' : action === 'rename' ? 'renamed' : action === 'create' ? 'created' : 'removed'];
              await expect(notice).toContainText(success);
              if (action === 'pin') {
                const pin = page.locator('[class*="reportHeader"] button[aria-pressed]').first();
                await expect(pin).toHaveAttribute('aria-pressed', view === 'header' ? 'true' : 'false');
              }
              if (action === 'rename') {
                if (view === 'header') await expect(page.getByRole('heading', { level: 1 })).toHaveText('Updated sample report');
                else await expect(page.getByRole('button', { name: `${t.rename}: Updated sample report`, exact: true })).toBeVisible();
              }
              if (action === 'delete' && view === 'report-actions') await expect(page.getByRole('button', { name: `${t.delete}: Business health`, exact: true })).toHaveCount(0);
              if (action === 'create') await expect(page.getByRole('link', { name: 'Updated sample report', exact: true })).toHaveAttribute('href', '/app/dashboards/fixture-created-1');
              if (['refresh-error', 'navigate-error'].includes(outcome)) {
                await expect(notice).toContainText(t.viewUpdateFailed);
                await expect(page.getByRole('link', { name: t.reviewLatest })).toBeVisible();
              }
              if (action === 'delete' && view === 'header') {
                for (const button of await page.locator('[class*="reportHeader"] button').all()) await expect(button).toBeDisabled();
                await expect(page.getByRole('link', { name: t.reviewLatest })).toHaveAttribute('href', '/app/dashboards');
                await expect(page.locator('[data-header-body-action]')).toBeHidden();
              }
              if (outcome === 'navigate-error') await expect(navigation).toContainText('No navigation');
            }
            if (view === 'header' && unknown) {
              await expect(page.locator('[data-header-body-action]').locator('..')).toHaveAttribute('inert', '');
            } else if (view === 'header' && !(action === 'delete' && outcome !== 'failure')) {
              await expect(page.locator('[data-header-body-action]').locator('..')).not.toHaveAttribute('inert');
            }
            assert.equal((await callLines(view)).filter(line => line.startsWith(action)).length, 1, 'Synchronous repeated submissions made only one write');
            await fit(`${view}-${action}-${outcome}`); interactions++;
          }
          // Replace the mounted report/workspace during the awaited server response.
          await visit(view, 'success'); await submit(view, action);
          await page.getByText(view === 'header' ? 'Replace sample report' : 'Switch sample workspace', { exact: true }).evaluate(button => button.click());
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(page.getByText(view === 'empty' ? m.appDashboards.list.emptyTitle : 'Replacement report', { exact: true })).toBeVisible();
          // A local fixture response takes 650/700ms. Wait beyond it to inspect late effects.
          await page.waitForTimeout(850);
          await expect(page.locator(view === 'header' ? '[data-header-navigation]' : '[data-flow-navigation]')).toContainText('No navigation');
          if (view === 'header') await expect(page.locator('[data-header-navigation]')).toContainText('Refreshes: 0');
          else await expect(page.getByText('Local refreshes: 0', { exact: true })).toBeVisible();
          await expect(page.getByText(view === 'empty' ? m.appDashboards.list.emptyTitle : 'Replacement report', { exact: true })).toBeVisible();
          await expect(page.locator('[class*="reportHeader"] > [role="alert"]')).toHaveCount(0);
          await fit(`${view}-${action}-replacement`); interactions++;
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close(); console.log(`PASS report management ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, output }, null, 2));
} finally { await browser.close(); }
