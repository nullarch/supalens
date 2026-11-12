import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { localFixtureOrigin, guardDesignFixture, assertControlTargets } from './lib/design-fixture.mjs';

const base = localFixtureOrigin(process.argv[2]);
const output = await mkdtemp(join(tmpdir(), 'supalens-billing-actions-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const portalOnly = process.argv.includes('--portal');
const modes = ['success', 'start-failure', 'start-throw', 'init-failure', 'init-throw', 'open-throw',
  'confirm-failure', 'confirm-throw', 'missing-transaction', 'pending', 'refresh-throw', 'telemetry-throw',
  'portal-failure', 'portal-throw', 'portal-invalid', 'portal-success'].filter(mode => !portalOnly || mode.startsWith('portal-'));
let renders = 0, interactions = 0;
try {
  for (const locale of ['en', 'ko', 'ja']) {
    const { appBilling: t } = JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: base }]);
      await context.addInitScript(value => localStorage.setItem('theme', value), theme);
      const errors = [], mutations = [], providers = [];
      await guardDesignFixture(context, base, mutations);
      const page = await context.newPage();
      page.on('request', request => { if (/(^|\.)paddle\.(com|net)$/.test(new URL(request.url()).hostname)) providers.push(request.url()); });
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/MISSING_MESSAGE|INVALID_MESSAGE|DialogTitle|DialogDescription/.test(m.text())) errors.push(m.text()); });
      const calls = () => page.locator('[data-billing-calls]').textContent().then(JSON.parse);
      async function fit(label) {
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          await assertControlTargets(page, '#plans button, #plans a, [data-portal-banner] button');
          for (const card of await page.locator('[data-plan], [data-checkout-phase]').all()) assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Internal overflow ${label}`);
          renders++;
          if (locale === 'en' && width === 320) await page.screenshot({ path: join(output, `${label}-${theme}.png`), fullPage: true });
        }
      }
      async function visit(mode) {
        assert.equal((await page.goto(`${base}/dev/billing?mode=${mode}`)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
      }
      for (const mode of modes) {
        await visit(mode); await fit(`initial-${mode}`);
        if (mode.startsWith('portal-')) {
          for (const entry of ['banner', 'cards']) {
            if (entry === 'cards') await visit(mode);
            const region = entry === 'banner' ? page.locator('[data-portal-banner]') : page.locator('#plans');
            // Keep a stable control locator while its accessible label changes to Opening.
            const button = entry === 'banner' ? region.getByRole('button') : region.locator('[data-plan="free"] button');
            await button.click(); await expect(button).toBeDisabled();
            if (mode !== 'portal-success') {
              await expect(region.getByRole('alert')).toHaveText(mode === 'portal-failure' ? t.errors.forbidden : t.errors.portal_failed);
              await expect(button).toBeEnabled();
              assert.equal((await calls()).filter(c => c.name === 'navigate').length, 0);
              await fit(`${mode}-${entry}-error`);
              await page.getByRole('button', { name: 'Restore sample responses' }).click(); await button.click();
            }
            await expect.poll(async () => (await calls()).filter(c => c.name === 'navigate').length).toBe(1);
            assert.equal((await calls()).find(c => c.name === 'navigate').value, 'https://example.invalid/billing');
            await expect(button).toBeDisabled(); interactions++;
          }
          continue;
        }
        const basic = page.locator('[data-plan="basic"]');
        const upgrade = basic.getByRole('button', { name: t.planCards.choose, exact: true });
        await page.getByRole('button', { name: t.planCards.yearly, exact: true }).click();
        await upgrade.click();
        await expect(page.getByRole('button', { name: t.planCards.monthly, exact: true })).toBeDisabled();
        await expect(page.locator('[data-plan="premium"] button')).toBeDisabled();
        if (['start-failure', 'start-throw', 'init-failure', 'init-throw'].includes(mode)) {
          await expect(basic.locator('[data-checkout-phase="failure"]')).toBeVisible();
          await expect(upgrade).toBeEnabled();
          await expect(page.getByRole('button', { name: t.planCards.monthly, exact: true })).toBeEnabled();
          await fit(`failed-${mode}`);
          await page.getByRole('button', { name: 'Restore sample responses' }).click(); await upgrade.click();
        }
        if (mode === 'open-throw') {
          await expect(basic.locator('[data-checkout-phase="unconfirmed"]')).toBeVisible();
          await expect(basic.getByRole('link')).toHaveAttribute('href', '/app/settings/billing');
          await expect(basic.getByRole('button')).toBeDisabled();
          await fit(mode); interactions++; continue;
        }
        await expect(page.getByRole('dialog')).toBeVisible();
        const openCall = (await calls()).find(c => c.name === 'open');
        assert.equal(openCall.value.settings.locale, locale); assert.equal(openCall.value.settings.theme, theme);
        assert.deepEqual((await calls()).find(c => c.name === 'start').value, { plan: 'basic', interval: 'year' });
        assert.equal((await calls()).filter(c => c.name === 'confirm').length, 0);
        await page.getByRole('button', { name: 'Complete sample checkout', exact: true }).click();
        if (mode === 'missing-transaction') {
          await expect(basic.locator('[data-checkout-phase="unconfirmed"]')).toBeVisible();
          await expect(basic.getByText(t.errors.invalid_transaction_id, { exact: true })).toBeVisible();
          assert.equal((await calls()).filter(c => c.name === 'confirm').length, 0);
          await expect(basic.getByRole('button')).toBeDisabled(); await fit(mode); interactions++; continue;
        }
        if (['confirm-failure', 'confirm-throw', 'pending'].includes(mode)) {
          await expect(basic.locator('[data-checkout-phase="unconfirmed"]')).toBeVisible();
          await expect(basic.getByRole('alert')).toContainText(t.checkoutState.unconfirmed);
          await expect(page.locator('[data-plan="premium"] button')).toBeDisabled();
          assert.equal((await calls()).filter(c => c.name === 'refresh').length, 0);
          await fit(`unconfirmed-${mode}`);
          await page.getByRole('button', { name: 'Restore sample responses' }).click();
          await basic.getByRole('button', { name: t.checkoutState.retryConfirmation }).click();
        }
        await expect(basic.locator('[data-checkout-phase="confirmed"]')).toBeVisible();
        await expect(basic.getByRole('status')).toHaveText(t.upgraded);
        await expect(basic.getByRole('link')).toHaveAttribute('href', '/app/settings/billing');
        await expect(page.locator('[data-plan="premium"] button')).toBeDisabled();
        const log = await calls(), confirmations = log.filter(c => c.name === 'confirm');
        assert.equal(confirmations.length, ['confirm-failure', 'confirm-throw', 'pending'].includes(mode) ? 2 : 1);
        assert.ok(confirmations.every(c => c.value === 'txn_sample123'));
        assert.equal(log.filter(c => c.name === 'refresh').length, 1);
        assert.equal(log.filter(c => c.name === 'open').length, 1);
        await fit(`confirmed-${mode}`); interactions++;
      }
      if (!portalOnly) {
      // Close/reopen, stale callbacks and uncertain SDK errors use separate safe samples.
      await visit('success');
      const basic = page.locator('[data-plan="basic"]');
      await basic.getByRole('button').click(); await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await expect(basic.locator('[data-checkout-phase="closed"]')).toBeVisible();
      await expect(basic.getByRole('button')).toBeEnabled();
      await basic.getByRole('button').click(); await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Close sample checkout' }).click();
      await page.getByRole('button', { name: 'Emit old checkout callback' }).click();
      assert.equal((await calls()).filter(c => c.name === 'confirm').length, 0);
      await basic.getByRole('button').click(); await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Simulate checkout error' }).click();
      await expect(basic.locator('[data-checkout-phase="unconfirmed"]')).toBeVisible();
      await expect(basic.getByRole('button')).toBeDisabled();
      await fit('sdk-error'); interactions += 3;
      }
      assert.deepEqual(errors, []); assert.deepEqual(mutations, []); assert.deepEqual(providers, []);
      await context.close(); console.log(`PASS billing actions ${locale}/${theme}`);
    }
  }
  console.log(JSON.stringify({ renders, interactions, screenshots: output }, null, 2));
} finally { await browser.close(); }
