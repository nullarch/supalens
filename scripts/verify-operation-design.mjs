/** Real billing/detail views and report editor; fixture data and local callbacks only. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const baseURL = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-operations-'));
const browser = await chromium.launch({ headless: true });
let renders = 0;
let interactions = 0;
const failures = [];

async function fit(page, label) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, undefined, { timeout: 2000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label);
}

try {
  for (const locale of ['en', 'ko', 'ja']) {
    const m = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      context.setDefaultTimeout(15000);
      context.setDefaultNavigationTimeout(30000);
      const mutations = [];
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseURL }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      await guardDesignFixture(context, baseURL, mutations);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        const text = message.text();
        if (/MISSING_MESSAGE|INVALID_MESSAGE/.test(text) || (message.type() === 'error' && !/^Failed to load resource:/.test(text))) errors.push(text);
      });
      for (const [view, modes] of [
        ['billing', ['free', 'active', 'past_due', 'paused', 'scheduled', 'trialing', 'unlimited']],
        ['monitor', ['healthy', 'incident', 'error', 'paused', 'empty']],
        ['reports', ['active', 'empty']],
        ['editor', ['active']],
      ]) {
        for (const mode of modes) {
          const label = `${view}-${mode}-${locale}-${theme}`;
          try {
            const response = await page.goto(`${baseURL}/dev/operations?view=${view}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
            assert.equal(response.status(), 200);
            await page.evaluate(() => document.fonts.ready);
            if (view === 'billing') await page.locator('[data-billing-summary-ready="true"]').waitFor();
            if (view === 'monitor') await page.locator('[data-monitor-summary-ready="true"]').waitFor();
            for (const width of [1440, 768, 390, 320]) {
              await page.setViewportSize({ width, height: 1000 });
              await fit(page, label);
              if (view === 'billing') {
                await assertControlTargets(page, '[inert] button, [inert] a[href="#plans"]');
                await expect(page.locator('#billing-usage-title')).toHaveText(m.appBilling.usageTitle);
                await expect(page.locator('#billing-transactions-title')).toHaveText(m.appBilling.transactionsTitle);
              }
              renders++;
            }
            if (view === 'billing') {
              const table = page.locator('[role="region"][tabindex="0"]').filter({ has: page.locator('table') });
              if (await table.count()) {
                await expect(table).toHaveAttribute('aria-label', m.appBilling.transactionsTitle);
                // Temporarily lift the rendering fixture's inert boundary for
                // keyboard-only table scrolling. No billing action is invoked.
                const boundary = await page.locator('[inert]').first().elementHandle();
                assert.ok(boundary);
                await boundary.evaluate(node => { node.inert = false; });
                try {
                  await table.focus(); await expect(table).toBeFocused();
                  await page.keyboard.press('ArrowRight');
                  await expect.poll(() => table.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
                  interactions++;
                } finally { await boundary.evaluate(node => { node.inert = true; }); }
              }
            }
            if (view === 'monitor') {
              const value = page.locator('.dx-kpi').first();
              if (mode === 'error') {
                assert.equal(await value.locator('.dx-kpi-value').innerText(), '—');
                assert.match(await value.locator('.dx-kpi-delta').innerText(), /3/);
                assert.ok((await value.innerText()).includes(m.appMonitors.detail.lastRecorded));
              }
              if (mode === 'paused') assert.equal(await value.locator('.dx-kpi-label').textContent(), m.appMonitors.detail.lastRecorded);
              await page.locator('details summary').click();
              assert.equal(await page.locator('details').getAttribute('open'), '');
              assert.match(await page.locator('details pre').innerText(), /SELECT 3/);
            }
            if (view === 'billing' && mode === 'free') assert.equal(await page.getByText(m.appBilling.freeNoBill, { exact: true }).count(), 1);
            if (locale === 'en' && ['incident', 'error', 'active', 'past_due'].includes(mode)) {
              await page.setViewportSize({ width: 1440, height: 1000 });
              await page.screenshot({ path: join(output, `${label}.png`), fullPage: true });
            }
            console.log(`PASS ${label}`);
          } catch (error) {
            failures.push(`${label}: ${error.message}`);
            console.error(`FAIL ${label}: ${error.message}`);
          }
        }
      }

      // Full production widget editor with safe callbacks, including failure/retry.
      for (const width of [1440, 320]) {
        console.log(`CHECK editor interactions ${locale}/${theme}/${width}`);
        // Layout editing is intentionally desktop-only. Check an already-open
        // editor after a viewport resize, not a nonexistent mobile entry point.
        await page.setViewportSize({ width: 1440, height: 800 });
        await page.goto(`${baseURL}/dev/operations?view=editor`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-report-editor-ready="true"]').waitFor();
        await page.getByRole('button', { name: m.appDashboards.grid.editLayout, exact: true }).click();
        const done = page.getByRole('button', { name: m.appDashboards.grid.done, exact: true });
        await done.focus();
        await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
        const toolbarStyle = await done.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, size: getComputedStyle(el).fontSize, outline: getComputedStyle(el).outlineStyle }));
        assert.equal(toolbarStyle.radius, '6px'); assert.equal(toolbarStyle.size, '13px'); assert.equal(toolbarStyle.outline, 'solid');
        await page.setViewportSize({ width: 768, height: 800 });
        await fit(page, `toolbar-${locale}-${theme}`);
        assert.ok(await done.isVisible());
        assert.ok(await page.getByText(m.appDashboards.grid.dragHint, { exact: true }).isVisible());
        await page.setViewportSize({ width: 1440, height: 800 });
        const opener = page.getByRole('button', { name: m.appDashboards.grid.editWidget, exact: true });
        await opener.click();
        await page.setViewportSize({ width, height: 800 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible' });
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= width - 15);
        assert.ok(box.height <= 769);
        const refresh = dialog.getByLabel(m.appDashboards.grid.fieldRefresh, { exact: true });
        await refresh.fill('2');
        await dialog.getByRole('button', { name: m.appDashboards.grid.save, exact: true }).click();
        assert.equal(await dialog.getByRole('alert').innerText(), m.appDashboards.grid.refreshHint);
        await refresh.fill('120');
        await dialog.getByLabel(m.appDashboards.grid.fieldTitle, { exact: true }).fill('Activation health');
        await dialog.getByRole('button', { name: m.appDashboards.grid.save, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.match(await page.getByRole('status').last().innerText(), /Local update:.*Activation health/);

        await page.setViewportSize({ width: 1440, height: 800 });
        await page.getByLabel('Simulate a save failure (local preview)').check();
        await opener.click();
        await page.setViewportSize({ width, height: 800 });
        await dialog.getByLabel(m.appDashboards.grid.fieldTitle, { exact: true }).fill('Keep these edits');
        await dialog.getByRole('button', { name: m.appDashboards.grid.save, exact: true }).click();
        assert.equal(await dialog.getByRole('alert').innerText(), m.appDashboards.grid.updateFailed);
        assert.equal(await dialog.getByLabel(m.appDashboards.grid.fieldTitle, { exact: true }).inputValue(), 'Keep these edits');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.setViewportSize({ width: 1440, height: 800 });
        await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, m.appDashboards.grid.editWidget, { timeout: 1500 });
        await page.getByRole('button', { name: m.appDashboards.grid.done, exact: true }).click();
        await page.getByRole('button', { name: m.appDashboards.widget.menu, exact: true }).click();
        await page.getByRole('menuitem').first().click();
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.getByRole('heading').innerText(), m.appDashboards.debug.title);
        assert.match(await dialog.locator('pre').innerText(), /SELECT 3/);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        interactions++;
      }
      assert.deepEqual(errors, [], 'No runtime or missing-translation errors');
      assert.deepEqual(mutations, [], 'No server mutation attempted');
      await context.close();
      console.log(`PASS ${locale}/${theme} editor validation, local save, failure, preserved input, focus, SQL disclosure`);
    }
  }
} finally {
  console.log(`Assertions finished: ${renders} viewport cases / ${interactions} keyboard and editor cases; closing browser.`);
  await browser.close();
  console.log(`Checked ${renders} viewport cases and ${interactions} keyboard and editor cases. Screenshots: ${output}`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}
